// Enregistrement au micro du téléphone, puis nettoyage : blancs retirés, volume réglé, format WAV

import { encodeWav } from "../radio/program";
import { normalizePeak, trimSilence } from "./trimSilence";

// Fréquence des voix de synthèse : une voix enregistrée se mélange à elles sans conversion
const SAMPLE_RATE = 22050;
// Le micro continue un court instant après le relâchement : la fin du dernier mot n'est pas coupée
const POST_ROLL_MS = 250;
// En dessous, ce n'est pas une phrase : un appui trop bref ou un bruit
const MIN_VOICE_MS = 150;

export interface MicRecorder {
  start(): void;
  // Son brut, à nettoyer avec cleanRecording
  stop(): Promise<Blob>;
  isRecording(): boolean;
  // Coupe le micro : le téléphone cesse d'afficher qu'il écoute
  close(): void;
}

export async function openMicRecorder(): Promise<MicRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  });
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];

  return {
    start() {
      if (recorder) return;
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.addEventListener("dataavailable", (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      });
      recorder.start();
    },

    stop() {
      const current = recorder;
      if (!current) return Promise.resolve(new Blob());
      return new Promise((resolve) => {
        current.addEventListener("stop", () => {
          recorder = null;
          resolve(new Blob(chunks, { type: current.mimeType }));
        });
        setTimeout(() => current.stop(), POST_ROLL_MS);
      });
    },

    isRecording: () => recorder !== null,

    close() {
      if (recorder?.state === "recording") recorder.stop();
      recorder = null;
      stream.getTracks().forEach((track) => track.stop());
    }
  };
}

// Nul quand aucune voix n'est entendue
export async function cleanRecording(raw: Blob): Promise<Blob | null> {
  const OfflineContext =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  // Le décodage convertit directement à la fréquence du contexte
  const context = new OfflineContext(1, 1, SAMPLE_RATE);
  const encoded = await raw.arrayBuffer();
  const buffer = await new Promise<AudioBuffer>((resolve, reject) => context.decodeAudioData(encoded, resolve, reject));

  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }

  const voice = trimSilence(mono, SAMPLE_RATE);
  if (voice.length < (MIN_VOICE_MS * SAMPLE_RATE) / 1000) return null;
  return new Blob([encodeWav([normalizePeak(voice)], SAMPLE_RATE)], { type: "audio/wav" });
}

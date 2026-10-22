// Écoute du micro par Vosk, traduite en réponses devinées.
// Le son est capté hors du fil principal (AudioWorklet) puis reconnu dans le Web Worker de Vosk, sur l'appareil :
// rien ne part sur internet. Vosk ne répond qu'avec les mots de ANSWER_GRAMMAR, et ne reçoit que la parole,
// découpée en phrases par speechSegmenter : un téléphone lent ne prend pas de retard pendant les silences
import type { KaldiRecognizer } from "vosk-browser";
import { ANSWER_GRAMMAR, interpretAlternatives, SpeechGuess, SpeechRule } from "./speechGuess";
import { createSpeechSegmenter, DEFAULT_FLOOR, SegmentEvent } from "./speechSegmenter";
import { loadVoiceModel } from "./voiceModel";

export function isSpeechSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof WebAssembly === "object" &&
    typeof Worker === "function" &&
    typeof indexedDB === "object" &&
    typeof AudioWorkletNode === "function" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export interface HeardSpeech {
  guess: SpeechGuess | null;
  transcript: string;
  rulesUsed: SpeechRule[];
  // Faux tant que l'enfant parle encore : la supposition peut changer
  isFinal: boolean;
  // Phrase finie : moment où l'enfant a fini de parler (horloge de performance.now()), sans le temps de calcul de Vosk
  spokenAt?: number;
}

export type SpeechProblem = "no-mic" | "download" | "unavailable";

// « loading » : modèle en cours de chargement (téléchargement la première fois) ; « ready » : on peut parler
export type ListenerState = "loading" | "ready";

export interface SpeechListener {
  // Les réponses dites comptent à partir de maintenant
  start(): void;
  // Elles ne comptent plus ; le micro reste ouvert pour repartir tout de suite
  stop(): void;
  // Coupe le micro : le téléphone cesse d'afficher qu'il écoute
  release(): void;
}

// Le son arrive par paquets de 128 échantillons : on en regroupe environ 0,04 s avant de l'envoyer au worker,
// avec son volume, qui fait bouger le micro à l'écran pendant que l'enfant parle
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.chunk = new Float32Array(2048); this.size = 0; this.sum = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        const sample = channel[i];
        this.sum += sample * sample;
        this.chunk[this.size++] = sample;
        if (this.size === this.chunk.length) {
          this.port.postMessage({ samples: this.chunk.slice(0), level: Math.sqrt(this.sum / this.size) });
          this.size = 0;
          this.sum = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("speech-capture", Capture);
`;

// Volume d'une voix normale près du téléphone (moyenne quadratique) : au-delà, le micro est « plein »
const LOUD_LEVEL = 0.12;

interface Capture {
  context: AudioContext;
  stream: MediaStream;
  recognizer: KaldiRecognizer;
}

export function createSpeechListener(handlers: {
  onHeard(heard: HeardSpeech): void;
  // L'écoute ne peut pas marcher : il faut repasser au clavier
  onProblem(problem: SpeechProblem): void;
  onState?(state: ListenerState): void;
  // Volume entendu, de 0 à 1, plusieurs fois par seconde pendant l'écoute ; rms : la mesure brute, pour le calibrage
  onLevel?(level: number, rms: number): void;
  // Une phrase commence (l'enfant parle) ou finit (Vosk la traite : le résultat suit)
  onSpeech?(event: SegmentEvent): void;
  // Seuil le plus bas de la parole pour ce téléphone, fixé par le calibrage
  floor?(): number | undefined;
}): SpeechListener {
  let isWanted = false;
  let isReleased = false;
  let capture: Capture | null = null;
  let opening: Promise<void> | null = null;

  // Correspondance entre le son donné à Vosk et l'horloge de la page : Vosk date les mots en secondes de son reçu,
  // et ce son a des trous (rien n'est donné pendant la question). Chaque reprise ouvre un tronçon continu
  let fedSamples = 0;
  const segments: { sample: number; wall: number }[] = [];
  const segmenter = createSpeechSegmenter(() => handlers.floor?.() ?? DEFAULT_FLOOR);

  function wallTimeOf(seconds: number, sampleRate: number): number | undefined {
    const sample = seconds * sampleRate;
    const segment = [...segments].reverse().find((s) => s.sample <= sample);
    return segment ? segment.wall + ((sample - segment.sample) / sampleRate) * 1000 : undefined;
  }

  // Une supposition en cours n'a pas d'heure de fin de mot : on retient quand son texte a changé pour la dernière fois
  let lastPartial = "";
  let lastPartialAt = 0;

  function heard(text: string, isFinal: boolean, spokenAt?: number) {
    const { guess, transcript, rulesUsed } = interpretAlternatives([text]);
    handlers.onHeard({ guess, transcript, rulesUsed, isFinal, spokenAt });
  }

  async function open(): Promise<Capture | null> {
    handlers.onState?.("loading");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
      });
    } catch (err) {
      console.warn("Micro indisponible", err);
      handlers.onProblem("no-mic");
      return null;
    }

    let model;
    try {
      model = await loadVoiceModel();
    } catch (err) {
      console.warn("Modèle vocal indisponible", err);
      stream.getTracks().forEach((track) => track.stop());
      handlers.onProblem("download");
      return null;
    }

    try {
      const context = new AudioContext();
      await context.resume();
      const workletUrl = URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: "text/javascript" }));
      await context.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);

      const recognizer = new model.KaldiRecognizer(context.sampleRate, JSON.stringify(ANSWER_GRAMMAR));
      recognizer.on("partialresult", (message) => {
        if (message.event !== "partialresult" || !message.result.partial) return;
        if (message.result.partial !== lastPartial) {
          lastPartial = message.result.partial;
          lastPartialAt = performance.now();
        }
        heard(message.result.partial, false, lastPartialAt);
      });
      recognizer.setWords(true);
      recognizer.on("result", (message) => {
        if (message.event !== "result") return;
        lastPartial = "";
        // Une phrase sans rien de reconnu est signalée aussi : l'enfant doit savoir qu'il faut redire
        if (!message.result.text) {
          heard("", true);
          return;
        }
        const lastWord = message.result.result?.[message.result.result.length - 1];
        heard(message.result.text, true, lastWord ? wallTimeOf(lastWord.end, context.sampleRate) : undefined);
      });

      const node = new AudioWorkletNode(context, "speech-capture");
      node.port.onmessage = (e: MessageEvent<{ samples: Float32Array; level: number }>) => {
        const { samples, level } = e.data;
        if (!isWanted) return;
        handlers.onLevel?.(Math.min(1, level / LOUD_LEVEL), level);
        const durationMs = (samples.length / context.sampleRate) * 1000;
        // Le paquet vient d'arriver : il a commencé à être enregistré sa propre durée plus tôt
        const { feed, event } = segmenter.push({ samples, level, durationMs, wall: performance.now() - durationMs });
        // Une phrase qui commence ouvre un tronçon continu de son donné à Vosk
        if (event === "start" && feed.length > 0) segments.push({ sample: fedSamples, wall: feed[0].wall });
        for (const chunk of feed) {
          recognizer.acceptWaveformFloat(chunk.samples, context.sampleRate);
          fedSamples += chunk.samples.length;
        }
        if (event === "end") recognizer.retrieveFinalResult();
        if (event) handlers.onSpeech?.(event);
      };
      // Relié à une sortie muette : sans sortie, certains navigateurs ne font pas tourner le nœud
      const mute = context.createGain();
      mute.gain.value = 0;
      context.createMediaStreamSource(stream).connect(node);
      node.connect(mute).connect(context.destination);

      handlers.onState?.("ready");
      return { context, stream, recognizer };
    } catch (err) {
      console.warn("Reconnaissance vocale impossible", err);
      stream.getTracks().forEach((track) => track.stop());
      handlers.onProblem("unavailable");
      return null;
    }
  }

  function close() {
    const current = capture;
    capture = null;
    if (!current) return;
    current.recognizer.remove();
    current.stream.getTracks().forEach((track) => track.stop());
    current.context.close().catch(() => undefined);
  }

  return {
    start() {
      isReleased = false;
      isWanted = true;
      if (capture || opening) return;
      opening = open().then((opened) => {
        opening = null;
        capture = opened;
        // Coupé pendant l'ouverture : on ne garde pas le micro
        if (isReleased) close();
      });
    },

    stop() {
      if (!isWanted) return;
      isWanted = false;
      // Vide ce que Vosk a entendu jusque-là : la prochaine réponse repart de zéro
      if (segmenter.isSpeaking()) capture?.recognizer.retrieveFinalResult();
      segmenter.reset();
    },

    release() {
      isWanted = false;
      isReleased = true;
      segmenter.reset();
      close();
    }
  };
}

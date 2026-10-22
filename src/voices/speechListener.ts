// Écoute du micro par Vosk, traduite en réponses devinées.
// Le son est capté hors du fil principal (AudioWorklet) puis reconnu dans le Web Worker de Vosk, sur l'appareil :
// rien ne part sur internet. Vosk ne répond qu'avec les mots de ANSWER_GRAMMAR
import type { KaldiRecognizer } from "vosk-browser";
import { ANSWER_GRAMMAR, interpretAlternatives, SpeechGuess, SpeechRule } from "./speechGuess";
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

// Le son arrive par paquets de 128 échantillons : on en regroupe environ 0,1 s avant de l'envoyer au worker
const CAPTURE_WORKLET = `
class Capture extends AudioWorkletProcessor {
  constructor() { super(); this.chunk = new Float32Array(4096); this.size = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.chunk[this.size++] = channel[i];
        if (this.size === this.chunk.length) { this.port.postMessage(this.chunk.slice(0)); this.size = 0; }
      }
    }
    return true;
  }
}
registerProcessor("speech-capture", Capture);
`;

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
}): SpeechListener {
  let isWanted = false;
  let isReleased = false;
  let capture: Capture | null = null;
  let opening: Promise<void> | null = null;

  // Correspondance entre le son donné à Vosk et l'horloge de la page : Vosk date les mots en secondes de son reçu,
  // et ce son a des trous (rien n'est donné pendant la question). Chaque reprise ouvre un tronçon continu
  let fedSamples = 0;
  let isFeeding = false;
  const segments: { sample: number; wall: number }[] = [];

  function wallTimeOf(seconds: number, sampleRate: number): number | undefined {
    const sample = seconds * sampleRate;
    const segment = [...segments].reverse().find((s) => s.sample <= sample);
    return segment ? segment.wall + ((sample - segment.sample) / sampleRate) * 1000 : undefined;
  }

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
        if (message.event === "partialresult" && message.result.partial) heard(message.result.partial, false);
      });
      recognizer.setWords(true);
      recognizer.on("result", (message) => {
        if (message.event !== "result" || !message.result.text) return;
        const lastWord = message.result.result?.[message.result.result.length - 1];
        heard(message.result.text, true, lastWord ? wallTimeOf(lastWord.end, context.sampleRate) : undefined);
      });

      const node = new AudioWorkletNode(context, "speech-capture");
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (!isWanted) {
          isFeeding = false;
          return;
        }
        if (!isFeeding) {
          // Le paquet vient d'arriver : il a commencé à être enregistré sa propre durée plus tôt
          segments.push({ sample: fedSamples, wall: performance.now() - (e.data.length / context.sampleRate) * 1000 });
          isFeeding = true;
        }
        recognizer.acceptWaveformFloat(e.data, context.sampleRate);
        fedSamples += e.data.length;
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
      capture?.recognizer.retrieveFinalResult();
    },

    release() {
      isWanted = false;
      isReleased = true;
      close();
    }
  };
}

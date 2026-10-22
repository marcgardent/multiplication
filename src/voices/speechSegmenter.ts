// Découpage de l'écoute en phrases : seule la parole part vers Vosk, jamais les silences.
// Sur un téléphone lent, Vosk met plus d'une seconde à traiter une seconde de son : en lui donnant tout, silences compris,
// il prend un retard qui ne se rattrape jamais. En ne lui donnant que la parole, l'attente reste celle d'une phrase.
//
// Heuristique assumée : « c'est de la parole » veut dire « le volume dépasse nettement le bruit de la pièce ».
// Le calibrage de l'espace parent fixe le seuil le plus bas pour ce téléphone ; sans calibrage, un seuil par défaut.

export interface AudioChunk {
  samples: Float32Array;
  // Volume du paquet (moyenne quadratique des échantillons)
  level: number;
  durationMs: number;
  // Début de l'enregistrement du paquet, horloge de performance.now()
  wall: number;
}

export type SegmentEvent = "start" | "end";

// Bruit de départ, avant d'avoir entendu la pièce : celui d'une pièce calme
const INITIAL_NOISE = 0.004;
// Seuil le plus bas sans calibrage
export const DEFAULT_FLOOR = 0.01;
// La parole dépasse le bruit de la pièce d'au moins ce facteur
const NOISE_FACTOR = 3;
// Il faut ce temps de son fort pour ouvrir une phrase : un claquement ne suffit pas
const START_MS = 80;
// Son gardé avant le début de la parole, pour ne pas couper la première syllabe
const PREROLL_MS = 300;
// Une phrase se ferme après ce silence
export const END_SILENCE_MS = 400;
// Au-delà, la phrase est fermée quoi qu'il arrive : un bruit continu ne bloque pas l'écoute
const MAX_SPEECH_MS = 6000;

export interface SpeechSegmenter {
  // Ce qu'il faut donner à Vosk pour ce paquet, et si une phrase commence ou finit
  push(chunk: AudioChunk): { feed: AudioChunk[]; event: SegmentEvent | null };
  isSpeaking(): boolean;
  threshold(): number;
  reset(): void;
}

export function createSpeechSegmenter(floor: () => number = () => DEFAULT_FLOOR): SpeechSegmenter {
  let noise = INITIAL_NOISE;
  let isSpeaking = false;
  let loudMs = 0;
  let silentMs = 0;
  let speechMs = 0;
  let preroll: AudioChunk[] = [];

  const threshold = () => Math.max(floor(), noise * NOISE_FACTOR);

  // Le bruit de la pièce baisse vite quand elle se calme, et monte lentement : la voix, brève, le relève à peine
  function updateNoise(level: number) {
    noise = level < noise ? noise * 0.7 + level * 0.3 : noise + (level - noise) * 0.005;
  }

  return {
    push(chunk) {
      const isLoud = chunk.level >= threshold();
      updateNoise(chunk.level);

      if (!isSpeaking) {
        preroll.push(chunk);
        const total = () => preroll.reduce((sum, c) => sum + c.durationMs, 0);
        while (preroll.length > 1 && total() - preroll[0].durationMs >= PREROLL_MS + START_MS) preroll.shift();
        loudMs = isLoud ? loudMs + chunk.durationMs : 0;
        if (loudMs < START_MS) return { feed: [], event: null };
        isSpeaking = true;
        silentMs = 0;
        speechMs = total();
        const feed = preroll;
        preroll = [];
        return { feed, event: "start" };
      }

      speechMs += chunk.durationMs;
      silentMs = isLoud ? 0 : silentMs + chunk.durationMs;
      if (silentMs >= END_SILENCE_MS || speechMs >= MAX_SPEECH_MS) {
        isSpeaking = false;
        loudMs = 0;
        return { feed: [chunk], event: "end" };
      }
      return { feed: [chunk], event: null };
    },

    isSpeaking: () => isSpeaking,
    threshold,

    reset() {
      isSpeaking = false;
      loudMs = 0;
      silentMs = 0;
      speechMs = 0;
      preroll = [];
    }
  };
}

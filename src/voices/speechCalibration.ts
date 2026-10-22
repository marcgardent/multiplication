// Calibrage d'un téléphone pour la réponse à voix haute : est-il assez rapide, et à partir de quel volume la voix est-elle de la parole ?
import type { CalibrationVerdict } from "../services/answerPreferences";
import { ANSWER_GRAMMAR } from "./speechGuess";
import { DEFAULT_FLOOR } from "./speechSegmenter";
import { loadVoiceModel } from "./voiceModel";

// Nombres que l'adulte ou l'enfant dit pendant le calibrage : un court, deux composés
export const CALIBRATION_TARGETS = [7, 56, 81];

// Attente après le dernier mot, au-delà de laquelle le téléphone est « lent », puis « trop lent ».
// Choix de confort pour un enfant, à revoir avec l'usage
export const FAST_MS = 1000;
export const SLOW_MS = 2500;

// Réponses de l'application décodées pour mesurer la vitesse : environ 10 secondes de parole
const SPEED_SAMPLE = [7, 56, 81, 42, 36, 24, 63, 100];
const SPEED_RATE = 16000;
const SPEED_GAP_S = 0.3;
// Sans résultat pendant ce temps, le téléphone n'y arrive pas
const SPEED_TIMEOUT_MS = 60000;

export function calibrationVerdict(result: { latencyMs: number | null; correct: number; total: number }): CalibrationVerdict {
  // Moins de deux nombres sur trois compris : la voix ne sert à rien sur ce téléphone, quelle que soit sa vitesse
  if (result.latencyMs === null || result.correct < Math.ceil((result.total * 2) / 3)) return "unusable";
  if (result.latencyMs <= FAST_MS) return "fast";
  return result.latencyMs <= SLOW_MS ? "slow" : "unusable";
}

// Seuil le plus bas qu'un calibrage peut fixer : une pièce mesurée parfaitement silencieuse ne rend pas tout bruit « parole »
const MIN_FLOOR = DEFAULT_FLOOR / 2;

// Seuil de la parole : à mi-chemin, en volume perçu, entre le bruit de la pièce et la voix entendue ; jamais sous le bruit
export function speechFloor(noise: number, voice: number | null): number {
  if (voice === null || voice <= noise) return Math.max(DEFAULT_FLOOR, noise * 3);
  return Math.max(MIN_FLOOR, noise * 2, Math.sqrt(noise * voice));
}

export function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : sorted[Math.floor(sorted.length / 2)];
}

// Vitesse de calcul : secondes de calcul pour une seconde de parole, sans micro, sur les voix de l'application.
// loadMs : temps de chargement du modèle, nul s'il était déjà chargé
export async function measureSpeed(): Promise<{ realTimeFactor: number | null; loadMs: number }> {
  const loadStart = performance.now();
  const model = await loadVoiceModel();
  const loadMs = Math.round(performance.now() - loadStart);

  // Les voix de synthèse, jamais celles enregistrées par un parent : la mesure reste comparable d'un appareil à l'autre
  const context = new OfflineAudioContext(1, 1, SPEED_RATE);
  const parts: Float32Array[] = [];
  for (const n of SPEED_SAMPLE) {
    const response = await fetch(`${import.meta.env.BASE_URL}audio/ans_${n}.mp3`);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    parts.push(buffer.getChannelData(0), new Float32Array(SPEED_RATE * SPEED_GAP_S));
  }
  const audio = new Float32Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    audio.set(part, offset);
    offset += part.length;
  }

  const recognizer = new model.KaldiRecognizer(SPEED_RATE, JSON.stringify(ANSWER_GRAMMAR));
  let lastResultAt = 0;
  let results = 0;
  recognizer.on("result", () => {
    lastResultAt = performance.now();
    results++;
  });
  const start = performance.now();
  const chunk = SPEED_RATE / 25;
  for (let i = 0; i < audio.length; i += chunk) recognizer.acceptWaveformFloat(audio.slice(i, i + chunk), SPEED_RATE);
  recognizer.retrieveFinalResult();

  // Fini quand plus rien n'arrive depuis un moment ; le temps d'attente n'est pas compté
  await new Promise<void>((resolve) => {
    const check = () => {
      const now = performance.now();
      const isSettled = results > 0 && now - lastResultAt > 1500;
      if (isSettled || now - start > SPEED_TIMEOUT_MS) resolve();
      else setTimeout(check, 250);
    };
    setTimeout(check, 250);
  });
  recognizer.remove();

  const audioSeconds = audio.length / SPEED_RATE;
  return { realTimeFactor: results > 0 ? (lastResultAt - start) / 1000 / audioSeconds : null, loadMs };
}

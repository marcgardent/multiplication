// Calibrage d'un téléphone pour la réponse à voix haute : est-il assez rapide, et à partir de quel volume la voix est-elle de la parole ?
import type { CalibrationVerdict } from "../services/answerPreferences";
import { DEFAULT_FLOOR } from "./speechSegmenter";

// Nombres que l'adulte ou l'enfant dit pendant le calibrage : un court, deux composés
export const CALIBRATION_TARGETS = [7, 56, 81];

// Attente après le dernier mot, au-delà de laquelle le téléphone est « lent », puis « trop lent ».
// Choix de confort pour un enfant, à revoir avec l'usage
export const FAST_MS = 1000;
export const SLOW_MS = 2500;

export function calibrationVerdict(result: { latencyMs: number | null; correct: number; total: number }): CalibrationVerdict {
  // Moins de deux nombres sur trois compris : la voix ne sert à rien sur ce téléphone, quelle que soit sa vitesse
  if (result.latencyMs === null || result.correct < Math.ceil((result.total * 2) / 3)) return "unusable";
  if (result.latencyMs <= FAST_MS) return "fast";
  return result.latencyMs <= SLOW_MS ? "slow" : "unusable";
}

// Niveau du test, de 1 à 5, pour la jauge du bilan : 4 et 5 « conseillé », 3 « praticable », 1 et 2 « non conseillé ».
// Il suit le verdict, et le nuance par l'attente
export const LEVEL_COUNT = 5;
const GREAT_MS = 600;

export function calibrationLevel(result: { latencyMs: number | null; correct: number; total: number }): number {
  const verdict = calibrationVerdict(result);
  if (verdict === "fast") return result.latencyMs !== null && result.latencyMs <= GREAT_MS ? 5 : 4;
  if (verdict === "slow") return 3;
  // Mal compris : le plus bas ; compris mais trop lent : juste au-dessous de « praticable »
  return result.latencyMs !== null && result.correct >= Math.ceil((result.total * 2) / 3) ? 2 : 1;
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

import { MultiplicationItem } from "../src/types";

export interface Persona {
  // Probabilité de bonne réponse, selon la boîte du calcul
  accuracy(item: MultiplicationItem): number;
  // Temps de réponse, tiré uniformément entre ces deux bornes
  responseTimeMs: [number, number];
}

// Sérieuse et régulière : peu d'erreurs, réponses ni rapides ni lentes
export const REGULAR: Persona = {
  accuracy: (item) => (item.boxLevel === 0 ? 0.9 : 0.97),
  responseTimeMs: [2600, 3600]
};

// Se trompe souvent et répond lentement
export const STRUGGLING: Persona = {
  accuracy: (item) => 0.55 + 0.05 * item.boxLevel,
  responseTimeMs: [3200, 6500]
};

// Répond vite et ne se trompe plus une fois le calcul appris : va au bout des 100 calculs
export const FAST: Persona = {
  accuracy: (item) => (item.boxLevel === 0 ? 0.95 : 1),
  responseTimeMs: [1400, 2400]
};

// Ce que rapporte chaque calcul : plus il est difficile, plus il rapporte. Règles dans docs/progression-et-recompenses.md.
// La table est choisie à la main, symétrique (a × b vaut b × a) : les tables de 1 et de 10 valent le moins,
// les carrés un cran de moins que leurs voisins, 6 × 9, 7 × 8, 7 × 9 et 8 × 9 le plus
const VALUES: number[][] = [
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  [1, 3, 3, 3, 3, 3, 3, 3, 3, 1],
  [1, 3, 3, 3, 5, 5, 5, 5, 5, 1],
  [1, 3, 3, 5, 5, 5, 5, 8, 8, 1],
  [1, 3, 5, 5, 5, 5, 8, 10, 10, 1],
  [1, 3, 5, 5, 5, 8, 10, 10, 20, 1],
  [1, 3, 5, 5, 8, 10, 10, 20, 20, 1],
  [1, 3, 5, 8, 10, 10, 20, 10, 20, 1],
  [1, 3, 5, 8, 10, 20, 20, 20, 10, 1],
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
];

// Valeur du calcul, de 1 à 20 : c'est ce que rapporte son écoute
export function calcValue(a: number, b: number): number {
  return VALUES[a - 1]?.[b - 1] ?? 1;
}

// Bonne réponse : deux fois la valeur
export function answerPoints(a: number, b: number): number {
  return 2 * calcValue(a, b);
}

// Réponse fluide (verte) : autant de plus que la bonne réponse
export function fluentBonusPoints(a: number, b: number): number {
  return answerPoints(a, b);
}

// Entrée en Boîte 5 : dix fois la valeur
export function masteryPoints(a: number, b: number): number {
  return 10 * calcValue(a, b);
}

// Ce qu'une réponse vient de rapporter, pour le montrer à l'enfant
export interface EarnedPoints {
  answer: number;
  bonus: number;
  mastery: number;
}

export const NO_POINTS: EarnedPoints = { answer: 0, bonus: 0, mastery: 0 };

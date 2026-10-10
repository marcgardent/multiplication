export type ItemStatus = "unknown" | "discovery" | "review" | "mastered";

export interface MultiplicationItem {
  id: string; // Ex: "2x7", "7x2"
  a: number;
  b: number;
  result: number;
  status: ItemStatus;
  boxLevel: number; // Boîte 0 à 5, voir docs/progression-et-recompenses.md
  giftEarned: boolean; // Cadeau gagné à la première arrivée en Boîte 5 : définitif, jamais repris
  seenCount: number;
  errorCount: number;
  successStreak: number;
  avgResponseTimeMs: number;
  responseTimesMs: number[]; // Historique de tous les temps enregistrés
  lastReviewedAt: number | null;
  nextReviewAt: number | null;
  intervalDays: number;
}

export interface AttemptLog {
  id: string;
  itemId: string;
  a: number;
  b: number;
  mode: "discovery" | "practice" | "time-attack" | "evaluation";
  isCorrect: boolean;
  responseTimeMs: number;
  timestamp: number;
}

export interface SessionConfig {
  durationMinutes: number; // N minutes ; fixe aussi la taille du lot de séance
  pauseBetweenAudioMs: number; // Pause réflexive en mode découverte
}

export interface SessionStats {
  totalAnswered: number;
  correctAnswers: number;
  totalTimeMs: number;
  newDiscovered: number;
  newMastered: number;
}

export interface UserProfile {
  id: string;
  name: string;
  avatar: string; // Emoji animal
  createdAt: number;
}


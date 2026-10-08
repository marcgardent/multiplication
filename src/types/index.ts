export type ItemStatus = "unknown" | "discovery" | "review" | "mastered";

export interface MultiplicationItem {
  id: string; // Ex: "2x7", "7x2"
  a: number;
  b: number;
  result: number;
  status: ItemStatus;
  boxLevel: number; // 0 à 4 pour répétition espacée Leitner
  seenCount: number;
  errorCount: number;
  successStreak: number;
  avgResponseTimeMs: number;
  responseTimesMs: number[]; // Historique de tous les temps enregistrés
  lastReviewedAt: number | null;
  nextReviewAt: number | null;
  intervalDays: number;
  easeFactor: number;
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
  durationMinutes: number; // N minutes
  maxActivePool: number;   // Taille max du pool actif
  newItemsBatch: number;   // T nouveaux items injectés
  reviewThreshold: number; // Seuil max de révision avant de bloquer l injection de nouveaux items
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


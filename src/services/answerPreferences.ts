import type { ListenMode } from "../voices/speechListener";
import { StorageService } from "./storageService";

// Comment l'enfant joue sur cet appareil : avec ou sans le son, au clavier ou à la voix
export interface AnswerPreferences {
  sound: boolean;
  speech: boolean;
}

// Les trois façons de jouer proposées avant une séance
export type AnswerPreset = "quiet" | "sound" | "speech";

export const PRESETS: Record<AnswerPreset, AnswerPreferences> = {
  quiet: { sound: false, speech: false },
  sound: { sound: true, speech: false },
  speech: { sound: true, speech: true }
};

export const ANSWER_PREFERENCES_KEY = "answer_preferences";
// Réglage de l'espace parent : la réponse à voix haute est proposée ou non sur ce téléphone. Propre à chaque appareil :
// l'activer lance l'installation et le test de ce téléphone, un autre téléphone ne l'hérite pas
export const SPEECH_ALLOWED_KEY = "speech_answers_allowed";
// Le modèle vocal a servi sur cet appareil (en 1.7.0, avant l'espace parent, il valait accord du parent)
export const SPEECH_MODEL_WANTED_KEY = "speech_model_wanted";
// Résultat du calibrage : propre à chaque appareil, la vitesse et le micro changent d'un téléphone à l'autre
export const SPEECH_CALIBRATION_KEY = "speech_calibration";
// Façon d'écouter sur cet appareil : bouton à maintenir (par défaut) ou repérage automatique de la parole
export const SPEECH_LISTEN_MODE_KEY = "speech_listen_mode";

export type CalibrationVerdict = "fast" | "slow" | "unusable";

export interface SpeechCalibration {
  at: number;
  // Attente mesurée entre la fin d'une réponse dite et le nombre compris
  latencyMs: number | null;
  // Volumes (moyenne quadratique) de la pièce et de la voix
  noise: number;
  voice: number | null;
  // Seuil le plus bas de la parole sur cet appareil
  floor: number;
  correct: number;
  total: number;
  verdict: CalibrationVerdict;
}
const DEFAULT_PREFERENCES = PRESETS.sound;

// Préréglage correspondant ; la voix sans le son est rangée avec la voix
export function presetOf(preferences: AnswerPreferences): AnswerPreset {
  if (preferences.speech) return "speech";
  return preferences.sound ? "sound" : "quiet";
}

export interface AnswerPreferencesStore {
  // Sans l'accord du parent, la voix est toujours éteinte
  get(): AnswerPreferences;
  set(change: Partial<AnswerPreferences>): void;
  isSpeechAllowed(): boolean;
  setSpeechAllowed(allowed: boolean): void;
  isSpeechModelWanted(): boolean;
  markSpeechModelWanted(): void;
  speechCalibration(): SpeechCalibration | null;
  listenMode(): ListenMode;
  setListenMode(mode: ListenMode): void;
  setSpeechCalibration(calibration: SpeechCalibration): void;
  // Prévient à chaque changement ; renvoie de quoi se désabonner
  subscribe(listener: (preferences: AnswerPreferences) => void): () => void;
}

export function createAnswerPreferences(storage: StorageService): AnswerPreferencesStore {
  let current: AnswerPreferences = { ...DEFAULT_PREFERENCES, ...storage.get<Partial<AnswerPreferences>>(ANSWER_PREFERENCES_KEY, {}) };
  const listeners = new Set<(preferences: AnswerPreferences) => void>();
  // Relu à chaque fois : une fusion avec un autre appareil a pu le changer.
  // Désactivée tant qu'un parent ne l'a pas activée, puisque l'activer télécharge le modèle vocal ;
  // sauf pour une famille qui s'en servait déjà (modèle utilisé avant que ce réglage existe)
  const isSpeechAllowed = () =>
    storage.get<boolean>(SPEECH_ALLOWED_KEY, storage.get<boolean>(SPEECH_MODEL_WANTED_KEY, false));
  const effective = (): AnswerPreferences => ({ ...current, speech: current.speech && isSpeechAllowed() });
  const notify = () => listeners.forEach((listener) => listener(effective()));

  return {
    get: effective,

    set(change) {
      current = { ...current, ...change };
      storage.set(ANSWER_PREFERENCES_KEY, current);
      notify();
    },

    isSpeechAllowed,

    setSpeechAllowed(allowed) {
      storage.set(SPEECH_ALLOWED_KEY, allowed);
      notify();
    },

    isSpeechModelWanted: () => storage.get<boolean>(SPEECH_MODEL_WANTED_KEY, false),

    speechCalibration: () => storage.get<SpeechCalibration | null>(SPEECH_CALIBRATION_KEY, null),

    listenMode: () => storage.get<ListenMode>(SPEECH_LISTEN_MODE_KEY, "hold"),

    setListenMode(mode) {
      storage.set(SPEECH_LISTEN_MODE_KEY, mode);
      notify();
    },

    setSpeechCalibration(calibration) {
      storage.set(SPEECH_CALIBRATION_KEY, calibration);
      notify();
    },

    // Écrit une seule fois
    markSpeechModelWanted() {
      if (!storage.get<boolean>(SPEECH_MODEL_WANTED_KEY, false)) storage.set(SPEECH_MODEL_WANTED_KEY, true);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

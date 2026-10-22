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
// Réglage de l'espace parent : la réponse à voix haute est proposée ou non. Partagé par la sauvegarde avec les autres appareils
export const SPEECH_ALLOWED_KEY = "speech_answers_allowed";
// Le modèle vocal a servi sur un appareil de la famille : partagé par la sauvegarde, un nouveau téléphone le télécharge tout seul
export const SPEECH_MODEL_WANTED_KEY = "speech_model_wanted";
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

    // Écrit une seule fois : chaque écriture part dans la sauvegarde
    markSpeechModelWanted() {
      if (!storage.get<boolean>(SPEECH_MODEL_WANTED_KEY, false)) storage.set(SPEECH_MODEL_WANTED_KEY, true);
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

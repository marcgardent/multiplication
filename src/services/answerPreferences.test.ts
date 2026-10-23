import { describe, expect, it } from "vitest";
import { createAnswerPreferences, PRESETS, presetOf } from "./answerPreferences";
import { familyOf } from "./cloudMerge";
import { createMemoryStorage, STORAGE_NAMESPACE } from "./storageService";

describe("Façon de jouer", () => {
  it("avec le son et au clavier la première fois", () => {
    expect(createAnswerPreferences(createMemoryStorage()).get()).toEqual({ sound: true, speech: false });
  });

  it("la réponse à voix haute attend l'accord du parent, sauf pour une famille qui s'en servait déjà", () => {
    expect(createAnswerPreferences(createMemoryStorage()).isSpeechAllowed()).toBe(false);
    const storage = createMemoryStorage();
    createAnswerPreferences(storage).markSpeechModelWanted();
    expect(createAnswerPreferences(storage).isSpeechAllowed()).toBe(true);
  });

  it("chaque préréglage se retrouve à partir de ses réglages", () => {
    for (const preset of ["quiet", "sound", "speech"] as const) expect(presetOf(PRESETS[preset])).toBe(preset);
    expect(presetOf({ sound: false, speech: true })).toBe("speech");
  });

  it("se souvient du dernier choix et prévient de chaque changement", () => {
    const storage = createMemoryStorage();
    const seen: boolean[] = [];
    const preferences = createAnswerPreferences(storage);
    preferences.setSpeechAllowed(true);
    preferences.subscribe((p) => seen.push(p.speech));
    preferences.set(PRESETS.speech);
    preferences.set({ sound: false });
    expect(createAnswerPreferences(storage).get()).toEqual({ sound: false, speech: true });
    expect(seen).toEqual([true, true]);
  });

  it("sans l'accord du parent, la voix reste éteinte, et revient comme elle était quand il la réautorise", () => {
    const storage = createMemoryStorage();
    const preferences = createAnswerPreferences(storage);
    preferences.setSpeechAllowed(true);
    preferences.set(PRESETS.speech);
    preferences.setSpeechAllowed(false);
    expect(preferences.get()).toEqual({ sound: true, speech: false });
    preferences.set({ speech: true });
    expect(createAnswerPreferences(storage).get().speech).toBe(false);
    preferences.setSpeechAllowed(true);
    expect(preferences.get().speech).toBe(true);
  });

  it("l'accord du parent reste sur ce téléphone : un autre téléphone ne l'hérite pas sans avoir été testé", () => {
    expect(familyOf(`${STORAGE_NAMESPACE}:speech_answers_allowed`)).toBe("phone");
  });

  it("retient une fois pour toutes que le modèle vocal a servi ici, sans le dire aux autres appareils", () => {
    const storage = createMemoryStorage();
    const preferences = createAnswerPreferences(storage);
    expect(preferences.isSpeechModelWanted()).toBe(false);
    preferences.markSpeechModelWanted();
    expect(createAnswerPreferences(storage).isSpeechModelWanted()).toBe(true);
    expect(familyOf(`${STORAGE_NAMESPACE}:speech_model_wanted`)).toBe("phone");
  });

  it("reste propre à l'appareil : la sauvegarde ne la fusionne pas", () => {
    expect(familyOf(`${STORAGE_NAMESPACE}:answer_preferences`)).toBe("device");
  });
});

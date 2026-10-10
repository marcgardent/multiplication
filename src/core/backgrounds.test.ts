import { beforeEach, describe, expect, it, vi } from "vitest";
import { STORAGE_NAMESPACE } from "../services/storageService";
import { BACKGROUNDS, countUnlockedBackgrounds, isBackgroundUnlocked, keepUnlockedBackgrounds } from "./backgrounds";
import { profileKey } from "./profileData";

const byName = (name: string) => BACKGROUNDS.find((bg) => bg.name === name)!;

function setPoints(profileId: string, points: number): void {
  localStorage.setItem(`${STORAGE_NAMESPACE}:${profileKey("points", profileId)}`, JSON.stringify(points));
}

describe("décors", () => {
  beforeEach(() => {
    const data = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key)
    });
  });

  it("propose 14 décors, le premier gratuit, aux seuils strictement croissants", () => {
    expect(BACKGROUNDS).toHaveLength(14);
    expect(BACKGROUNDS[0].pointsRequired).toBe(0);
    for (let i = 1; i < BACKGROUNDS.length; i++) {
      expect(BACKGROUNDS[i].pointsRequired).toBeGreaterThan(BACKGROUNDS[i - 1].pointsRequired);
    }
    expect(new Set(BACKGROUNDS.map((bg) => bg.id)).size).toBe(14);
    expect(new Set(BACKGROUNDS.map((bg) => bg.filename)).size).toBe(14);
  });

  it("débloque un décor quand les points atteignent son seuil", () => {
    keepUnlockedBackgrounds("nouveau");
    expect(isBackgroundUnlocked("nouveau", byName("Été"), 999)).toBe(false);
    expect(isBackgroundUnlocked("nouveau", byName("Été"), 1000)).toBe(true);
    expect(countUnlockedBackgrounds("nouveau", 0)).toBe(1);
    expect(countUnlockedBackgrounds("nouveau", 72000)).toBe(14);
  });

  it("ne reprend pas à un joueur les décors débloqués avec les anciens seuils", () => {
    // 2 300 points donnaient Été, Hiver et Automne ; avec les nouveaux seuils, seulement Été
    setPoints("ancien", 2300);
    keepUnlockedBackgrounds("ancien");

    expect(isBackgroundUnlocked("ancien", byName("Hiver"), 2300)).toBe(true);
    expect(isBackgroundUnlocked("ancien", byName("Automne"), 2300)).toBe(true);
    expect(isBackgroundUnlocked("ancien", byName("Pâques"), 2300)).toBe(false);
    expect(countUnlockedBackgrounds("ancien", 2300)).toBe(4);
  });

  it("ne fige les décors acquis qu'une fois : un joueur créé depuis n'a que les nouveaux seuils", () => {
    keepUnlockedBackgrounds("nouveau");
    setPoints("nouveau", 2300);
    keepUnlockedBackgrounds("nouveau");

    expect(isBackgroundUnlocked("nouveau", byName("Hiver"), 2300)).toBe(false);
    expect(countUnlockedBackgrounds("nouveau", 2300)).toBe(2);
  });
});

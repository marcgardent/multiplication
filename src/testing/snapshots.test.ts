import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMatrixStore, isGiftUnlocked } from "../core/matrixStore";
import { exportProfileData, importProfileData, ProfileData } from "../core/profileData";
import { createMemoryStorage } from "../services/storageService";
import { isTestProfile, rebaseProfileData, ScenarioSnapshot, summarizeProfileData } from "./snapshots";

const DAY_MS = 24 * 3600 * 1000;
// Capture simulée : J21 à 8 h, en UTC comme les scénarios
const CAPTURED_AT = Date.UTC(2026, 0, 26, 8, 0);
const CAPTURED_DAY = Date.UTC(2026, 0, 26);

function snapshotOf(data: ProfileData): ScenarioSnapshot {
  return {
    id: "test",
    order: 0,
    title: "Test",
    day: "J21",
    learner: "",
    description: "",
    checks: [],
    capturedAt: new Date(CAPTURED_AT).toISOString(),
    summary: summarizeProfileData(data, CAPTURED_AT),
    data
  };
}

// Données d'un joueur dont 2 × 3 a été revu à tel instant et sera échu à tel autre
function dataWith(lastReviewedAt: number | null, nextReviewAt: number | null): ProfileData {
  const storage = createMemoryStorage();
  createMatrixStore(storage, "p");
  const data = exportProfileData(storage, "p");
  Object.assign(data.matrix_items.find((i) => i.id === "2x3")!, { lastReviewedAt, nextReviewAt, boxLevel: 4, status: "discovery" });
  return data;
}

function rebasedItem(data: ProfileData, now: Date) {
  return rebaseProfileData(snapshotOf(data), now).matrix_items.find((i) => i.id === "2x3")!;
}

describe("joueur de test", () => {
  it("se reconnaît à son prénom, sans tenir compte des majuscules ni des espaces", () => {
    const profile = { id: "p", avatar: "🦁", createdAt: 0 };
    expect(isTestProfile({ ...profile, name: "@test-ci" })).toBe(true);
    expect(isTestProfile({ ...profile, name: " @Test-CI " })).toBe(true);
    expect(isTestProfile({ ...profile, name: "test-ci" })).toBe(false);
    expect(isTestProfile({ ...profile, name: "Emma" })).toBe(false);
    expect(isTestProfile(null)).toBe(false);
  });
});

describe("recalage d'un snapshot sur aujourd'hui", () => {
  // Chargé un soir d'été, des mois après la capture
  const now = new Date(2026, 6, 14, 18, 30);
  const todayMidnight = new Date(2026, 6, 14).getTime();

  it("place une échéance du jour de capture à minuit aujourd'hui : elle est échue", () => {
    const item = rebasedItem(dataWith(CAPTURED_DAY - 14 * DAY_MS + 8 * 3600 * 1000, CAPTURED_DAY), now);
    expect(item.nextReviewAt).toBe(todayMidnight);
    expect(item.nextReviewAt!).toBeLessThanOrEqual(now.getTime());
  });

  it("place une échéance du lendemain à minuit demain : elle n'est pas échue, quelle que soit l'heure", () => {
    const tomorrowMidnight = new Date(2026, 6, 15).getTime();
    for (const hour of [0, 9, 23]) {
      const at = new Date(2026, 6, 14, hour, 59);
      const item = rebasedItem(dataWith(null, CAPTURED_DAY + DAY_MS), at);
      expect(item.nextReviewAt).toBe(tomorrowMidnight);
      expect(item.nextReviewAt!).toBeGreaterThan(at.getTime());
    }
  });

  it("garde le nombre de jours calendaires à travers un changement d'heure", () => {
    // 14 jours après le 20 mars 2026 : le passage à l'heure d'été du 29 mars est entre les deux
    const item = rebasedItem(dataWith(null, CAPTURED_DAY + 14 * DAY_MS), new Date(2026, 2, 20, 10, 0));
    const expected = new Date(2026, 3, 3);
    expect(new Date(item.nextReviewAt!).getHours()).toBe(0);
    expect(item.nextReviewAt).toBe(expected.getTime());
  });

  it("garde l'écart avec la capture pour un instant qui n'est pas une échéance en jours", () => {
    // Une erreur 4 minutes avant la capture : à revoir 6 minutes après
    const item = rebasedItem(dataWith(CAPTURED_AT - 4 * 60 * 1000, CAPTURED_AT + 6 * 60 * 1000), now);
    expect(item.lastReviewedAt).toBe(now.getTime() - 4 * 60 * 1000);
    expect(item.nextReviewAt).toBe(now.getTime() + 6 * 60 * 1000);
  });

  it("ne met jamais dans le futur ce qui était passé à la capture", () => {
    const data = dataWith(CAPTURED_AT - 1000, CAPTURED_DAY);
    data.attempt_history = [
      { id: "a", itemId: "2x3", a: 2, b: 3, mode: "practice", isCorrect: true, responseTimeMs: 3000, timestamp: CAPTURED_AT - 1000 }
    ];
    // Chargé à 1 h du matin, avant l'heure simulée de la capture
    const early = new Date(2026, 6, 14, 1, 0);
    const rebased = rebaseProfileData(snapshotOf(data), early);
    expect(rebased.attempt_history[0].timestamp).toBeLessThanOrEqual(early.getTime());
    expect(rebased.matrix_items.find((i) => i.id === "2x3")!.lastReviewedAt!).toBeLessThanOrEqual(early.getTime());
  });

  it("ramène la date de la roue à aujourd'hui", () => {
    const data = dataWith(null, null);
    data.wheel_spins = { date: "2026-1-26", usedSpins: 3 };
    expect(rebaseProfileData(snapshotOf(data), now).wheel_spins).toEqual({ date: "2026-7-14", usedSpins: 3 });

    data.wheel_spins = { date: "2026-1-25", usedSpins: 3 };
    expect(rebaseProfileData(snapshotOf(data), now).wheel_spins!.date).toBe("2026-7-13");
  });

  it("ne modifie pas le snapshot d'origine", () => {
    const snapshot = snapshotOf(dataWith(CAPTURED_AT - 1000, CAPTURED_DAY));
    const copy = JSON.stringify(snapshot);
    rebaseProfileData(snapshot, now);
    expect(JSON.stringify(snapshot)).toBe(copy);
  });
});

describe("injection des données d'un joueur", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 5, 10, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("remplace toute la progression du profil cible et se relit avec reload()", () => {
    // Un joueur source avec des points, un cadeau ouvert et des tours de roue utilisés
    const sourceStorage = createMemoryStorage();
    const source = createMatrixStore(sourceStorage, "source");
    source.recordAttempt(2, 3, "discovery", true, 0);
    source.recordAttempt(2, 3, "practice", true, 3000);
    source.openGift("2x3");
    source.useWheelSpin();
    const data = exportProfileData(sourceStorage, "source");

    // Un profil cible qui avait déjà sa propre progression
    const targetStorage = createMemoryStorage();
    const target = createMatrixStore(targetStorage, "cible");
    target.recordAttempt(9, 9, "practice", false, 3000);
    target.useWheelSpin();
    target.useWheelSpin();

    importProfileData(targetStorage, "cible", data);
    target.reload();

    expect(target.getPoints()).toBe(source.getPoints());
    expect(target.getByFactors(2, 3)!.boxLevel).toBe(1);
    expect(target.getByFactors(9, 9)!.status).toBe("unknown");
    expect(target.getOpenedGifts()).toEqual(["2x3"]);
    expect(target.getHistory()).toHaveLength(2);
    expect(target.getDailyWheelSpinsLeft()).toBe(2);
    expect(exportProfileData(targetStorage, "cible")).toEqual(data);
  });

  it("efface ce que le jeu de données ne contient pas", () => {
    const storage = createMemoryStorage();
    const store = createMatrixStore(storage, "cible");
    store.useWheelSpin();
    const fresh = exportProfileData(createMemoryStorageWithStore(), "vide");

    importProfileData(storage, "cible", fresh);
    store.reload();

    expect(store.getDailyWheelSpinsLeft()).toBe(3);
    expect(store.getAll().every((i) => !isGiftUnlocked(i))).toBe(true);
  });
});

function createMemoryStorageWithStore() {
  const storage = createMemoryStorage();
  createMatrixStore(storage, "vide");
  return storage;
}

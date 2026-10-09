import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StorageService } from "../services/storageService";
import { SessionConfig } from "../types";
import { createMatrixStore, isGiftUnlocked, MatrixStore } from "./matrixStore";
import { createRepetitionEngine } from "./repetitionEngine";

// Réponse ni rapide ni lente : n'allonge ni ne raccourcit les intervalles
const NEUTRAL_MS = 3000;
const SLOW_MS = 5000;

function createMemoryStorage(): StorageService {
  const data = new Map<string, string>();
  return {
    get<T>(key: string, defaultValue: T): T {
      const raw = data.get(key);
      return raw === undefined ? defaultValue : (JSON.parse(raw) as T);
    },
    set<T>(key: string, value: T): void {
      data.set(key, JSON.stringify(value));
    },
    remove(key: string): void {
      data.delete(key);
    },
    clear(): void {
      data.clear();
    }
  };
}

// Se place au jour J+day de la première séance, à l'heure donnée
function goTo(day: number, hour = 10, minute = 0): void {
  vi.setSystemTime(new Date(2026, 0, 5 + day, hour, minute, 0));
}

function listen(store: MatrixStore, a: number, b: number): void {
  store.recordAttempt(a, b, "discovery", true, 0);
}

function answer(store: MatrixStore, a: number, b: number, isCorrect = true, timeMs = NEUTRAL_MS): void {
  store.recordAttempt(a, b, "practice", isCorrect, timeMs);
}

function sessionConfig(durationMinutes: number): SessionConfig {
  return { durationMinutes, pauseBetweenAudioMs: 0 };
}

describe("règle de progression", () => {
  let store: MatrixStore;

  beforeEach(() => {
    vi.useFakeTimers();
    goTo(0);
    store = createMatrixStore(createMemoryStorage(), "test");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ne fait monter qu'un palier quand un calcul est réussi plusieurs fois dans la même séance", () => {
    listen(store, 2, 3);
    goTo(0, 10, 1);
    answer(store, 2, 3);
    goTo(0, 10, 2);
    answer(store, 2, 3);
    goTo(0, 10, 3);
    answer(store, 2, 3);

    const item = store.getByFactors(2, 3)!;
    expect(item.boxLevel).toBe(1);
    expect(item.status).toBe("discovery");
    expect(item.successStreak).toBe(3);
  });

  it("mène à la maîtrise par des réussites à J0, J1, J4 et J11", () => {
    listen(store, 2, 3);
    answer(store, 2, 3);
    expect(store.getByFactors(2, 3)!.boxLevel).toBe(1);

    goTo(1, 17);
    answer(store, 2, 3);
    expect(store.getByFactors(2, 3)!.boxLevel).toBe(2);

    goTo(4, 8);
    answer(store, 2, 3);
    expect(store.getByFactors(2, 3)!.boxLevel).toBe(3);
    expect(store.getByFactors(2, 3)!.status).toBe("discovery");

    goTo(11);
    answer(store, 2, 3);
    expect(store.getByFactors(2, 3)!.boxLevel).toBe(4);
    expect(store.getByFactors(2, 3)!.status).toBe("mastered");
  });

  it("compte la séance du jour prévu quelle que soit l'heure", () => {
    goTo(0, 18);
    listen(store, 2, 3);
    answer(store, 2, 3);

    // Le lendemain matin, moins de 24 h plus tard
    goTo(1, 8);
    answer(store, 2, 3);
    expect(store.getByFactors(2, 3)!.boxLevel).toBe(2);
  });

  it("ignore une réussite arrivée avant l'échéance", () => {
    listen(store, 2, 3);
    answer(store, 2, 3);
    goTo(1);
    answer(store, 2, 3);

    // Prochaine échéance à J4 : une réussite à J2 n'y change rien
    goTo(2);
    answer(store, 2, 3);
    expect(store.getByFactors(2, 3)!.boxLevel).toBe(2);
  });

  it("attend 10 minutes après une erreur avant de laisser remonter", () => {
    listen(store, 2, 3);
    answer(store, 2, 3, false);
    expect(store.getByFactors(2, 3)!.status).toBe("review");

    goTo(0, 10, 5);
    answer(store, 2, 3);
    expect(store.getByFactors(2, 3)!.boxLevel).toBe(0);
    expect(store.getByFactors(2, 3)!.status).toBe("review");

    goTo(0, 10, 11);
    answer(store, 2, 3);
    expect(store.getByFactors(2, 3)!.boxLevel).toBe(1);
    expect(store.getByFactors(2, 3)!.status).toBe("discovery");
  });

  it("rejoue le palier des 7 jours quand la réponse est lente", () => {
    listen(store, 2, 3);
    answer(store, 2, 3);
    goTo(1);
    answer(store, 2, 3);
    goTo(4);
    answer(store, 2, 3);

    goTo(11);
    answer(store, 2, 3, true, SLOW_MS);
    expect(store.getByFactors(2, 3)!.boxLevel).toBe(3);
    expect(store.getByFactors(2, 3)!.status).toBe("discovery");
  });

  it("débloque le cadeau à la réussite du lendemain et le garde après une erreur", () => {
    listen(store, 2, 3);
    answer(store, 2, 3);
    expect(isGiftUnlocked(store.getByFactors(2, 3)!)).toBe(false);

    goTo(1);
    answer(store, 2, 3);
    expect(isGiftUnlocked(store.getByFactors(2, 3)!)).toBe(true);

    goTo(4);
    answer(store, 2, 3, false);
    expect(store.getByFactors(2, 3)!.boxLevel).toBe(0);
    expect(isGiftUnlocked(store.getByFactors(2, 3)!)).toBe(true);
  });
});

describe("lot de séance", () => {
  let store: MatrixStore;

  beforeEach(() => {
    vi.useFakeTimers();
    goTo(0);
    store = createMatrixStore(createMemoryStorage(), "test");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Écoute puis réussit les `count` premiers calculs de la table de 1, à J0
  function learnFirstItems(count: number): void {
    for (let b = 1; b <= count; b++) {
      listen(store, 1, b);
      answer(store, 1, b);
    }
  }

  it("complète la toute première séance à 4 calculs, tous à écouter", () => {
    const engine = createRepetitionEngine(store, sessionConfig(3));
    const lot = engine.startSession();

    expect(lot.items.map((i) => i.id)).toEqual(["1x1", "1x2", "1x3", "1x4"]);
    expect(engine.getDiscoveryItems()).toHaveLength(4);
  });

  it("prend les révisions du jour puis 2 nouveaux pour 3 minutes", () => {
    learnFirstItems(4);
    goTo(1);

    const engine = createRepetitionEngine(store, sessionConfig(3));
    const lot = engine.startSession();

    expect(lot.reviewCount).toBe(4);
    expect(lot.newCount).toBe(2);
    expect(lot.items.map((i) => i.id)).toEqual(["1x1", "1x2", "1x3", "1x4", "1x5", "1x6"]);
  });

  it("ne fait écouter que les nouveaux, pas les révisions échues", () => {
    learnFirstItems(4);
    goTo(1);

    const engine = createRepetitionEngine(store, sessionConfig(3));
    engine.startSession();

    expect(engine.getDiscoveryItems().map((i) => i.id)).toEqual(["1x5", "1x6"]);
    expect(engine.getNextDiscovery().id).toBe("1x5");
    expect(engine.getNextDiscovery().id).toBe("1x6");
    expect(engine.getNextDiscovery().id).toBe("1x5");
  });

  it("n'ajoute aucun nouveau quand les révisions remplissent le lot", () => {
    learnFirstItems(6);
    goTo(1);

    const engine = createRepetitionEngine(store, sessionConfig(3));
    const lot = engine.startSession();

    expect(lot.reviewCount).toBe(6);
    expect(lot.newCount).toBe(0);
    expect(engine.getDiscoveryItems()).toHaveLength(0);
    expect(engine.isReviewQueueOverloaded()).toBe(true);
    expect(engine.getQueueStats().nextSessionNewCount).toBe(0);
  });

  it("propose 8 nouveaux pour 15 minutes", () => {
    const engine = createRepetitionEngine(store, sessionConfig(15));
    expect(engine.startSession().newCount).toBe(8);
  });

  it("garde le même lot pendant toute la séance", () => {
    learnFirstItems(4);
    goTo(1);

    const engine = createRepetitionEngine(store, sessionConfig(3));
    const lotIds = engine.startSession().items.map((i) => i.id);

    for (let i = 0; i < 60; i++) {
      const question = engine.getNextQuestion();
      expect(lotIds).toContain(question.id);
      engine.registerResult(question, "practice", true, NEUTRAL_MS);
    }

    // Les 94 calculs hors lot sont restés intacts
    expect(store.getAll().filter((i) => i.seenCount === 0)).toHaveLength(94);
    expect(store.getCountsByStatus().mastered).toBe(0);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryStorage, StorageService } from "../services/storageService";
import { MultiplicationItem, SessionConfig } from "../types";
import { createMatrixStore, GIFT_OPEN_POINTS, isGiftUnlocked, MatrixStore } from "./matrixStore";
import { profileKey } from "./profileData";
import { createRepetitionEngine } from "./repetitionEngine";

// Réponse fluide (verte) ; la vitesse n'allonge ni ne raccourcit les intervalles
const NEUTRAL_MS = 3000;
// Plus de vert dans l'échelle de vitesse : 5 s tout juste
const SLOW_MS = 5000;

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

// Jours de révision d'un calcul réussi pour la première fois à J0
const REVIEW_DAYS = [1, 3, 7, 21];

// Amène 2 × 3 dans la boîte voulue par des réussites aux jours prévus, et renvoie le jour de la prochaine échéance
function reachBox(store: MatrixStore, box: number): number {
  goTo(0);
  listen(store, 2, 3);
  if (box === 0) return 0;
  answer(store, 2, 3);
  for (let i = 0; i < box - 1; i++) {
    goTo(REVIEW_DAYS[i]);
    answer(store, 2, 3);
  }
  expect(store.getByFactors(2, 3)!.boxLevel).toBe(box);
  return box === 5 ? 42 : REVIEW_DAYS[box - 1];
}

function item(store: MatrixStore): MultiplicationItem {
  return store.getByFactors(2, 3)!;
}

function dayOf(timestamp: number | null): number {
  return Math.round((timestamp! - new Date(2026, 0, 5).getTime()) / (24 * 3600 * 1000));
}

describe("graphe des boîtes (docs/progression-et-recompenses.md)", () => {
  let store: MatrixStore;

  beforeEach(() => {
    vi.useFakeTimers();
    goTo(0);
    store = createMatrixStore(createMemoryStorage(), "test");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Boîte 0", () => {
    it("écoute : reste en Boîte 0, échu tout de suite", () => {
      listen(store, 2, 3);
      expect(item(store).boxLevel).toBe(0);
      expect(item(store).status).toBe("discovery");
      expect(store.isItemDue(item(store))).toBe(true);
    });

    it("échec : reste en Boîte 0, à revoir dans 10 minutes", () => {
      listen(store, 2, 3);
      answer(store, 2, 3, false);
      expect(item(store).boxLevel).toBe(0);
      expect(item(store).status).toBe("review");
      expect(item(store).nextReviewAt).toBe(Date.now() + 10 * 60 * 1000);
    });

    it("réussite moins de 10 min après un échec : reste en Boîte 0", () => {
      listen(store, 2, 3);
      answer(store, 2, 3, false);
      goTo(0, 10, 5);
      answer(store, 2, 3);
      expect(item(store).boxLevel).toBe(0);
      expect(item(store).status).toBe("review");
    });

    it("réussite : monte en Boîte 1, à revoir à J1", () => {
      listen(store, 2, 3);
      answer(store, 2, 3);
      expect(item(store).boxLevel).toBe(1);
      expect(dayOf(item(store).nextReviewAt)).toBe(1);
    });

    it("réussite 10 min après un échec : monte en Boîte 1", () => {
      listen(store, 2, 3);
      answer(store, 2, 3, false);
      goTo(0, 10, 11);
      answer(store, 2, 3);
      expect(item(store).boxLevel).toBe(1);
      expect(item(store).status).toBe("discovery");
    });

    it("réussite sans écoute préalable : monte en Boîte 1", () => {
      store.recordAttempt(2, 3, "evaluation", true, NEUTRAL_MS);
      expect(item(store).boxLevel).toBe(1);
    });
  });

  // Boîtes 1 à 3 : même schéma, seule l'attente change
  describe.each([
    { box: 1, nextReviewDay: 3 },
    { box: 2, nextReviewDay: 7 },
    { box: 3, nextReviewDay: 21 }
  ])("Boîte $box", ({ box, nextReviewDay }) => {
    it(`réussite à l'échéance : monte en Boîte ${box + 1}, à revoir à J${nextReviewDay}`, () => {
      goTo(reachBox(store, box));
      answer(store, 2, 3);
      expect(item(store).boxLevel).toBe(box + 1);
      expect(item(store).status).toBe("discovery");
      expect(dayOf(item(store).nextReviewAt)).toBe(nextReviewDay);
    });

    it("réussite à l'échéance, même lente ou très rapide : même boîte d'arrivée, même échéance", () => {
      goTo(reachBox(store, box));
      answer(store, 2, 3, true, SLOW_MS);
      expect(item(store).boxLevel).toBe(box + 1);
      expect(dayOf(item(store).nextReviewAt)).toBe(nextReviewDay);
    });

    it("réussite avant l'échéance : ni la boîte ni l'échéance ne changent", () => {
      const dueDay = reachBox(store, box);
      const before = item(store).nextReviewAt;
      goTo(dueDay - 1, 23, 59);
      answer(store, 2, 3);
      expect(item(store).boxLevel).toBe(box);
      expect(item(store).nextReviewAt).toBe(before);
    });

    it("échec : retour en Boîte 0, à revoir dans 10 minutes", () => {
      goTo(reachBox(store, box));
      answer(store, 2, 3, false);
      expect(item(store).boxLevel).toBe(0);
      expect(item(store).status).toBe("review");
      expect(item(store).nextReviewAt).toBe(Date.now() + 10 * 60 * 1000);
    });

    it("échec avant l'échéance : retour en Boîte 0 aussi", () => {
      goTo(reachBox(store, box) - 1, 23, 59);
      answer(store, 2, 3, false);
      expect(item(store).boxLevel).toBe(0);
    });
  });

  describe("Boîte 4", () => {
    it("réussite fluide à l'échéance (J21) : monte en Boîte 5, maîtrisé, cadeau gagné ; 2 × 3 (valeur 3) rapporte 6, +6 de rapidité, +30", () => {
      goTo(reachBox(store, 4));
      const pointsBefore = store.getPoints();
      expect(store.recordAttempt(2, 3, "practice", true, NEUTRAL_MS)).toEqual({ answer: 6, bonus: 6, mastery: 30 });
      expect(item(store).boxLevel).toBe(5);
      expect(item(store).status).toBe("mastered");
      expect(isGiftUnlocked(item(store))).toBe(true);
      expect(store.getPoints() - pointsBefore).toBe(6 + 6 + 30);
      expect(dayOf(item(store).nextReviewAt)).toBe(42);
    });

    it("réussite en 4,9 s à l'échéance : encore fluide (vert), monte en Boîte 5", () => {
      goTo(reachBox(store, 4));
      answer(store, 2, 3, true, SLOW_MS - 100);
      expect(item(store).boxLevel).toBe(5);
      expect(isGiftUnlocked(item(store))).toBe(true);
    });

    it("réussite lente à l'échéance : reste en Boîte 4, revient le lendemain, sans cadeau", () => {
      goTo(reachBox(store, 4));
      answer(store, 2, 3, true, SLOW_MS);
      expect(item(store).boxLevel).toBe(4);
      expect(item(store).status).toBe("discovery");
      expect(isGiftUnlocked(item(store))).toBe(false);
      expect(dayOf(item(store).nextReviewAt)).toBe(22);

      goTo(22);
      answer(store, 2, 3);
      expect(item(store).boxLevel).toBe(5);
      expect(isGiftUnlocked(item(store))).toBe(true);
    });

    it("réussite avant l'échéance : ni la boîte ni l'échéance ne changent, pas de cadeau à J20", () => {
      reachBox(store, 4);
      const before = item(store).nextReviewAt;
      goTo(20, 23, 59);
      answer(store, 2, 3);
      expect(item(store).boxLevel).toBe(4);
      expect(item(store).nextReviewAt).toBe(before);
      expect(isGiftUnlocked(item(store))).toBe(false);
    });

    it("échec : retour en Boîte 0", () => {
      goTo(reachBox(store, 4));
      answer(store, 2, 3, false);
      expect(item(store).boxLevel).toBe(0);
      expect(item(store).status).toBe("review");
      expect(isGiftUnlocked(item(store))).toBe(false);
    });
  });

  describe("Boîte 5", () => {
    it("réussite à l'échéance (J42) : reste en Boîte 5, prochaine révision 21 jours plus tard", () => {
      goTo(reachBox(store, 5));
      answer(store, 2, 3, true, SLOW_MS);
      expect(item(store).boxLevel).toBe(5);
      expect(item(store).status).toBe("mastered");
      expect(dayOf(item(store).nextReviewAt)).toBe(63);
    });

    it("réussite avant l'échéance : ni la boîte ni l'échéance ne changent", () => {
      reachBox(store, 5);
      const before = item(store).nextReviewAt;
      goTo(30);
      answer(store, 2, 3);
      expect(item(store).boxLevel).toBe(5);
      expect(item(store).nextReviewAt).toBe(before);
    });

    it("échec : retour en Boîte 0, le cadeau reste gagné", () => {
      goTo(reachBox(store, 5));
      answer(store, 2, 3, false);
      expect(item(store).boxLevel).toBe(0);
      expect(item(store).status).toBe("review");
      expect(isGiftUnlocked(item(store))).toBe(true);
    });
  });
});

describe("calendrier et cadeau", () => {
  let storage: StorageService;
  let store: MatrixStore;

  beforeEach(() => {
    vi.useFakeTimers();
    goTo(0);
    storage = createMemoryStorage();
    store = createMatrixStore(storage, "test");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("points selon le calcul : écoute = sa valeur, bonne réponse = deux fois, bonus seulement en moins de 5 s, rien pour une erreur", () => {
    expect(store.recordAttempt(7, 8, "discovery", true, 0)).toEqual({ answer: 20, bonus: 0, mastery: 0 });
    goTo(0, 10, 1);
    expect(store.recordAttempt(7, 8, "practice", true, 4999)).toEqual({ answer: 40, bonus: 40, mastery: 0 });
    goTo(0, 10, 2);
    expect(store.recordAttempt(7, 8, "practice", true, 5000)).toEqual({ answer: 40, bonus: 0, mastery: 0 });
    goTo(0, 10, 3);
    expect(store.recordAttempt(7, 8, "practice", false, 2000)).toEqual({ answer: 0, bonus: 0, mastery: 0 });
    expect(store.getPoints()).toBe(20 + 80 + 40);
    expect(store.recordAttempt(1, 4, "discovery", true, 0)).toEqual({ answer: 1, bonus: 0, mastery: 0 });
  });

  it("ne fait monter que d'une boîte quand un calcul est réussi plusieurs fois dans la même séance", () => {
    listen(store, 2, 3);
    goTo(0, 10, 1);
    answer(store, 2, 3);
    goTo(0, 10, 2);
    answer(store, 2, 3);
    goTo(0, 10, 3);
    answer(store, 2, 3);

    expect(item(store).boxLevel).toBe(1);
    expect(item(store).successStreak).toBe(3);
  });

  it("donne le cadeau le 21e jour, et pas avant, par des réussites à J0, J1, J3, J7 et J21", () => {
    listen(store, 2, 3);
    answer(store, 2, 3);
    for (const day of [1, 3, 7]) {
      goTo(day);
      answer(store, 2, 3);
      expect(isGiftUnlocked(item(store))).toBe(false);
    }
    expect(item(store).boxLevel).toBe(4);

    goTo(21);
    answer(store, 2, 3);
    expect(item(store).boxLevel).toBe(5);
    expect(isGiftUnlocked(item(store))).toBe(true);
  });

  it("compte la séance du jour prévu quelle que soit l'heure", () => {
    goTo(0, 18);
    listen(store, 2, 3);
    answer(store, 2, 3);

    // Le lendemain matin, moins de 24 h plus tard
    goTo(1, 8);
    answer(store, 2, 3);
    expect(item(store).boxLevel).toBe(2);
  });

  it("repart du début après un échec : le cadeau vient 21 jours après la nouvelle première réussite", () => {
    goTo(reachBox(store, 3));
    answer(store, 2, 3, false);
    goTo(7, 10, 11);
    answer(store, 2, 3);
    expect(item(store).boxLevel).toBe(1);

    for (const day of [8, 10, 14]) {
      goTo(day);
      answer(store, 2, 3);
    }
    goTo(27);
    answer(store, 2, 3);
    expect(isGiftUnlocked(item(store))).toBe(false);

    goTo(28);
    answer(store, 2, 3);
    expect(isGiftUnlocked(item(store))).toBe(true);
  });

  it("ne reprend jamais un cadeau gagné, ouvert ou non, quoi qu'il arrive ensuite", () => {
    goTo(reachBox(store, 5));
    store.openGift("2x3");
    store.addPoints(GIFT_OPEN_POINTS);

    answer(store, 2, 3, false);
    goTo(43);
    answer(store, 2, 3, false);
    expect(item(store).boxLevel).toBe(0);
    expect(isGiftUnlocked(item(store))).toBe(true);
    expect(store.getOpenedGifts()).toContain("2x3");

    // Toujours là après relecture du stockage
    const reopened = createMatrixStore(storage, "test");
    expect(isGiftUnlocked(reopened.getByFactors(2, 3)!)).toBe(true);
    expect(reopened.getOpenedGifts()).toContain("2x3");
  });

  it("garde les cadeaux gagnés avec l'ancienne règle, ouverts ou non", () => {
    // Données enregistrées avant la Boîte 5 : cadeau dès la Boîte 2, maîtrise en Boîte 4
    const legacy = store.getAll().map((i) => {
      const { giftEarned: _dropped, ...rest } = i;
      return { ...rest, bestBoxLevel: 0, easeFactor: 2.5 };
    });
    Object.assign(legacy.find((i) => i.id === "2x3")!, { boxLevel: 0, bestBoxLevel: 2, status: "review" });
    Object.assign(legacy.find((i) => i.id === "2x4")!, { boxLevel: 4, bestBoxLevel: 4, status: "mastered" });
    Object.assign(legacy.find((i) => i.id === "2x5")!, { boxLevel: 1, bestBoxLevel: 1, status: "discovery" });
    storage.set(profileKey("matrix_items", "ancien"), legacy);
    storage.set(profileKey("opened_gifts", "ancien"), ["2x4"]);

    const migrated = createMatrixStore(storage, "ancien");
    expect(isGiftUnlocked(migrated.getByFactors(2, 3)!)).toBe(true);
    expect(isGiftUnlocked(migrated.getByFactors(2, 4)!)).toBe(true);
    expect(isGiftUnlocked(migrated.getByFactors(2, 5)!)).toBe(false);
    expect(migrated.getOpenedGifts()).toEqual(["2x4"]);
    // La maîtrise demande maintenant la révision de J21
    expect(migrated.getByFactors(2, 4)!.status).toBe("discovery");
    expect(migrated.getByFactors(2, 4)!.boxLevel).toBe(4);
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

  it("fait toujours passer la révision du 21e jour, même quand les révisions débordent du lot", () => {
    // 2 × 3 arrive à sa révision de J21 en Boîte 4
    listen(store, 2, 3);
    answer(store, 2, 3);
    for (const day of [1, 3, 7]) {
      goTo(day);
      answer(store, 2, 3);
    }
    // La veille, 8 autres calculs sont appris : ils sont tous à revoir à J21, plus que les 6 places du lot
    goTo(20);
    for (let b = 1; b <= 8; b++) {
      listen(store, 1, b);
      answer(store, 1, b);
    }
    goTo(21);

    const engine = createRepetitionEngine(store, sessionConfig(3));
    const lot = engine.startSession();

    expect(lot.items).toHaveLength(6);
    expect(lot.items[0].id).toBe("2x3");
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
    expect(store.getAll().every((i) => i.boxLevel <= 2)).toBe(true);
  });

  it("pioche les nouveaux calculs selon l'ordre personnalisé des tables", () => {
    store.setLearningTables([2, 5, 10]);
    const engine = createRepetitionEngine(store, sessionConfig(3));
    const lot = engine.startSession();

    // 4 calculs au départ (lot minimum) : ils viennent tous de la Table de 2
    expect(lot.items.map((i) => i.id)).toEqual(["2x1", "2x2", "2x3", "2x4"]);
    expect(engine.getQueueStats().newAvailableCount).toBe(30); // 3 tables de 10 calculs
  });

  it("enchaîne sur la table suivante dans l'ordre dès que la précédente est épuisée", () => {
    store.setLearningTables([2, 5]);
    // On apprend les 10 calculs de la Table de 2 le jour même (pas encore à réviser)
    for (let b = 1; b <= 10; b++) {
      listen(store, 2, b);
      answer(store, 2, b);
    }

    const engine = createRepetitionEngine(store, sessionConfig(3));
    const lot = engine.startSession();

    // Les nouveaux calculs viennent maintenant de la Table de 5
    expect(lot.news.map((i) => i.id)).toEqual(["5x1", "5x2"]);
    expect(engine.getQueueStats().newAvailableCount).toBe(10); // 10 inconnus dans la table de 5 avant d'avoir joué
  });

  it("répartit les nouveaux calculs entre deux tables quand la première n'en a plus assez", () => {
    store.setLearningTables([2, 5]);
    // On apprend 8 calculs de la Table de 2 le jour même (il reste 2x9 et 2x10)
    for (let b = 1; b <= 8; b++) {
      listen(store, 2, b);
      answer(store, 2, b);
    }

    const engine = createRepetitionEngine(store, sessionConfig(6)); // règle pour 6 min : jusqu'à 4 nouveaux
    const lot = engine.startSession();

    // Prend les 2 restants de la Table de 2 puis 2 de la Table de 5
    expect(lot.news.map((i) => i.id)).toEqual(["2x9", "2x10", "5x1", "5x2"]);
  });

  it("ne pioche aucun nouveau calcul hors des tables autorisées une fois celles-ci maîtrisées", () => {
    store.setLearningTables([2]);
    for (let b = 1; b <= 10; b++) {
      listen(store, 2, b);
      answer(store, 2, b);
    }
    goTo(1);

    const engine = createRepetitionEngine(store, sessionConfig(3));
    const lot = engine.startSession();

    expect(lot.newCount).toBe(0);
    expect(engine.getQueueStats().newAvailableCount).toBe(0);
  });
});

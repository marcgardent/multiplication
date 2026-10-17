import { describe, expect, it } from "vitest";
import { createMemoryStorage, StorageService } from "../services/storageService";
import { MultiplicationItem } from "../types";
import { guidedLabel, guidedPool, guidedRounds, MIN_GUIDED_POOL, PlayerProgress, readPlayerProgress } from "./guidedPool";
import { calculationId } from "./spacedSchedule";

const NOW = Date.UTC(2026, 9, 17, 12);
const DAY = 24 * 3600 * 1000;

function item(id: string, fields: Partial<MultiplicationItem> = {}): MultiplicationItem {
  const [a, b] = id.split("x").map(Number);
  return {
    id,
    a,
    b,
    result: a * b,
    status: "discovery",
    boxLevel: 1,
    giftEarned: false,
    seenCount: 1,
    errorCount: 0,
    successStreak: 1,
    avgResponseTimeMs: 0,
    responseTimesMs: [],
    lastReviewedAt: NOW - DAY,
    nextReviewAt: NOW + DAY,
    intervalDays: 1,
    ...fields
  };
}

const failed = (id: string) => item(id, { status: "review", boxLevel: 0, nextReviewAt: NOW + 600000 });
const due = (id: string, boxLevel = 3) => item(id, { boxLevel, nextReviewAt: NOW - 1000 });
const settled = (id: string, inDays = 5) => item(id, { boxLevel: 3, nextReviewAt: NOW + inDays * DAY });

// Les tables en pause valent « tout est déjà abordé » : aucun prochain nouveau calcul ne vient brouiller le test
function player(items: MultiplicationItem[], learningTables: number[] = []): PlayerProgress {
  return { items, learningTables };
}

const ids = (pool: ReturnType<typeof guidedPool>) => pool.map((entry) => calculationId(entry.calc));

describe("Pool de l'écoute guidée", () => {
  it("classe raté, puis révision échue, puis en cours d'apprentissage", () => {
    const lea = player([item("6x4"), due("9x9"), failed("7x8"), item("2x2", { boxLevel: 2 }), item("3x3", { boxLevel: 0 })]);
    const pool = guidedPool([lea], NOW);
    expect(pool.map((e) => [calculationId(e.calc), e.rank])).toEqual([
      ["7x8", 1],
      ["9x9", 2],
      ["6x4", 3],
      ["2x2", 3],
      ["3x3", 3]
    ]);
  });

  it("garde le meilleur rang d'un calcul parmi les joueurs, et fait passer devant ce qui sert à plusieurs : l'exemple de la documentation", () => {
    const lea = player([failed("7x8")]);
    const tom = player([due("7x8"), item("6x4")]);
    const pool = guidedPool([lea, tom], NOW);
    expect(pool.slice(0, 2)).toEqual([
      { calc: { a: 7, b: 8, result: 56 }, rank: 1, playerCount: 2 },
      { calc: { a: 6, b: 4, result: 24 }, rank: 3, playerCount: 1 }
    ]);
  });

  it("à rang égal, le calcul de plusieurs joueurs passe devant", () => {
    const pool = guidedPool([player([item("2x5"), item("3x3")]), player([item("3x3")])], NOW);
    expect(ids(pool).slice(0, 2)).toEqual(["3x3", "2x5"]);
  });

  it("laisse hors du pool les calculs de Boîte 3 à 5 pas encore échus quand le pool est assez grand", () => {
    const learning = ["2x1", "2x2", "2x3", "2x4", "2x5", "2x6"].map((id) => item(id));
    const pool = guidedPool([player([...learning, settled("8x8"), item("9x9", { boxLevel: 5, status: "mastered", nextReviewAt: NOW + 20 * DAY })])], NOW);
    expect(ids(pool)).not.toContain("8x8");
    expect(ids(pool)).not.toContain("9x9");
  });

  it("ajoute les 2 prochains nouveaux calculs de l'ordre du carnet, sans les tables en pause", () => {
    // Ordre 5 puis 3 ; 5 × 1 déjà vu, la table de 2 en pause
    const pool = guidedPool([player([item("5x1")], [5, 3])], NOW);
    expect(ids(pool)).toContain("5x2");
    expect(ids(pool)).toContain("5x3");
    expect(ids(pool)).not.toContain("5x4");
    expect(ids(pool).some((id) => id.startsWith("2x"))).toBe(false);
  });

  it("passe à la table suivante du carnet quand la première est déjà abordée", () => {
    const fives = Array.from({ length: 10 }, (_, i) => item(`5x${i + 1}`));
    const pool = guidedPool([player(fives, [5, 3])], NOW);
    expect(ids(pool)).toContain("3x1");
    expect(ids(pool)).toContain("3x2");
  });

  it("un joueur qui n'a encore rien fait écoute les deux premiers calculs de son carnet", () => {
    const pool = guidedPool([player([], [1, 10, 2])], NOW);
    expect(ids(pool)).toEqual(["1x1", "1x2"]);
  });

  it("complète un petit pool par les calculs de Boîte 3 à 5 les plus proches de leur échéance", () => {
    const settledItems = [settled("8x1", 9), settled("8x2", 2), settled("8x3", 4), settled("8x4", 1), settled("8x5", 7), settled("8x6", 3)];
    const pool = guidedPool([player([failed("7x8"), ...settledItems])], NOW);
    expect(pool).toHaveLength(MIN_GUIDED_POOL);
    expect(ids(pool)).toEqual(["7x8", "8x4", "8x2", "8x6", "8x3", "8x5"]);
    expect(pool.slice(1).every((entry) => entry.rank === 4)).toBe(true);
  });

  it("est vide quand les joueurs n'ont rien à revoir ni rien à découvrir", () => {
    expect(guidedPool([player([])], NOW)).toEqual([]);
  });

  it("ne modifie pas les données des joueurs", () => {
    const lea = player([failed("7x8"), due("9x9"), settled("8x8")], [2]);
    const before = JSON.stringify(lea);
    guidedPool([lea], NOW);
    expect(JSON.stringify(lea)).toBe(before);
  });

  it("lit un joueur sans rien écrire dans le stockage", () => {
    const memory = createMemoryStorage();
    let writes = 0;
    const storage: StorageService = {
      ...memory,
      set: (key, value) => {
        writes++;
        memory.set(key, value);
      },
      remove: () => {
        writes++;
      }
    };
    const progress = readPlayerProgress(storage, "nouveau");
    expect(progress.items).toEqual([]);
    expect(progress.learningTables).toEqual([1, 10, 2, 5, 3, 4, 6, 7, 8, 9]);
    expect(writes).toBe(0);
  });
});

describe("Ordre d'entrée en mode guidé", () => {
  it("garde l'ordre des rangs à chaque tour, et met à la fin d'un rang ce qui a été entendu la dernière fois", () => {
    const pool = guidedPool([player([failed("7x8"), item("2x1"), item("2x2"), item("2x3")])], NOW);
    const nextRound = guidedRounds(pool, ["2x1", "2x2"]);
    const first = nextRound().map(calculationId);
    expect(first[0]).toBe("7x8");
    expect(first.slice(1)).toEqual(["2x3", ...first.slice(2)]);
    expect(first.slice(2).sort()).toEqual(["2x1", "2x2"]);
    expect(nextRound().map(calculationId)[0]).toBe("7x8");
  });
});

describe("Nom affiché pendant l'écoute", () => {
  it("nomme les joueurs", () => {
    expect(guidedLabel(["Léa"])).toBe("Pour Léa");
    expect(guidedLabel(["Léa", "Tom"])).toBe("Pour Léa et Tom");
    expect(guidedLabel(["Léa", "Tom", "Zoé"])).toBe("Pour Léa, Tom et Zoé");
  });
});

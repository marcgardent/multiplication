import { describe, expect, it } from "vitest";
import { canonical, familyOf, mergeDocs, SyncDoc, withoutDeviceKeys } from "./cloudMerge";
import { AttemptLog, MultiplicationItem, UserProfile } from "../types";

const NS = "mult_clean_v3:";

function doc(data: Record<string, unknown>, sync: Partial<SyncDoc["sync"]> = {}): SyncDoc {
  const named = Object.fromEntries(Object.entries(data).map(([key, value]) => [NS + key, value]));
  const prefixed = <T>(record: Record<string, T> = {}) =>
    Object.fromEntries(Object.entries(record).map(([key, value]) => [NS + key, value]));
  return { data: named, sync: { lineage: sync.lineage ?? "lignée", counters: prefixed(sync.counters), times: prefixed(sync.times) } };
}

function item(a: number, b: number, changes: Partial<MultiplicationItem> = {}): MultiplicationItem {
  return {
    id: `${a}x${b}`,
    a,
    b,
    result: a * b,
    status: "unknown",
    boxLevel: 0,
    giftEarned: false,
    seenCount: 0,
    errorCount: 0,
    successStreak: 0,
    avgResponseTimeMs: 0,
    responseTimesMs: [],
    lastReviewedAt: null,
    nextReviewAt: null,
    intervalDays: 1,
    ...changes
  };
}

function attempt(id: string, timestamp: number): AttemptLog {
  return { id, itemId: "7x8", a: 7, b: 8, mode: "practice", isCorrect: true, responseTimeMs: 2000, timestamp };
}

const profile = (id: string, name: string, createdAt: number): UserProfile => ({ id, name, avatar: "🦁", createdAt });
const read = <T>(merged: SyncDoc, key: string) => merged.data[NS + key] as T;

describe("Familles de données", () => {
  it("reconnaît chaque donnée à son nom", () => {
    expect(familyOf(`${NS}points_p-1`)).toBe("counter");
    expect(familyOf(`${NS}practice_time_p-1`)).toBe("counter");
    expect(familyOf(`${NS}matrix_items_p-1`)).toBe("items");
    expect(familyOf(`${NS}attempt_history_p-1`)).toBe("history");
    expect(familyOf(`${NS}opened_gifts_p-1`)).toBe("set");
    expect(familyOf(`${NS}kept_bgs_p-1`)).toBe("set");
    expect(familyOf(`${NS}wheel_spins_p-1`)).toBe("wheel");
    expect(familyOf(`${NS}user_profiles_v2`)).toBe("profiles");
    expect(familyOf(`${NS}active_profile_id_v2`)).toBe("device");
    expect(familyOf(`${NS}config_duration`)).toBe("setting");
    expect(familyOf(`${NS}active_bg_p-1`)).toBe("setting");
  });
});

describe("Règles de fusion", () => {
  it("joueurs : réunion par identifiant", () => {
    const lea = profile("p-1", "Léa", 100);
    const tom = profile("p-2", "Tom", 200);
    const merged = mergeDocs(doc({ user_profiles_v2: [tom] }), doc({ user_profiles_v2: [lea] }));

    expect(read<UserProfile[]>(merged, "user_profiles_v2")).toEqual([lea, tom]);
  });

  it("joueur supprimé : supprimé partout, même s'il a progressé ailleurs", () => {
    const lea = profile("p-1", "Léa", 100);
    const tom = profile("p-2", "Tom", 200);
    // A a supprimé Tom ; B, hors ligne, a continué à jouer avec lui
    const onA = doc({ user_profiles_v2: [lea], deleted_profiles: ["p-2"], "points_p-1": 50 }, { counters: { "points_p-1": { A: 50 } } });
    const onB = doc(
      { user_profiles_v2: [lea, tom], "points_p-1": 50, "points_p-2": 900, "matrix_items_p-2": [item(7, 8, { lastReviewedAt: 5 })], "active_bg_p-2": "bg-03" },
      { counters: { "points_p-1": { A: 50 }, "points_p-2": { B: 900 } }, times: { "active_bg_p-2": 10 } }
    );

    [mergeDocs(onA, onB), mergeDocs(onB, onA)].forEach((merged) => {
      expect(read<UserProfile[]>(merged, "user_profiles_v2")).toEqual([lea]);
      expect(Object.keys(merged.data).filter((key) => key.includes("p-2"))).toEqual([]);
      expect(Object.keys(merged.sync.counters)).toEqual([`${NS}points_p-1`]);
      expect(merged.sync.times).toEqual({});
      expect(read(merged, "deleted_profiles")).toEqual(["p-2"]);
      expect(read(merged, "points_p-1")).toBe(50);
    });
  });

  it("joueur supprimé : un autre joueur dont l'identifiant finit pareil n'est pas touché", () => {
    const merged = mergeDocs(
      doc({ deleted_profiles: ["p-2"] }),
      doc({ "points_p-12": 70, "points_xp-2": 30 }, { counters: { "points_p-12": { B: 70 }, "points_xp-2": { B: 30 } } })
    );

    expect(read(merged, "points_p-12")).toBe(70);
    // Les identifiants réels ont tous la forme p-<date>-<aléa> : deux joueurs ne peuvent pas finir par le même
    expect(read(merged, "points_xp-2")).toBe(30);
  });

  it("points : somme des progrès de chaque appareil", () => {
    // 1000 au départ, tous apportés par A. Depuis : +200 sur A, +300 sur B
    const onA = doc({ "points_p-1": 1200 }, { counters: { "points_p-1": { A: 1200 } } });
    const onB = doc({ "points_p-1": 1300 }, { counters: { "points_p-1": { A: 1000, B: 300 } } });
    const merged = mergeDocs(onA, onB);

    expect(read(merged, "points_p-1")).toBe(1500);
    expect(merged.sync.counters[`${NS}points_p-1`]).toEqual({ A: 1200, B: 300 });
  });

  it("points : refusionner le même fichier n'ajoute rien", () => {
    const onA = doc({ "points_p-1": 1200 }, { counters: { "points_p-1": { A: 1200 } } });
    const onB = doc({ "points_p-1": 1300 }, { counters: { "points_p-1": { A: 1000, B: 300 } } });
    const once = mergeDocs(onA, onB);

    expect(read(mergeDocs(once, onB), "points_p-1")).toBe(1500);
    expect(read(mergeDocs(mergeDocs(once, onB), onA), "points_p-1")).toBe(1500);
  });

  it("points : devant un ancien fichier sans répartition, le plus grand des deux totaux", () => {
    // L'appareil ne connaît pas ce fichier : sa part est ce qu'il a de plus que lui, ici rien
    const device = doc({ "points_p-1": 800 }, { counters: { "points_p-1": { A: 0 } } });
    const oldFile: SyncDoc = { data: { [`${NS}points_p-1`]: 1000 }, sync: { lineage: "", counters: {}, times: {} } };

    expect(read(mergeDocs(device, oldFile), "points_p-1")).toBe(1000);
  });

  it("temps d'entraînement : même règle que les points", () => {
    const onA = doc({ "practice_time_p-1": 60000 }, { counters: { "practice_time_p-1": { A: 60000 } } });
    const onB = doc({ "practice_time_p-1": 90000 }, { counters: { "practice_time_p-1": { A: 30000, B: 60000 } } });

    expect(read(mergeDocs(onA, onB), "practice_time_p-1")).toBe(120000);
  });

  it("calcul : l'état de l'appareil qui l'a travaillé en dernier", () => {
    const failedMonday = item(7, 8, { boxLevel: 0, status: "review", errorCount: 1, lastReviewedAt: 1000 });
    const passedTuesday = item(7, 8, { boxLevel: 3, status: "discovery", seenCount: 4, lastReviewedAt: 2000 });
    const merged = mergeDocs(doc({ "matrix_items_p-1": [failedMonday] }), doc({ "matrix_items_p-1": [passedTuesday] }));

    expect(read<MultiplicationItem[]>(merged, "matrix_items_p-1")).toEqual([passedTuesday]);
  });

  it("calcul : chaque calcul est départagé séparément", () => {
    const onA = [item(2, 3, { boxLevel: 2, lastReviewedAt: 5000 }), item(7, 8, { boxLevel: 1, lastReviewedAt: 1000 })];
    const onB = [item(2, 3, { boxLevel: 1, lastReviewedAt: 3000 }), item(7, 8, { boxLevel: 4, lastReviewedAt: 9000 })];
    const merged = read<MultiplicationItem[]>(mergeDocs(doc({ "matrix_items_p-1": onA }), doc({ "matrix_items_p-1": onB })), "matrix_items_p-1");

    expect(merged.map((i) => [i.id, i.boxLevel])).toEqual([
      ["2x3", 2],
      ["7x8", 4]
    ]);
  });

  it("calcul : un calcul jamais travaillé cède devant celui qui l'a été", () => {
    const merged = mergeDocs(doc({ "matrix_items_p-1": [item(7, 8)] }), doc({ "matrix_items_p-1": [item(7, 8, { boxLevel: 1, lastReviewedAt: 10 })] }));

    expect(read<MultiplicationItem[]>(merged, "matrix_items_p-1")[0].boxLevel).toBe(1);
  });

  it("cadeau : gagné sur un appareil, gagné partout, même si l'autre a le dernier mot", () => {
    const earnedOnA = item(7, 8, { boxLevel: 5, status: "mastered", giftEarned: true, lastReviewedAt: 1000 });
    const failedLaterOnB = item(7, 8, { boxLevel: 0, status: "review", giftEarned: false, lastReviewedAt: 2000 });
    const merged = read<MultiplicationItem[]>(
      mergeDocs(doc({ "matrix_items_p-1": [earnedOnA] }), doc({ "matrix_items_p-1": [failedLaterOnB] })),
      "matrix_items_p-1"
    );

    expect(merged[0]).toMatchObject({ boxLevel: 0, status: "review", giftEarned: true });
  });

  it("cadeaux ouverts et décors conservés : réunion", () => {
    const merged = mergeDocs(
      doc({ "opened_gifts_p-1": ["2x3", "7x8"], "kept_bgs_p-1": ["bg-02"] }),
      doc({ "opened_gifts_p-1": ["7x8", "9x9"], "kept_bgs_p-1": ["bg-03"] })
    );

    expect(read(merged, "opened_gifts_p-1")).toEqual(["2x3", "7x8", "9x9"]);
    expect(read(merged, "kept_bgs_p-1")).toEqual(["bg-02", "bg-03"]);
  });

  it("historique : réunion sans doublon, du plus récent au plus ancien", () => {
    const shared = attempt("commun", 100);
    const merged = mergeDocs(
      doc({ "attempt_history_p-1": [attempt("a2", 300), shared] }),
      doc({ "attempt_history_p-1": [attempt("b1", 200), shared] })
    );

    expect(read<AttemptLog[]>(merged, "attempt_history_p-1").map((log) => log.id)).toEqual(["a2", "b1", "commun"]);
  });

  it("historique : garde les 500 réponses les plus récentes", () => {
    const onA = Array.from({ length: 400 }, (_, i) => attempt(`a${i}`, 10000 - i * 2));
    const onB = Array.from({ length: 400 }, (_, i) => attempt(`b${i}`, 10001 - i * 2));
    const merged = read<AttemptLog[]>(mergeDocs(doc({ "attempt_history_p-1": onA }), doc({ "attempt_history_p-1": onB })), "attempt_history_p-1");

    expect(merged).toHaveLength(500);
    expect(merged[0].id).toBe("b0");
    expect(merged[499].timestamp).toBe(9502);
  });

  it("roue : le jour le plus récent, et le même jour le plus de tours utilisés", () => {
    const merge = (a: unknown, b: unknown) => read(mergeDocs(doc({ "wheel_spins_p-1": a }), doc({ "wheel_spins_p-1": b })), "wheel_spins_p-1");

    expect(merge({ date: "2026-10-9", usedSpins: 3 }, { date: "2026-10-10", usedSpins: 1 })).toEqual({ date: "2026-10-10", usedSpins: 1 });
    expect(merge({ date: "2026-10-10", usedSpins: 1 }, { date: "2026-10-10", usedSpins: 2 })).toEqual({ date: "2026-10-10", usedSpins: 2 });
    // Les jours ne sont pas complétés par des zéros : le 10 vient bien après le 9
    expect(merge({ date: "2026-9-30", usedSpins: 3 }, { date: "2026-10-1", usedSpins: 0 })).toEqual({ date: "2026-10-1", usedSpins: 0 });
  });

  it("réglage : le plus récemment modifié", () => {
    const onA = doc({ config_duration: 6, radio_tables: [2, 3] }, { times: { config_duration: 500, radio_tables: 100 } });
    const onB = doc({ config_duration: 9, radio_tables: [7] }, { times: { config_duration: 200, radio_tables: 300 } });
    const merged = mergeDocs(onA, onB);

    expect(read(merged, "config_duration")).toBe(6);
    expect(read(merged, "radio_tables")).toEqual([7]);
    expect(merged.sync.times).toEqual({ [`${NS}config_duration`]: 500, [`${NS}radio_tables`]: 300 });
  });

  it("choix des tables : chaque contexte (profil, brosse à dents, radio) retient sa dernière sélection indépendamment", () => {
    const onA = doc(
      {
        user_profiles_v2: [profile("p-1", "Léa", 1)],
        "selected_tables_p-1": [2, 3],
        brushing_tables: [4, 5],
        radio_tables: [6, 7]
      },
      {
        times: {
          "selected_tables_p-1": 100,
          brushing_tables: 300,
          radio_tables: 100
        }
      }
    );
    const onB = doc(
      {
        user_profiles_v2: [profile("p-1", "Léa", 1)],
        "selected_tables_p-1": [8, 9],
        brushing_tables: [2, 3],
        radio_tables: [7]
      },
      {
        times: {
          "selected_tables_p-1": 200,
          brushing_tables: 200,
          radio_tables: 400
        }
      }
    );
    const merged = mergeDocs(onA, onB);

    expect(read(merged, "selected_tables_p-1")).toEqual([8, 9]);
    expect(read(merged, "brushing_tables")).toEqual([4, 5]);
    expect(read(merged, "radio_tables")).toEqual([7]);
    expect(merged.sync.times).toEqual({
      [`${NS}selected_tables_p-1`]: 200,
      [`${NS}brushing_tables`]: 300,
      [`${NS}radio_tables`]: 400
    });
  });

  it("choix des tables du profil : supprimé quand le profil est supprimé", () => {
    const lea = profile("p-1", "Léa", 1);
    const onA = doc({
      user_profiles_v2: [],
      deleted_profiles: ["p-1"],
      brushing_tables: [2, 3],
      radio_tables: [5]
    });
    const onB = doc(
      {
        user_profiles_v2: [lea],
        "selected_tables_p-1": [8, 9],
        brushing_tables: [4, 5],
        radio_tables: [5]
      },
      {
        times: { "selected_tables_p-1": 500 }
      }
    );
    const merged = mergeDocs(onA, onB);

    expect(read(merged, "selected_tables_p-1")).toBeUndefined();
    expect(read(merged, "brushing_tables")).toEqual([4, 5]);
    expect(read(merged, "radio_tables")).toEqual([5]);
    expect(merged.sync.times[`${NS}selected_tables_p-1`]).toBeUndefined();
  });

  it("joueur connecté : chaque appareil garde le sien", () => {
    const onA = doc({ active_profile_id_v2: "p-1" });
    const onB = doc({ active_profile_id_v2: "p-2" });

    expect(read(mergeDocs(onA, onB), "active_profile_id_v2")).toBe("p-1");
    expect(read(mergeDocs(onB, onA), "active_profile_id_v2")).toBe("p-2");
    // Un appareil sans joueur connecté reprend celui de la sauvegarde
    expect(read(mergeDocs(doc({}), onB), "active_profile_id_v2")).toBe("p-2");
  });

  it("une donnée présente d'un seul côté est gardée telle quelle", () => {
    const tomOnly = { "matrix_items_p-2": [item(1, 1, { lastReviewedAt: 5 })], "points_p-2": 40, "wheel_spins_p-2": { date: "2026-10-10", usedSpins: 1 } };
    const merged = mergeDocs(doc({}), doc(tomOnly, { counters: { "points_p-2": { B: 40 } } }));

    expect(read(merged, "points_p-2")).toBe(40);
    expect(read(merged, "wheel_spins_p-2")).toEqual({ date: "2026-10-10", usedSpins: 1 });
    expect(read<MultiplicationItem[]>(merged, "matrix_items_p-2")).toHaveLength(1);
  });
});

// Deux appareils partis du même état, qui jouent chacun de leur côté
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function randomDevice(device: string, random: () => number): SyncDoc {
  const pick = (max: number) => Math.floor(random() * max);
  const gain = pick(500);
  const items = [item(2, 3), item(7, 8), item(9, 9)].map((base) =>
    random() < 0.6 ? { ...base, boxLevel: pick(6), lastReviewedAt: 1000 + pick(4), giftEarned: random() < 0.3 } : base
  );
  return doc(
    {
      user_profiles_v2: [profile("p-1", "Léa", 1), ...(random() < 0.5 ? [profile(`p-${device}`, device, 2 + pick(3))] : [])],
      "points_p-1": 1000 + gain,
      "matrix_items_p-1": items,
      "attempt_history_p-1": Array.from({ length: pick(5) }, (_, i) => attempt(`${device}-${i}`, 1000 + pick(5))),
      "opened_gifts_p-1": ["2x3", "7x8", "9x9"].filter(() => random() < 0.5),
      [`opened_gifts_p-${device}`]: ["2x3"],
      // Il arrive qu'un appareil ait supprimé le joueur créé sur un autre
      deleted_profiles: ["p-A", "p-B", "p-C"].filter((id) => id !== `p-${device}` && random() < 0.15),
      "wheel_spins_p-1": { date: `2026-10-${9 + pick(3)}`, usedSpins: pick(4) },
      config_duration: [3, 6, 9, 15][pick(4)],
      active_profile_id_v2: `p-${device}`
    },
    { counters: { "points_p-1": { origine: 1000, [device]: gain } }, times: { config_duration: pick(3) } }
  );
}

const shared = (merged: SyncDoc) => canonical({ data: withoutDeviceKeys(merged.data), sync: merged.sync });

describe("Propriétés de la fusion, sur 200 cas tirés au hasard", () => {
  const cases = Array.from({ length: 200 }, (_, i) => {
    const random = seededRandom(i + 1);
    return { a: randomDevice("A", random), b: randomDevice("B", random), c: randomDevice("C", random) };
  });

  it("l'ordre ne compte pas", () => {
    cases.forEach(({ a, b }) => expect(shared(mergeDocs(a, b))).toBe(shared(mergeDocs(b, a))));
  });

  it("refusionner ne change rien", () => {
    cases.forEach(({ a, b }) => {
      const merged = mergeDocs(a, b);
      expect(shared(mergeDocs(merged, b))).toBe(shared(merged));
      expect(shared(mergeDocs(merged, a))).toBe(shared(merged));
      expect(shared(mergeDocs(a, a))).toBe(shared(mergeDocs(mergeDocs(a, a), a)));
    });
  });

  it("trois appareils arrivent au même résultat quel que soit le chemin", () => {
    cases.forEach(({ a, b, c }) => {
      const expected = shared(mergeDocs(mergeDocs(a, b), c));
      expect(shared(mergeDocs(a, mergeDocs(b, c)))).toBe(expected);
      expect(shared(mergeDocs(mergeDocs(c, a), b))).toBe(expected);
    });
  });

  it("les points sont la somme exacte des progrès", () => {
    cases.forEach(({ a, b, c }) => {
      const gains = [a, b, c].map((device) => (device.data[`${NS}points_p-1`] as number) - 1000);
      const merged = mergeDocs(mergeDocs(a, b), c);
      expect(merged.data[`${NS}points_p-1`]).toBe(1000 + gains[0] + gains[1] + gains[2]);
    });
  });

  it("un cadeau gagné quelque part n'est jamais perdu", () => {
    cases.forEach(({ a, b }) => {
      const gifts = (source: SyncDoc) => (source.data[`${NS}matrix_items_p-1`] as MultiplicationItem[]).filter((i) => i.giftEarned).map((i) => i.id);
      const merged = gifts(mergeDocs(a, b));
      [...gifts(a), ...gifts(b)].forEach((id) => expect(merged).toContain(id));
    });
  });
});

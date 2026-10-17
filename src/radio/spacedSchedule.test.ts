import { describe, expect, it } from "vitest";
import { Calculation, calculationsOf } from "./program";
import { calculationId, createSpacedStream, heardLast, manualRounds, REPEAT_GAPS } from "./spacedSchedule";

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

// Créneaux d'un brossage : le planificateur sait combien il en reste
function planBrushing(pool: Calculation[], slotCount: number, seed = 1): string[] {
  const stream = createSpacedStream(manualRounds(pool, [], seededRandom(seed)));
  return Array.from({ length: slotCount }, (_, i) => calculationId(stream.next(slotCount - i)));
}

function positionsOf(slots: string[]): Map<string, number[]> {
  const positions = new Map<string, number[]>();
  slots.forEach((id, i) => positions.set(id, [...(positions.get(id) ?? []), i]));
  return positions;
}

// Pool dans un ordre connu : A, B, C... sont les calculs de la table de 2 puis de 3
const ORDERED = calculationsOf([2, 3]);
const inOrder = () => [...ORDERED];
const letter = (id: string) => String.fromCharCode(65 + ORDERED.findIndex((c) => calculationId(c) === id));

describe("Répétition espacée pendant l'écoute", () => {
  it("reprend chaque calcul 3, 6 puis 12 calculs plus tard : l'exemple de la documentation", () => {
    const stream = createSpacedStream(inOrder);
    const slots = Array.from({ length: 32 }, (_, i) => letter(calculationId(stream.next(32 - i))));
    expect(slots.join(" ")).toBe("A B C A B C D E F A B C D E F A B C D E F A B C F A B C F A D E");
  });

  it("respecte les écarts au glissement près : jamais plus tôt que prévu", () => {
    const slots = planBrushing(calculationsOf([2, 3, 4]), 36);
    const firstGap = REPEAT_GAPS[0];
    positionsOf(slots).forEach((positions) => {
      for (let i = 1; i < positions.length; i++) expect(positions[i] - positions[i - 1]).toBeGreaterThanOrEqual(firstGap);
    });
  });

  it("ne fait jamais entendre deux fois de suite le même calcul, même sur une radio sans fin", () => {
    const stream = createSpacedStream(manualRounds(calculationsOf([4]), [], seededRandom(9)));
    let previous = calculationId(stream.next());
    for (let i = 0; i < 1000; i++) {
      const current = calculationId(stream.next());
      expect(current).not.toBe(previous);
      previous = current;
    }
  });

  it("au brossage, un calcul qui entre est entendu au moins 3 fois", () => {
    const slots = planBrushing(calculationsOf([2, 3]), 36);
    positionsOf(slots).forEach((positions) => expect(positions.length).toBeGreaterThanOrEqual(3));
  });

  it("au brossage, la fin sert aux reprises : aucun calcul n'entre sans le temps de ses deux premières reprises", () => {
    const slots = planBrushing(calculationsOf([2, 3, 4, 5, 6]), 36);
    positionsOf(slots).forEach((positions) => expect(positions[0]).toBeLessThan(36 - REPEAT_GAPS[0] - REPEAT_GAPS[1]));
  });

  it("à la radio, tout le pool entre avant qu'un nouveau tour commence", () => {
    const pool = calculationsOf([2, 3]);
    const stream = createSpacedStream(manualRounds(pool, [], seededRandom(4)));
    for (let i = 0; i < 300; i++) stream.next();
    const introduced = stream.introduced().map(calculationId);
    expect(new Set(introduced.slice(0, pool.length)).size).toBe(pool.length);
    expect(introduced.length).toBeGreaterThan(pool.length);
  });

  it("donne le même programme avec le même hasard", () => {
    const pool = calculationsOf([7, 8]);
    expect(planBrushing(pool, 36, 42)).toEqual(planBrushing(pool, 36, 42));
  });

  it("fonctionne avec un pool d'un seul calcul", () => {
    const stream = createSpacedStream(() => [{ a: 7, b: 8, result: 56 }]);
    const slots = Array.from({ length: 10 }, (_, i) => calculationId(stream.next(10 - i)));
    expect(new Set(slots)).toEqual(new Set(["7x8"]));
  });

  it("refuse un pool vide", () => {
    expect(() => createSpacedStream(() => []).next()).toThrow();
  });
});

describe("D'une écoute à l'autre", () => {
  it("fait passer à la fin les calculs entendus à la dernière écoute, sans changer l'ordre des autres", () => {
    const pool = calculationsOf([2]).slice(0, 4);
    expect(heardLast(pool, ["2x1", "2x3"]).map(calculationId)).toEqual(["2x2", "2x4", "2x1", "2x3"]);
  });

  it("le brossage suivant commence par les calculs qui n'ont pas été entendus", () => {
    const pool = calculationsOf([2, 3]);
    const first = createSpacedStream(manualRounds(pool, [], seededRandom(1)));
    for (let i = 0; i < 36; i++) first.next(36 - i);
    const heard = first.introduced().map(calculationId);

    const second = createSpacedStream(manualRounds(pool, heard, seededRandom(2)));
    for (let i = 0; i < 36; i++) second.next(36 - i);
    second.introduced().forEach((calc) => expect(heard).not.toContain(calculationId(calc)));
  });
});

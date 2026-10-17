// Répétition espacée pendant l'écoute, selon docs/progression-et-recompenses.md (« Radio et brossage de dents »).
// L'écoute est une suite de créneaux : chaque calcul qui entre est repris quelques calculs plus tard, à écarts croissants.

import { Calculation } from "./program";

// Écarts entre deux passages d'un même calcul, en nombre de calculs
export const REPEAT_GAPS = [3, 6, 12];
// Un calcul n'entre que si ses premières reprises tiennent avant la fin de l'écoute
export const REPEATS_REQUIRED_TO_ENTER = 2;

export function calculationId(calc: Calculation): string {
  return `${calc.a}x${calc.b}`;
}

export interface SpacedStream {
  // slotsLeft : créneaux restants, celui-ci compris ; infini pour la radio
  next(slotsLeft?: number): Calculation;
  // Calculs entrés depuis le début de l'écoute, dans leur ordre d'entrée
  introduced(): Calculation[];
}

// nextRound donne les calculs du pool dans leur ordre d'entrée ; il est rappelé quand tout le pool est entré
export function createSpacedStream(nextRound: () => Calculation[]): SpacedStream {
  let slot = 0;
  let queue: Calculation[] = [];
  let previousId: string | null = null;
  const reserved = new Map<number, Calculation>();
  // Nombre de reprises encore prévues pour chaque calcul
  const pending = new Map<string, number>();
  const lastHeardAt = new Map<string, number>();
  const heard = new Map<string, Calculation>();
  const introduced: Calculation[] = [];

  function freeSlotFrom(position: number): number {
    while (reserved.has(position)) position++;
    return position;
  }

  // Créneaux des reprises d'un calcul qui entrerait maintenant
  function repeatSlots(): number[] {
    const slots: number[] = [];
    let position = slot;
    for (const gap of REPEAT_GAPS) {
      position = freeSlotFrom(position + gap);
      slots.push(position);
    }
    return slots;
  }

  function introduce(slotsLeft: number, mustFit: boolean): Calculation | null {
    if (queue.length === 0) queue = [...nextRound()];
    const index = queue.findIndex((c) => calculationId(c) !== previousId && !pending.has(calculationId(c)));
    if (index < 0) return null;

    const repeats = repeatSlots().filter((position) => position - slot < slotsLeft);
    if (mustFit && repeats.length < REPEATS_REQUIRED_TO_ENTER) return null;

    const [calc] = queue.splice(index, 1);
    repeats.forEach((position) => reserved.set(position, calc));
    if (repeats.length > 0) pending.set(calculationId(calc), repeats.length);
    introduced.push(calc);
    return calc;
  }

  // Créneau libre sans nouveau calcul possible : le calcul entendu il y a le plus longtemps, hors reprises déjà prévues
  function oldestHeard(): Calculation | null {
    const candidates = [...heard.values()].filter((c) => calculationId(c) !== previousId);
    const free = candidates.filter((c) => !pending.has(calculationId(c)));
    const pool = free.length > 0 ? free : candidates;
    if (pool.length === 0) return null;
    return pool.reduce((oldest, c) =>
      (lastHeardAt.get(calculationId(c)) ?? 0) < (lastHeardAt.get(calculationId(oldest)) ?? 0) ? c : oldest
    );
  }

  return {
    next(slotsLeft = Infinity): Calculation {
      let calc = reserved.get(slot) ?? null;
      if (calc) {
        reserved.delete(slot);
        const id = calculationId(calc);
        const left = (pending.get(id) ?? 1) - 1;
        if (left > 0) pending.set(id, left);
        else pending.delete(id);
      } else {
        // Sans calcul déjà entendu, le premier entre même si ses reprises ne tiennent pas : très courte écoute
        calc = introduce(slotsLeft, true) ?? oldestHeard() ?? introduce(slotsLeft, false);
        // Un pool d'un seul calcul : il revient forcément à la suite
        calc ??= heard.get(previousId ?? "") ?? null;
        if (!calc) throw new Error("Aucun calcul à écouter");
      }

      const id = calculationId(calc);
      heard.set(id, calc);
      lastHeardAt.set(id, slot);
      previousId = id;
      slot++;
      return calc;
    },

    introduced: () => [...introduced]
  };
}

export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Les calculs entendus à la dernière écoute passent après les autres, sans changer leur ordre par ailleurs
export function heardLast(calcs: Calculation[], lastHeardIds: string[]): Calculation[] {
  const lastHeard = new Set(lastHeardIds);
  return [...calcs.filter((c) => !lastHeard.has(calculationId(c))), ...calcs.filter((c) => lastHeard.has(calculationId(c)))];
}

// Mode manuel : pool mélangé à chaque tour ; au premier tour, ce qui a été entendu la dernière fois passe à la fin
export function manualRounds(pool: Calculation[], lastHeardIds: string[], random: () => number = Math.random): () => Calculation[] {
  let isFirst = true;
  return () => {
    const round = shuffled(pool, random);
    if (!isFirst) return round;
    isFirst = false;
    return heardLast(round, lastHeardIds);
  };
}

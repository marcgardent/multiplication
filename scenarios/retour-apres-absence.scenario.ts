import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boxesById, capture, createWorld, disposeWorld, World } from "./harness";
import { createLearner, Learner } from "./learner";
import { REGULAR } from "./personas";

const SESSION_MINUTES = 6;
const LAST_DAY_BEFORE_BREAK = 9;
const RETURN_DAY = 24;

describe("Retour après absence : dix jours de séances, puis deux semaines sans jouer", () => {
  let world: World;
  let learner: Learner;

  beforeAll(() => {
    world = createWorld(3);
    learner = createLearner(world, REGULAR);
  });

  afterAll(disposeWorld);

  it("retrouve tout en retard, et ne rattrape qu'une boîte par calcul", () => {
    for (let day = 0; day <= LAST_DAY_BEFORE_BREAK; day++) {
      world.clock.goTo(day);
      learner.playGuidedSession(SESSION_MINUTES);
    }

    world.clock.goTo(RETURN_DAY);
    const summary = capture(world, "retour-apres-absence");
    expect(summary.dueCount).toBeGreaterThanOrEqual(15);
    expect(summary.giftsEarned).toBe(0);

    const before = boxesById(world);
    learner.playGuidedSession(SESSION_MINUTES);
    world.store.getAll().forEach((item) => {
      expect(item.boxLevel, item.id).toBeLessThanOrEqual(before.get(item.id)! + 1);
      // L'attente suivante repart du jour de la révision, pas de l'échéance manquée
      if (item.boxLevel > before.get(item.id)!) {
        expect(item.nextReviewAt!).toBeGreaterThan(world.clock.now());
      }
    });
  });
});

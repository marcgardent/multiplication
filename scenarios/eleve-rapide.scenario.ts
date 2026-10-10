import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BACKGROUNDS } from "../src/core/backgrounds";
import { isGiftUnlocked } from "../src/core/matrixStore";
import { capture, createWorld, disposeWorld, summarize, World } from "./harness";
import { createLearner, Learner } from "./learner";
import { FAST } from "./personas";

const SESSION_MINUTES = 15;
const MAX_DAYS = 150;

describe("Élève rapide : 15 minutes par jour jusqu'au bout des 100 calculs", () => {
  let world: World;
  let learner: Learner;

  beforeAll(() => {
    world = createWorld(5);
    learner = createLearner(world, FAST);
  });

  afterAll(disposeWorld);

  it("maîtrise les 100 calculs, gagne les 100 cadeaux et tous les décors", () => {
    let isAlmostDone = false;
    let lastDay = -1;

    for (let day = 0; day <= MAX_DAYS && lastDay < 0; day++) {
      world.clock.goTo(day);
      if (!isAlmostDone && summarize(world).boxes[5] >= 95) {
        learner.openGifts(90);
        capture(world, "presque-fini");
        isAlmostDone = true;
      }

      const earnedBefore = world.store.getAll().filter(isGiftUnlocked).length;
      learner.playGuidedSession(SESSION_MINUTES);
      expect(world.store.getAll().filter(isGiftUnlocked).length, `cadeaux à J${day}`).toBeGreaterThanOrEqual(earnedBefore);

      if (summarize(world).boxes[5] === 100) lastDay = day;
    }

    expect(isAlmostDone).toBe(true);
    expect(lastDay).toBeGreaterThan(21);

    const summary = capture(world, "tout-maitrise");
    expect(summary.giftsEarned).toBe(100);
    expect(summary.points).toBeGreaterThanOrEqual(BACKGROUNDS[BACKGROUNDS.length - 1].pointsRequired);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRepetitionEngine } from "../src/core/repetitionEngine";
import { capture, createWorld, disposeWorld, summarize, World } from "./harness";
import { createLearner, Learner } from "./learner";
import { STRUGGLING } from "./personas";

const SESSION_MINUTES = 3;
const LAST_DAY = 20;
// Jours sans séance
const SKIPPED_DAYS = [4, 9];

describe("Élève en difficulté : 3 minutes par jour, beaucoup d'erreurs", () => {
  let world: World;
  let learner: Learner;

  beforeAll(() => {
    world = createWorld(7);
    learner = createLearner(world, STRUGGLING);
  });

  afterAll(disposeWorld);

  it("accumule les erreurs jusqu'à saturer ses séances, sans jamais gagner de cadeau", () => {
    let hasErrorsSnapshot = false;
    let hasOverloadSnapshot = false;

    for (let day = 0; day <= LAST_DAY; day++) {
      if (SKIPPED_DAYS.includes(day)) continue;
      world.clock.goTo(day);

      const engine = createRepetitionEngine(world.store, { durationMinutes: SESSION_MINUTES, pauseBetweenAudioMs: 0 });
      if (!hasOverloadSnapshot && engine.isReviewQueueOverloaded()) {
        expect(engine.startSession().newCount).toBe(0);
        capture(world, "revisions-saturees");
        hasOverloadSnapshot = true;
      }

      learner.playGuidedSession(SESSION_MINUTES);

      const failed = world.store.getAll().filter((i) => i.status === "review");
      failed.forEach((item) => expect(item.boxLevel, `${item.id} raté à J${day}`).toBe(0));
      if (!hasErrorsSnapshot && failed.length >= 3) {
        capture(world, "erreurs-a-reviser");
        hasErrorsSnapshot = true;
      }
    }

    expect(hasErrorsSnapshot).toBe(true);
    expect(hasOverloadSnapshot).toBe(true);
    expect(summarize(world).giftsEarned).toBe(0);
  });
});

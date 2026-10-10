import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { BACKGROUNDS } from "../src/core/backgrounds";
import { createWorld, disposeWorld, SNAPSHOT_DIR } from "./harness";
import { createLearner } from "./learner";
import { FAST, Persona, REGULAR } from "./personas";

const BACKGROUND_DIR = path.join(SNAPSHOT_DIR, "..", "backgrounds");

// Jour où chaque décor est débloqué, pour un élève qui joue une séance par jour
function unlockDays(persona: Persona, minutes: number, seed: number): number[] {
  const world = createWorld(seed);
  const learner = createLearner(world, persona);
  const days: number[] = [];
  for (let day = 0; days.length < BACKGROUNDS.length && day <= 400; day++) {
    world.clock.goTo(day);
    learner.playGuidedSession(minutes);
    learner.openGifts(100);
    while (days.length < BACKGROUNDS.length && world.store.getPoints() >= BACKGROUNDS[days.length].pointsRequired) {
      days.push(day);
    }
  }
  disposeWorld();
  return days;
}

describe("Décors : étalés sur tout le parcours", () => {
  afterAll(disposeWorld);

  it("a une image pour chaque décor", () => {
    BACKGROUNDS.forEach((bg) => {
      expect(fs.existsSync(path.join(BACKGROUND_DIR, bg.filename)), bg.filename).toBe(true);
    });
  });

  it("donne à l'élève régulière (6 min par jour) un premier décor dès le lendemain et le dernier après trois mois", () => {
    const days = unlockDays(REGULAR, 6, 21);
    expect(days).toHaveLength(BACKGROUNDS.length);
    expect(days[1]).toBe(1);
    expect(days[days.length - 1]).toBeGreaterThanOrEqual(90);
    expect(days[days.length - 1]).toBeLessThanOrEqual(120);

    // Jamais deux décors le même jour, et l'attente entre deux décors ne raccourcit jamais de plus d'un jour
    for (let i = 2; i < days.length; i++) {
      expect(days[i], BACKGROUNDS[i].name).toBeGreaterThan(days[i - 1]);
      expect(days[i] - days[i - 1], BACKGROUNDS[i].name).toBeGreaterThanOrEqual(days[i - 1] - days[i - 2] - 1);
    }
  });

  it("garde des décors à gagner pendant trois semaines même à 15 minutes par jour", () => {
    const days = unlockDays(FAST, 15, 5);
    expect(days[days.length - 1]).toBeGreaterThanOrEqual(21);
  });
});

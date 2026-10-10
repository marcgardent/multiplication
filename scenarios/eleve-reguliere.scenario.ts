import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BACKGROUNDS } from "../src/core/backgrounds";
import { isGiftUnlocked } from "../src/core/matrixStore";
import { boxesById, capture, createWorld, disposeWorld, dueInBox, summarize, World } from "./harness";
import { createLearner, Learner } from "./learner";
import { REGULAR } from "./personas";

const SESSION_MINUTES = 6;
// Été, le premier décor à gagner
const SUMMER_POINTS = BACKGROUNDS[1].pointsRequired;

function unlockedBackgrounds(points: number): number {
  return BACKGROUNDS.filter((bg) => points >= bg.pointsRequired).length;
}

describe("Élève régulière : une séance de 6 minutes chaque matin", () => {
  let world: World;
  let learner: Learner;

  beforeAll(() => {
    world = createWorld(21);
    learner = createLearner(world, REGULAR);
  });

  afterAll(disposeWorld);

  // Joue la séance du jour et vérifie qu'aucun calcul n'a gagné plus d'une boîte, ni l'élève plus d'un décor
  function playDay(day: number): void {
    world.clock.goTo(day);
    const before = boxesById(world);
    const backgroundsBefore = unlockedBackgrounds(world.store.getPoints());
    learner.playGuidedSession(SESSION_MINUTES);
    world.store.getAll().forEach((item) => {
      expect(item.boxLevel, `${item.id} à J${day}`).toBeLessThanOrEqual(before.get(item.id)! + 1);
    });
    expect(unlockedBackgrounds(world.store.getPoints()), `décors à J${day}`).toBeLessThanOrEqual(backgroundsBefore + 1);
  }

  it("J0 : première séance, aucun cadeau et pas encore de décor", () => {
    capture(world, "nouveau-joueur");
    playDay(0);

    expect(summarize(world).giftsEarned).toBe(0);
    expect(Math.max(...boxesById(world).values())).toBe(1);
    expect(unlockedBackgrounds(world.store.getPoints())).toBe(1);
  });

  it("J1 à J20 : révisions à J1, J3 et J7, toujours aucun cadeau", () => {
    let isSummerClose = false;
    let isSummerUnlocked = false;

    for (let day = 1; day <= 20; day++) {
      world.clock.goTo(day);
      if (day === 1) {
        expect(dueInBox(world, 1).length).toBeGreaterThan(0);
        capture(world, "j01-premiere-revision");

        // Le premier décor se gagne pendant cette deuxième séance
        learner.onAfterAttempt(() => {
          const points = world.store.getPoints();
          if (!isSummerClose && points >= SUMMER_POINTS - 15 && points < SUMMER_POINTS) {
            capture(world, "decor-ete-imminent");
            isSummerClose = true;
          }
          if (!isSummerUnlocked && points >= SUMMER_POINTS) {
            capture(world, "decor-ete-debloque");
            isSummerUnlocked = true;
          }
        });
      }
      if (day === 3) {
        expect(dueInBox(world, 2).length).toBeGreaterThan(0);
        capture(world, "j03-revision");
      }
      if (day === 7) {
        expect(dueInBox(world, 3).length).toBeGreaterThan(0);
        capture(world, "j07-revision");
      }

      playDay(day);
      expect(summarize(world).giftsEarned, `cadeaux à J${day}`).toBe(0);
      if (day === 1) {
        learner.onAfterAttempt(null);
        expect(isSummerClose).toBe(true);
        expect(isSummerUnlocked).toBe(true);
      }

      if (day === 10) {
        expect(learner.spinWheel() && learner.spinWheel() && learner.spinWheel()).toBe(true);
        expect(learner.spinWheel()).toBe(false);
        capture(world, "roue-epuisee");
      }
    }

    const summary = capture(world, "j20-avant-cadeau");
    expect(summary.boxes[4]).toBeGreaterThan(0);
    expect(summary.boxes[5]).toBe(0);
  });

  it("J21 : la séance du jour donne les premiers cadeaux", () => {
    world.clock.goTo(21);
    expect(dueInBox(world, 4).length).toBeGreaterThan(0);
    capture(world, "j21-jour-du-cadeau");

    playDay(21);

    const summary = capture(world, "j21-cadeaux-a-ouvrir");
    expect(summary.giftsEarned).toBeGreaterThanOrEqual(2);
    expect(summary.giftsToOpen).toBe(summary.giftsEarned);
  });

  it("J22 : un cadeau ouvert puis son calcul raté, le cadeau reste", () => {
    world.clock.goTo(22);
    const earnedBefore = summarize(world).giftsEarned;
    const [opened] = learner.openGifts(1);
    learner.missInTables(opened);

    const item = world.store.get(opened.id)!;
    expect(item.boxLevel).toBe(0);
    expect(isGiftUnlocked(item)).toBe(true);
    expect(world.store.getOpenedGifts()).toEqual([opened.id]);

    const summary = capture(world, "cadeau-garde-apres-echec");
    expect(summary.giftsEarned).toBe(earnedBefore);
    expect(summary.giftsToOpen).toBe(earnedBefore - 1);

    playDay(22);
  });

  it("J23 à J42 : aucun cadeau n'est repris, les calculs maîtrisés reviennent à J42", () => {
    for (let day = 23; day <= 41; day++) {
      const earnedBefore = new Set(world.store.getAll().filter(isGiftUnlocked).map((i) => i.id));
      playDay(day);
      earnedBefore.forEach((id) => expect(isGiftUnlocked(world.store.get(id)!), `cadeau de ${id} à J${day}`).toBe(true));
    }

    world.clock.goTo(42);
    expect(dueInBox(world, 5).length).toBeGreaterThan(0);
    capture(world, "j42-entretien");

    // Les décors s'étalent : après six semaines, il en reste au moins quatre à gagner
    expect(unlockedBackgrounds(world.store.getPoints())).toBeLessThanOrEqual(BACKGROUNDS.length - 4);
  });
});

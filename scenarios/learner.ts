import { GIFT_OPEN_POINTS, isGiftUnlocked } from "../src/core/matrixStore";
import { createRepetitionEngine, RepetitionEngine } from "../src/core/repetitionEngine";
import { MultiplicationItem } from "../src/types";
import { World } from "./harness";
import { Persona } from "./personas";

// Durées d'une étape de séance, proches de celles de l'application
const LISTEN_MS = 4500;
const LISTEN_PAUSE_MS = 1100;
const QUESTION_AUDIO_MS = 2500;
const QUIZ_FEEDBACK_MS = 800;
const QUIZ_ERROR_FEEDBACK_MS = 2500;
const TIME_ATTACK_FEEDBACK_MS = 600;

export interface SessionReport {
  attempts: number;
  errors: number;
}

export interface Learner {
  // Appelé après chaque écoute ou réponse, pour capturer un état en cours de séance
  onAfterAttempt(callback: (() => void) | null): void;
  playGuidedSession(durationMinutes: number): SessionReport;
  missInTables(item: MultiplicationItem): void;
  openGifts(max: number): MultiplicationItem[];
  spinWheel(): boolean;
}

// Un élève simulé : il joue à travers le store et le moteur, comme le fait l'écran de séance
export function createLearner(world: World, persona: Persona): Learner {
  const { store, clock, random } = world;
  let afterAttempt: (() => void) | null = null;

  function responseTime(): number {
    const [min, max] = persona.responseTimeMs;
    return Math.round(min + random() * (max - min));
  }

  function answer(engine: RepetitionEngine, mode: "practice" | "time-attack", report: SessionReport): void {
    const item = engine.getNextQuestion();
    const timeMs = responseTime();
    const isCorrect = random() < persona.accuracy(item);
    clock.advance((mode === "practice" ? QUESTION_AUDIO_MS : 0) + timeMs);
    engine.registerResult(item, mode, isCorrect, timeMs);
    report.attempts += 1;
    if (!isCorrect) report.errors += 1;
    afterAttempt?.();
    if (mode === "time-attack") {
      clock.advance(TIME_ATTACK_FEEDBACK_MS);
    } else {
      clock.advance(isCorrect ? QUIZ_FEEDBACK_MS : QUIZ_ERROR_FEEDBACK_MS);
    }
  }

  return {
    onAfterAttempt(callback) {
      afterAttempt = callback;
    },

    playGuidedSession(durationMinutes) {
      const engine = createRepetitionEngine(store, { durationMinutes, pauseBetweenAudioMs: 1800 });
      engine.startSession();

      // Mêmes ateliers que sessionModal : écoute seulement s'il y a des calculs à écouter, à durées égales
      const workshops = engine.getDiscoveryItems().length > 0 ? [0, 1, 2] : [1, 2];
      const workshopMs = (durationMinutes * 60 * 1000) / workshops.length;
      const startedAt = clock.now();
      const report: SessionReport = { attempts: 0, errors: 0 };

      for (const workshop of workshops) {
        const endsAt = clock.now() + workshopMs;
        while (clock.now() < endsAt) {
          if (workshop === 0) {
            const item = engine.getNextDiscovery();
            clock.advance(LISTEN_MS);
            engine.registerResult(item, "discovery", true, 0);
            afterAttempt?.();
            clock.advance(LISTEN_PAUSE_MS);
          } else {
            answer(engine, workshop === 1 ? "practice" : "time-attack", report);
          }
        }
      }

      store.addPracticeTimeMs(clock.now() - startedAt);
      return report;
    },

    missInTables(item) {
      const timeMs = responseTime();
      clock.advance(timeMs);
      store.recordAttempt(item.a, item.b, "evaluation", false, timeMs);
    },

    openGifts(max) {
      const opened = new Set(store.getOpenedGifts());
      const toOpen = store.getAll().filter((i) => isGiftUnlocked(i) && !opened.has(i.id)).slice(0, max);
      toOpen.forEach((item) => {
        store.openGift(item.id);
        store.addPoints(GIFT_OPEN_POINTS);
      });
      return toOpen;
    },

    spinWheel() {
      if (!store.useWheelSpin()) return false;
      // La roue rapporte le résultat du calcul tiré
      const a = 1 + Math.floor(random() * 10);
      const b = 1 + Math.floor(random() * 10);
      store.addPoints(a * b);
      return true;
    }
  };
}

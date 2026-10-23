import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHoldToTalk, HoldOutcome, HoldPhase, MIN_HOLD_MS } from "./holdToTalk";
import type { HeardSpeech } from "./speechListener";

const THINKING_MAX_MS = 8000;

function heardOf(phrase: number, text: string, isFinal = true, value?: number): HeardSpeech {
  return {
    phrase,
    isFinal,
    transcript: text,
    rulesUsed: [],
    guess: value === undefined ? null : { kind: "number", value }
  };
}

function setup(options: { isReady?: () => boolean } = {}) {
  let phrase = 0;
  const listener = {
    holdStart: vi.fn(() => ((options.isReady?.() ?? true) ? ++phrase : null)),
    holdEnd: vi.fn()
  };
  const phases: HoldPhase[] = [];
  const outcomes: HoldOutcome[] = [];
  const partials: HeardSpeech[] = [];
  const hold = createHoldToTalk({
    listener,
    thinkingMaxMs: THINKING_MAX_MS,
    onPhase: (p) => phases.push(p),
    onOutcome: (o) => outcomes.push(o),
    onPartial: (h) => partials.push(h)
  });
  // Maintient le bouton pendant ms, puis relâche
  const holdFor = (ms: number) => {
    expect(hold.press()).toBe(true);
    vi.advanceTimersByTime(ms);
    hold.release();
  };
  return { hold, listener, phases, outcomes, partials, holdFor };
}

describe("bouton à maintenir pour parler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("appui, nombre dit, relâchement : la réponse arrive, avec l'heure du relâchement", () => {
    const { hold, outcomes, phases, holdFor } = setup();
    holdFor(1200);
    expect(hold.phase()).toBe("thinking");
    const releasedAt = performance.now();
    vi.advanceTimersByTime(400);
    hold.heard(heardOf(1, "sept", true, 7));
    expect(phases).toEqual(["holding", "thinking", "idle"]);
    expect(outcomes).toEqual([{ kind: "heard", heard: heardOf(1, "sept", true, 7), releasedAt }]);
  });

  it("ce qui s'entend pendant l'appui est montré tout de suite, sans finir l'appui", () => {
    const { hold, outcomes, partials } = setup();
    hold.press();
    hold.heard(heardOf(1, "cinquante", false));
    expect(partials).toHaveLength(1);
    expect(outcomes).toHaveLength(0);
    expect(hold.phase()).toBe("holding");
  });

  it("appui trop bref : « trop court », et son résultat ne compte pas", () => {
    const { hold, outcomes, holdFor } = setup();
    holdFor(MIN_HOLD_MS - 1);
    expect(outcomes).toEqual([{ kind: "too-short" }]);
    hold.heard(heardOf(1, "sept", true, 7));
    expect(outcomes).toHaveLength(1);
    expect(hold.phase()).toBe("idle");
  });

  it("réappui avant la fin : seul le dernier appui compte, même si l'ancien résultat arrive après", () => {
    const { hold, outcomes, holdFor } = setup();
    holdFor(1000);
    holdFor(1000);
    // Le résultat du premier appui arrive en retard : ignoré
    hold.heard(heardOf(1, "cinquante six", true, 56));
    expect(outcomes).toHaveLength(0);
    expect(hold.phase()).toBe("thinking");
    hold.heard(heardOf(2, "quarante deux", true, 42));
    expect(outcomes).toEqual([expect.objectContaining({ kind: "heard", heard: heardOf(2, "quarante deux", true, 42) })]);
  });

  it("réappui pendant que le doigt est posé : rien ne change", () => {
    const { hold, listener } = setup();
    hold.press();
    expect(hold.press()).toBe(true);
    expect(listener.holdStart).toHaveBeenCalledTimes(1);
  });

  it("réappui pendant la réflexion : l'attente repart de zéro", () => {
    const { outcomes, holdFor } = setup();
    holdFor(1000);
    vi.advanceTimersByTime(THINKING_MAX_MS - 1000);
    holdFor(1000);
    vi.advanceTimersByTime(THINKING_MAX_MS - 1);
    expect(outcomes).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(outcomes).toEqual([{ kind: "nothing" }]);
  });

  it("rien ne revient de la reconnaissance : « rien entendu », une seule fois", () => {
    const { hold, outcomes, holdFor } = setup();
    holdFor(1000);
    vi.advanceTimersByTime(THINKING_MAX_MS);
    expect(outcomes).toEqual([{ kind: "nothing" }]);
    hold.heard(heardOf(1, "sept", true, 7));
    expect(outcomes).toHaveLength(1);
  });

  it("écoute pas prête : l'appui ne commence pas", () => {
    let isReady = false;
    const { hold, phases, outcomes } = setup({ isReady: () => isReady });
    expect(hold.press()).toBe(false);
    hold.release();
    expect(phases).toEqual([]);
    expect(outcomes).toEqual([]);
    isReady = true;
    expect(hold.press()).toBe(true);
  });

  it("appui interrompu (question lue, séance en pause) : le micro est relâché, rien n'arrive", () => {
    const { hold, listener, outcomes } = setup();
    hold.press();
    hold.cancel();
    expect(listener.holdEnd).toHaveBeenCalledTimes(1);
    expect(hold.phase()).toBe("idle");
    hold.release();
    hold.heard(heardOf(1, "sept", true, 7));
    vi.advanceTimersByTime(THINKING_MAX_MS);
    expect(outcomes).toEqual([]);
  });

  it("interrompu pendant la réflexion : la réponse en retard ne compte pas", () => {
    const { hold, outcomes, holdFor } = setup();
    holdFor(1000);
    hold.cancel();
    hold.heard(heardOf(1, "sept", true, 7));
    vi.advanceTimersByTime(THINKING_MAX_MS);
    expect(outcomes).toEqual([]);
  });

  it("après une réponse, un nouvel appui repart proprement", () => {
    const { hold, outcomes, holdFor } = setup();
    holdFor(1000);
    hold.heard(heardOf(1, "", true));
    holdFor(1000);
    hold.heard(heardOf(2, "sept", true, 7));
    expect(outcomes.map((o) => (o.kind === "heard" ? o.heard.transcript : o.kind))).toEqual(["", "sept"]);
  });
});

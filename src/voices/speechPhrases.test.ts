import { describe, expect, it } from "vitest";
import { createPhraseTracker } from "./speechPhrases";

describe("phrases envoyées à Vosk", () => {
  it("une phrase simple : suppositions puis résultat final", () => {
    const tracker = createPhraseTracker();
    tracker.fed(1);
    tracker.fed(1);
    tracker.finished(1);
    expect(tracker.receive({ kind: "partial", partial: "" })).toEqual({ phrase: 1, text: "", isFinal: false });
    expect(tracker.receive({ kind: "partial", partial: "sept" })).toEqual({ phrase: 1, text: "sept", isFinal: false });
    expect(tracker.receive({ kind: "result", text: "sept", words: [{ word: "sept", end: 0.8 }] })).toEqual({
      phrase: 1,
      text: "sept",
      isFinal: true,
      lastWordEnd: 0.8
    });
  });

  it("doigt resté appuyé après le nombre : Vosk coupe tout seul, le nombre n'est pas perdu", () => {
    const tracker = createPhraseTracker();
    tracker.fed(1);
    tracker.fed(1);
    tracker.fed(1);
    tracker.finished(1);
    tracker.receive({ kind: "partial", partial: "sept" });
    // Fin de phrase repérée par Vosk pendant l'appui : ce n'est pas encore la fin
    expect(tracker.receive({ kind: "result", text: "sept", words: [{ word: "sept", end: 0.8 }] })).toMatchObject({ text: "sept", isFinal: false });
    tracker.receive({ kind: "partial", partial: "" });
    expect(tracker.receive({ kind: "result", text: "" })).toEqual({ phrase: 1, text: "sept", isFinal: true, lastWordEnd: 0.8 });
  });

  it("deux morceaux dans un même appui : la phrase les garde tous les deux", () => {
    const tracker = createPhraseTracker();
    tracker.fed(1);
    tracker.fed(1);
    tracker.finished(1);
    tracker.receive({ kind: "result", text: "cinquante six", words: [{ word: "six", end: 1.1 }] });
    tracker.receive({ kind: "partial", partial: "non quarante" });
    expect(tracker.receive({ kind: "result", text: "non quarante deux", words: [{ word: "deux", end: 3.2 }] })).toEqual({
      phrase: 1,
      text: "cinquante six non quarante deux",
      isFinal: true,
      lastWordEnd: 3.2
    });
  });

  it("deux appuis à la suite : chaque message va à sa phrase", () => {
    const tracker = createPhraseTracker();
    tracker.fed(1);
    tracker.finished(1);
    tracker.fed(2);
    tracker.finished(2);
    expect(tracker.receive({ kind: "partial", partial: "sept" })).toMatchObject({ phrase: 1 });
    expect(tracker.receive({ kind: "result", text: "sept" })).toMatchObject({ phrase: 1, text: "sept", isFinal: true });
    expect(tracker.receive({ kind: "partial", partial: "huit" })).toMatchObject({ phrase: 2, text: "huit" });
    expect(tracker.receive({ kind: "result", text: "huit" })).toMatchObject({ phrase: 2, text: "huit", isFinal: true });
  });

  it("une erreur de Vosk prend la place de son message : la suite reste bien rangée", () => {
    const tracker = createPhraseTracker();
    tracker.fed(1);
    tracker.finished(1);
    expect(tracker.receive({ kind: "error" })).toMatchObject({ phrase: 1, isFinal: false });
    expect(tracker.receive({ kind: "result", text: "" })).toMatchObject({ phrase: 1, isFinal: true });
  });

  it("message inattendu ou après remise à zéro : ignoré", () => {
    const tracker = createPhraseTracker();
    expect(tracker.receive({ kind: "result", text: "sept" })).toBeNull();
    tracker.fed(1);
    tracker.reset();
    expect(tracker.receive({ kind: "partial", partial: "sept" })).toBeNull();
  });
});

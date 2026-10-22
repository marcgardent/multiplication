import { describe, expect, it } from "vitest";
import { calibrationLevel, calibrationVerdict, FAST_MS, SLOW_MS, speechFloor } from "./speechCalibration";
import { DEFAULT_FLOOR } from "./speechSegmenter";

describe("Verdict du calibrage", () => {
  it("rapide, lent ou trop lent selon l'attente après le dernier mot", () => {
    expect(calibrationVerdict({ latencyMs: FAST_MS, correct: 3, total: 3 })).toBe("fast");
    expect(calibrationVerdict({ latencyMs: FAST_MS + 1, correct: 3, total: 3 })).toBe("slow");
    expect(calibrationVerdict({ latencyMs: SLOW_MS, correct: 3, total: 3 })).toBe("slow");
    expect(calibrationVerdict({ latencyMs: SLOW_MS + 1, correct: 3, total: 3 })).toBe("unusable");
  });

  it("inutilisable si moins de deux nombres sur trois sont compris, même rapide", () => {
    expect(calibrationVerdict({ latencyMs: 300, correct: 2, total: 3 })).toBe("fast");
    expect(calibrationVerdict({ latencyMs: 300, correct: 1, total: 3 })).toBe("unusable");
    expect(calibrationVerdict({ latencyMs: null, correct: 0, total: 3 })).toBe("unusable");
  });
});

describe("Seuil de la parole", () => {
  it("entre le bruit de la pièce et la voix, jamais trop près du bruit", () => {
    const floor = speechFloor(0.004, 0.1);
    expect(floor).toBeGreaterThan(0.008);
    expect(floor).toBeLessThan(0.1);
    expect(speechFloor(0.03, 0.04)).toBeCloseTo(0.06);
  });

  it("une pièce mesurée parfaitement silencieuse ne ramène pas le seuil à zéro", () => {
    expect(speechFloor(0, 0.2)).toBe(DEFAULT_FLOOR / 2);
  });

  it("sans voix entendue, le seuil par défaut, relevé si la pièce est bruyante", () => {
    expect(speechFloor(0.001, null)).toBe(DEFAULT_FLOOR);
    expect(speechFloor(0.02, null)).toBeCloseTo(0.06);
  });
});

describe("Niveau de la jauge du bilan", () => {
  it("5 et 4 conseillé, 3 praticable, 2 et 1 non conseillé", () => {
    expect(calibrationLevel({ latencyMs: 400, correct: 3, total: 3 })).toBe(5);
    expect(calibrationLevel({ latencyMs: 900, correct: 3, total: 3 })).toBe(4);
    expect(calibrationLevel({ latencyMs: 1800, correct: 3, total: 3 })).toBe(3);
    expect(calibrationLevel({ latencyMs: 3500, correct: 3, total: 3 })).toBe(2);
    expect(calibrationLevel({ latencyMs: 400, correct: 1, total: 3 })).toBe(1);
    expect(calibrationLevel({ latencyMs: null, correct: 0, total: 3 })).toBe(1);
  });
});

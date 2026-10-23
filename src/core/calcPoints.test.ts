import { describe, expect, it } from "vitest";
import { answerPoints, calcValue, fluentBonusPoints, masteryPoints } from "./calcPoints";

const range = Array.from({ length: 10 }, (_, i) => i + 1);

describe("points d'un calcul", () => {
  it("a × b vaut b × a", () => {
    range.forEach((a) => range.forEach((b) => expect(calcValue(a, b), `${a}×${b}`).toBe(calcValue(b, a))));
  });

  it("tables de 1 et de 10 : 1 ; table de 2 : 3 (sauf × 1 et × 10)", () => {
    range.forEach((n) => {
      expect(calcValue(1, n)).toBe(1);
      expect(calcValue(10, n)).toBe(1);
    });
    [2, 3, 4, 5, 6, 7, 8, 9].forEach((n) => expect(calcValue(2, n)).toBe(3));
  });

  it("les plus redoutés valent 20, les carrés un cran de moins que leurs voisins", () => {
    expect([calcValue(6, 9), calcValue(7, 8), calcValue(7, 9), calcValue(8, 9)]).toEqual([20, 20, 20, 20]);
    expect([calcValue(6, 6), calcValue(7, 7), calcValue(8, 8), calcValue(9, 9)]).toEqual([8, 10, 10, 10]);
  });

  it("valeurs prises sur la table : 3 × 5, 4 × 8, 5 × 8", () => {
    expect([calcValue(3, 5), calcValue(4, 8), calcValue(5, 8)]).toEqual([5, 8, 10]);
  });

  it("sur les 100 calculs, la valeur totale est 516", () => {
    expect(range.reduce((sum, a) => sum + range.reduce((s, b) => s + calcValue(a, b), 0), 0)).toBe(516);
  });

  it("bonne réponse ×2, bonus de réponse fluide ×2, entrée en Boîte 5 ×10", () => {
    expect(answerPoints(7, 8)).toBe(40);
    expect(fluentBonusPoints(7, 8)).toBe(40);
    expect(masteryPoints(7, 8)).toBe(200);
    expect(answerPoints(1, 4)).toBe(2);
    expect(masteryPoints(1, 4)).toBe(10);
  });
});

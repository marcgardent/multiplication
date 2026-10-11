import { describe, expect, it } from "vitest";
import { createParentChallenge, createParentCodeService } from "./parentCodeService";
import { createMemoryStorage } from "./storageService";

const fakeHash = async (text: string) => `empreinte(${text.length}:${[...text].reverse().join("")})`;

describe("Code de l'espace parent", () => {
  it("aucun code tant que le parent n'en a pas choisi", async () => {
    const service = createParentCodeService(createMemoryStorage(), fakeHash);

    expect(service.hasCode()).toBe(false);
    expect(await service.isCorrect("")).toBe(false);
    expect(await service.isCorrect("0000")).toBe(false);
  });

  it("accepte le code choisi et refuse les autres", async () => {
    const service = createParentCodeService(createMemoryStorage(), fakeHash);
    await service.setCode("4821");

    expect(service.hasCode()).toBe(true);
    expect(await service.isCorrect("4821")).toBe(true);
    expect(await service.isCorrect("4822")).toBe(false);
    expect(await service.isCorrect("1284")).toBe(false);
  });

  it("n'enregistre que l'empreinte du code, jamais le code", async () => {
    const storage = createMemoryStorage();
    await createParentCodeService(storage, fakeHash).setCode("4821");

    expect(storage.get<string>("code", "")).not.toContain("4821");
  });

  it("un nouveau code remplace l'ancien", async () => {
    const service = createParentCodeService(createMemoryStorage(), fakeHash);
    await service.setCode("4821");
    await service.setCode("1357");

    expect(await service.isCorrect("4821")).toBe(false);
    expect(await service.isCorrect("1357")).toBe(true);
  });
});

describe("Calcul de remise à zéro du code", () => {
  it("propose deux nombres à deux chiffres, hors des tables et des calculs de tête", () => {
    let seed = 1;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let i = 0; i < 200; i++) {
      const challenge = createParentChallenge(random);
      const [a, b] = challenge.question.split(" × ").map(Number);

      [a, b].forEach((n) => {
        expect(n).toBeGreaterThanOrEqual(12);
        expect(n).toBeLessThanOrEqual(99);
        expect(n % 10).not.toBe(0);
        expect(n % 11).not.toBe(0);
      });
      expect(challenge.answer).toBe(String(a * b));
    }
  });
});

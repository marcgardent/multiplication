import { describe, expect, it } from "vitest";
import { ANSWER_GRAMMAR, guessSpeech, interpretAlternatives, interpretSpeech, spellNumber } from "./speechGuess";

const number = (value: number) => ({ kind: "number", value });

describe("Nombres reconnus", () => {
  it.each([
    ["56", 56],
    ["cinquante-six", 56],
    ["cinquante six", 56],
    ["vingt et un", 21],
    ["soixante-dix", 70],
    ["soixante-treize", 73],
    ["soixante dix sept", 77],
    ["quatre-vingts", 80],
    ["quatre vingt un", 81],
    ["quatre-vingt-dix-neuf", 99],
    ["dix-huit", 18],
    ["zéro", 0],
    ["cent", 100],
    ["Quarante-deux.", 42],
    ["septante-deux", 72],
    ["nonante", 90]
  ])("« %s » donne %i", (text, value) => {
    expect(interpretSpeech(text)).toEqual({ guess: number(value), rulesUsed: [] });
  });

  it("ne devine rien dans une phrase sans rapport", () => {
    expect(guessSpeech("bonjour")).toBeNull();
    expect(guessSpeech("")).toBeNull();
  });
});

describe("Commandes", () => {
  it.each(["passe", "je passe", "Passer", "suivant"])("« %s » : PASSE", (text) => {
    expect(guessSpeech(text)).toEqual({ kind: "pass" });
  });

  it.each(["réponse", "la réponse", "je ne sais pas", "je sais pas", "chais pas", "aucune idée"])("« %s » : RÉPONSE", (text) => {
    expect(guessSpeech(text)).toEqual({ kind: "answer" });
  });
});

describe("Heuristiques : toujours appliquées, et signalées quand elles décident", () => {
  it("dernier nombre : l'enfant se reprend", () => {
    expect(interpretSpeech("cinquante... cinquante-six")).toEqual({ guess: number(56), rulesUsed: ["lastNumber"] });
    expect(guessSpeech("euh 54 non 56")).toEqual(number(56));
  });

  it("question répétée : les nombres autour de « fois » ne sont pas la réponse", () => {
    expect(interpretSpeech("sept fois huit cinquante-six")).toEqual({ guess: number(56), rulesUsed: ["skipQuestion"] });
    expect(guessSpeech("7×8 égale 56")).toEqual(number(56));
    expect(guessSpeech("sept fois huit")).toBeNull();
  });

  it("nombre avant commande", () => {
    expect(interpretSpeech("la réponse c'est 56")).toEqual({ guess: number(56), rulesUsed: ["numberOverCommand"] });
  });

  it("mot qui sonne comme un nombre, dit seul", () => {
    expect(interpretSpeech("dis")).toEqual({ guess: number(10), rulesUsed: ["loneHomophones"] });
    expect(guessSpeech("sans")).toEqual(number(100));
    // « sept » entendu « set » ou « Sète »
    expect(guessSpeech("Set")).toEqual(number(7));
    expect(guessSpeech("Sète")).toEqual(number(7));
    expect(guessSpeech("je dis que")).toBeNull();
  });

  it("propositions suivantes de la reconnaissance", () => {
    expect(interpretAlternatives(["bonjour", "cinquante six", "56"])).toEqual({
      guess: number(56),
      transcript: "cinquante six",
      rulesUsed: ["alternatives"]
    });
    expect(interpretAlternatives(["bonjour"])).toEqual({ guess: null, transcript: "bonjour", rulesUsed: [] });
  });

  it("une réponse claire n'utilise aucune heuristique", () => {
    expect(interpretAlternatives(["56", "cinquante"])).toEqual({ guess: number(56), transcript: "56", rulesUsed: [] });
  });
});

describe("Liste donnée à Vosk", () => {
  it("chaque nombre écrit pour Vosk se relit en ce nombre", () => {
    for (let n = 0; n <= 100; n++) expect(guessSpeech(spellNumber(n))).toEqual(number(n));
  });

  it("chaque nombre en un seul mot se relit aussi", () => {
    expect(guessSpeech("quatre-vingt-un")).toEqual(number(81));
    expect(guessSpeech("soixante-et-onze")).toEqual(number(71));
    expect(guessSpeech("soixante-dix-sept")).toEqual(number(77));
    expect(guessSpeech("cinquante-et-un")).toEqual(number(51));
  });

  it("contient les 101 nombres, les commandes et le mot inconnu", () => {
    expect(ANSWER_GRAMMAR).toContain("quatre-vingt-un");
    expect(ANSWER_GRAMMAR).toContain("cinquante six");
    expect(ANSWER_GRAMMAR).toContain("je ne sais pas");
    expect(ANSWER_GRAMMAR).toContain("[unk]");
    expect(ANSWER_GRAMMAR).toContain("fois");
    // Ce que Vosk rend quand l'enfant répète la question
    expect(guessSpeech("sept fois huit égal cinquante six")).toEqual(number(56));
    expect(new Set(ANSWER_GRAMMAR).size).toBe(ANSWER_GRAMMAR.length);
  });

  it("un nombre dont la fin n'est pas comprise n'est pas deviné", () => {
    expect(guessSpeech("vingt [unk]")).toBeNull();
    expect(guessSpeech("quatre-vingt [unk]")).toBeNull();
    // Un bruit avant ou après une réponse complète ne gêne pas
    expect(guessSpeech("[unk] cinquante six")).toEqual(number(56));
    expect(guessSpeech("cinquante six [unk]")).toEqual(number(56));
  });
});

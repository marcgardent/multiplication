import { describe, expect, it } from "vitest";
import {
  answerFile,
  BRUSHING_MS,
  buildBrushingProgram,
  buildRadioSegment,
  calculationsOf,
  createShuffler,
  encodeWav,
  locateCue,
  NEXT_PAUSE_MS,
  questionFile,
  THINK_PAUSE_MS
} from "./program";

const SAMPLE_RATE = 1000;
const PHRASES = { intro: "intro", cheer: "cheer", outro: "outro" };

// Voix factices : 1,3 s par question, 0,9 s par réponse, 2 s par annonce
function fakeClips(file: string): Float32Array {
  if (file.includes("/q_")) return new Float32Array(1300).fill(0.5);
  if (file.includes("/ans_")) return new Float32Array(900).fill(0.5);
  return new Float32Array(2000).fill(0.5);
}

function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe("Tirage des calculs", () => {
  it("une table donne ses 10 calculs", () => {
    const calcs = calculationsOf([7]);
    expect(calcs).toHaveLength(10);
    expect(calcs[7]).toEqual({ a: 7, b: 8, result: 56 });
  });

  it("tous les calculs passent une fois avant de revenir", () => {
    const next = createShuffler([2, 3], seededRandom(1));
    const firstRound = Array.from({ length: 20 }, () => next());
    expect(new Set(firstRound.map((c) => `${c.a}x${c.b}`)).size).toBe(20);
  });

  it("jamais deux fois le même calcul de suite, même d'un tour au suivant", () => {
    const next = createShuffler([4], seededRandom(9));
    let previous = next();
    for (let i = 0; i < 500; i++) {
      const current = next();
      expect(current).not.toBe(previous);
      previous = current;
    }
  });
});

describe("Morceau de radio", () => {
  it("enchaîne question, réflexion, réponse et pause pour chaque calcul", () => {
    const program = buildRadioSegment(createShuffler([2], seededRandom(3)), fakeClips, SAMPLE_RATE, 5);
    const calcLengthS = (1300 + THINK_PAUSE_MS + 900 + NEXT_PAUSE_MS) / 1000;

    expect(program.cues).toHaveLength(5);
    expect(program.brushing).toBeNull();
    expect(program.durationS).toBeCloseTo(5 * calcLengthS);
    program.cues.forEach((cue, i) => {
      expect(cue.startS).toBeCloseTo(i * calcLengthS);
      expect(cue.answerS).toBeCloseTo(cue.startS + (1300 + THINK_PAUSE_MS) / 1000);
      expect(cue.endS).toBeCloseTo((i + 1) * calcLengthS);
    });
  });

  it("retrouve le calcul en cours et le moment où la réponse est dite", () => {
    const program = buildRadioSegment(createShuffler([2], seededRandom(3)), fakeClips, SAMPLE_RATE, 2);
    const [first, second] = program.cues;

    expect(locateCue(program.cues, 0.5)).toEqual({ cue: first, isAnswerRevealed: false });
    expect(locateCue(program.cues, first.answerS + 0.1)).toEqual({ cue: first, isAnswerRevealed: true });
    expect(locateCue(program.cues, second.startS)).toEqual({ cue: second, isAnswerRevealed: false });
    expect(locateCue(program.cues, program.durationS + 1)).toBeNull();
  });
});

describe("Brossage de dents", () => {
  const program = buildBrushingProgram(createShuffler([2, 3], seededRandom(5)), fakeClips, SAMPLE_RATE, PHRASES);
  const brushing = program.brushing as { startS: number; endS: number };

  it("dure 3 minutes entre l'annonce de début et la félicitation", () => {
    expect(brushing.startS).toBeCloseTo(2.6);
    expect(brushing.endS - brushing.startS).toBeCloseTo(BRUSHING_MS / 1000);
  });

  it("finit par la félicitation puis l'annonce de fin", () => {
    expect(program.durationS).toBeCloseTo(brushing.endS + 2 + 2);
  });

  it("ne coupe aucun calcul : chaque réponse est dite avant la fin du brossage", () => {
    expect(program.cues.length).toBeGreaterThan(30);
    program.cues.forEach((cue) => {
      expect(cue.startS).toBeGreaterThanOrEqual(brushing.startS);
      expect(cue.answerS + 0.9).toBeLessThanOrEqual(brushing.endS + 1e-9);
      expect(cue.endS).toBeLessThanOrEqual(brushing.endS + 1e-9);
    });
  });

  it("remplit les 3 minutes : il reste moins d'un calcul de silence à la fin", () => {
    const lastCue = program.cues[program.cues.length - 1];
    expect(brushing.endS - lastCue.endS).toBeLessThan((1300 + THINK_PAUSE_MS + 900) / 1000);
  });
});

describe("Encodage WAV", () => {
  it("écrit un en-tête PCM 16 bits mono et les échantillons à la suite", () => {
    const wav = new DataView(encodeWav([new Float32Array([0, 1]), new Float32Array([-1, 2])], 22050));
    const tag = (offset: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => wav.getUint8(offset + i)));

    expect(tag(0)).toBe("RIFF");
    expect(tag(8)).toBe("WAVE");
    expect(wav.getUint16(22, true)).toBe(1);
    expect(wav.getUint32(24, true)).toBe(22050);
    expect(wav.getUint16(34, true)).toBe(16);
    expect(wav.getUint32(40, true)).toBe(8);
    expect(wav.byteLength).toBe(44 + 8);
    expect([44, 46, 48, 50].map((o) => wav.getInt16(o, true))).toEqual([0, 32767, -32767, 32767]);
  });

  it("nomme les fichiers de voix comme le script de génération", () => {
    expect(questionFile(7, 8)).toBe("/audio/q_7_8.mp3");
    expect(answerFile(56)).toBe("/audio/ans_56.mp3");
  });
});

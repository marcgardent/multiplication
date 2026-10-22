import { describe, expect, it } from "vitest";
import { AudioChunk, createSpeechSegmenter, END_SILENCE_MS } from "./speechSegmenter";

const CHUNK_MS = 40;
let clock = 0;
const chunk = (level: number): AudioChunk => {
  clock += CHUNK_MS;
  return { samples: new Float32Array(640), level, durationMs: CHUNK_MS, wall: clock };
};

// Joue une suite de volumes : ce qui part vers Vosk, et les débuts et fins de phrase, paquet par paquet
function play(levels: number[], floor?: number) {
  const segmenter = createSpeechSegmenter(floor === undefined ? undefined : () => floor);
  let fed = 0;
  const events: { at: number; event: string }[] = [];
  levels.forEach((level, i) => {
    const { feed, event } = segmenter.push(chunk(level));
    fed += feed.length;
    if (event) events.push({ at: i, event });
  });
  return { fed, events, segmenter };
}

const quiet = (n: number) => Array(n).fill(0.002);
const voice = (n: number) => Array(n).fill(0.1);

describe("Découpage de l'écoute en phrases", () => {
  it("ne donne rien à Vosk tant que personne ne parle", () => {
    expect(play(quiet(100))).toMatchObject({ fed: 0, events: [] });
  });

  it("donne la phrase, avec un peu de son avant pour ne pas couper le début, puis la ferme après le silence", () => {
    const { fed, events } = play([...quiet(50), ...voice(25), ...quiet(30)]);
    expect(events.map((e) => e.event)).toEqual(["start", "end"]);
    // La fin arrive après le silence voulu
    const silenceChunks = events[1].at - (50 + 25) + 1;
    expect(silenceChunks * CHUNK_MS).toBeGreaterThanOrEqual(END_SILENCE_MS);
    // La parole, son début gardé, et le silence de fin : pas les 50 paquets de silence d'avant
    expect(fed).toBeGreaterThanOrEqual(25 + silenceChunks);
    expect(fed).toBeLessThan(25 + silenceChunks + 12);
  });

  it("un claquement trop bref n'ouvre pas de phrase", () => {
    expect(play([...quiet(50), 0.2, ...quiet(50)]).events).toEqual([]);
  });

  it("une pièce bruyante relève le seuil : le bruit seul n'est pas pris pour de la parole", () => {
    const noisy = Array(400).fill(0.03);
    const { events } = play(noisy);
    // Au début, le bruit peut ouvrir une phrase ; une fois la pièce entendue, plus aucune
    const late = events.filter((e) => e.at > 300 && e.event === "start");
    expect(late).toEqual([]);
  });

  it("une phrase trop longue est fermée quand même", () => {
    const { events } = play([...quiet(20), ...voice(200)]);
    expect(events.filter((e) => e.event === "end").length).toBeGreaterThan(0);
  });

  it("le seuil du calibrage s'applique : une voix trop faible pour ce téléphone n'ouvre rien", () => {
    expect(play([...quiet(50), ...Array(25).fill(0.02), ...quiet(30)], 0.05).events).toEqual([]);
    expect(play([...quiet(50), ...Array(25).fill(0.02), ...quiet(30)], 0.01).events.map((e) => e.event)).toEqual(["start", "end"]);
  });
});

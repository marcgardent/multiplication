import { describe, expect, it } from "vitest";
import { AudioManifest } from "../services/audioService";
import manifestJson from "../../public/audio/index.json";
import { normalizePeak, TARGET_PEAK, trimSilence } from "./trimSilence";
import { nextToRecord, recordingOrder, voiceCatalog } from "./voiceCatalog";

const manifest = manifestJson as AudioManifest;
const catalog = voiceCatalog(manifest);
const order = recordingOrder(catalog);

describe("Ce que l'on peut enregistrer", () => {
  it("couvre toutes les voix de l'application : félicitations, annonces, 100 multiplications, 42 réponses", () => {
    expect(catalog.filter((c) => c.kind === "cheer")).toHaveLength(12);
    expect(catalog.filter((c) => c.kind === "phrase")).toHaveLength(2);
    expect(catalog.filter((c) => c.kind === "question")).toHaveLength(100);
    expect(catalog.filter((c) => c.kind === "answer")).toHaveLength(42);
    expect(catalog.find((c) => c.file === "/audio/q_7_8.mp3")).toMatchObject({ text: "7 fois 8", label: "7 × 8" });
  });

  it("propose d'abord les félicitations et annonces, puis la table de 1 et ses réponses, puis la table de 10", () => {
    expect(order.slice(0, 14).every((c) => c.kind === "cheer" || c.kind === "phrase")).toBe(true);
    expect(order.slice(14, 24).map((c) => c.label)).toEqual(["1 × 1", "1 × 2", "1 × 3", "1 × 4", "1 × 5", "1 × 6", "1 × 7", "1 × 8", "1 × 9", "1 × 10"]);
    expect(order.slice(24, 34).map((c) => c.label)).toEqual(["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
    expect(order[34].label).toBe("10 × 1");
    // Les réponses de la table de 10 déjà vues (10) ne reviennent pas
    expect(order.slice(44, 53).map((c) => c.label)).toEqual(["20", "30", "40", "50", "60", "70", "80", "90", "100"]);
  });

  it("contient chaque voix une seule fois", () => {
    expect(order).toHaveLength(catalog.length);
    expect(new Set(order.map((c) => c.file)).size).toBe(catalog.length);
  });
});

describe("Enregistrement suivant", () => {
  it("passe au prochain pas encore enregistré", () => {
    const recorded = new Set(order.slice(0, 3).map((c) => c.file));
    expect(nextToRecord(order, recorded)?.file).toBe(order[3].file);
    expect(nextToRecord(order, recorded, order[5].file)?.file).toBe(order[6].file);
  });

  it("après une case choisie dans le tableau, continue la file à partir d'elle", () => {
    const sevenEight = order.findIndex((c) => c.label === "7 × 8");
    expect(nextToRecord(order, new Set(), order[sevenEight].file)?.file).toBe(order[sevenEight + 1].file);
  });

  it("reprend au début de la file une fois au bout", () => {
    const last = order[order.length - 1];
    expect(nextToRecord(order, new Set(), last.file)?.file).toBe(order[0].file);
  });

  it("ne propose plus rien quand tout est enregistré", () => {
    const all = new Set(order.map((c) => c.file));
    expect(nextToRecord(order, all, order[0].file)).toBeNull();
  });
});

describe("Nettoyage d'un enregistrement", () => {
  const RATE = 1000;
  // Silence, voix d'une seconde, silence
  const recording = new Float32Array(3000);
  for (let i = 1000; i < 2000; i++) recording[i] = 0.3 * Math.sin(i);

  it("retire les blancs avant et après la voix, en gardant une petite marge", () => {
    const trimmed = trimSilence(recording, RATE);
    expect(trimmed.length).toBeGreaterThanOrEqual(1000);
    expect(trimmed.length).toBeLessThanOrEqual(1000 + 60 + 150 + 20);
  });

  it("garde un léger souffle de fond, sans le prendre pour de la voix", () => {
    const noisy = recording.map((s, i) => s + 0.003 * Math.sin(i * 7));
    expect(trimSilence(noisy, RATE).length).toBeLessThanOrEqual(1000 + 60 + 150 + 20);
  });

  it("ne garde rien d'un enregistrement muet", () => {
    expect(trimSilence(new Float32Array(3000), RATE)).toHaveLength(0);
  });

  it("règle le volume de crête", () => {
    const normalized = normalizePeak(new Float32Array([0.1, -0.2, 0.05]));
    expect(Math.max(...normalized.map(Math.abs))).toBeCloseTo(TARGET_PEAK);
  });
});

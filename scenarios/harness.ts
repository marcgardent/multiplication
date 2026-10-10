import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { vi } from "vitest";
import { createMatrixStore, MatrixStore } from "../src/core/matrixStore";
import { exportProfileData } from "../src/core/profileData";
import { createMemoryStorage, StorageService } from "../src/services/storageService";
import { ScenarioSnapshot, SnapshotSummary, summarizeProfileData } from "../src/testing/snapshots";
import { MultiplicationItem } from "../src/types";
import { CATALOG, SnapshotId } from "./catalog";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SNAPSHOT_DIR = path.join(ROOT, "public", "snapshots");
// Les captures n'écrasent public/snapshots qu'une fois tous les scénarios réussis
export const STAGING_DIR = path.join(ROOT, "node_modules", ".scenarios-staging");

const PROFILE_ID = "scenario";
const DAY_MS = 24 * 3600 * 1000;
// Jour de la première séance de chaque scénario
const J0 = Date.UTC(2026, 0, 5);

export interface Clock {
  // Se place au jour J+day ; les séances simulées ont lieu le matin
  goTo(day: number, hour?: number, minute?: number): void;
  advance(ms: number): void;
  now(): number;
}

export interface World {
  storage: StorageService;
  store: MatrixStore;
  clock: Clock;
  random(): number;
}

// Générateur à graine : un scénario rejoué donne exactement les mêmes snapshots
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorld(seed: number): World {
  if (new Date().getTimezoneOffset() !== 0) {
    throw new Error("Les scénarios tournent en UTC : lancer `make scenarios`");
  }
  vi.useFakeTimers({ toFake: ["Date"] });
  const random = mulberry32(seed);
  vi.spyOn(Math, "random").mockImplementation(random);

  const clock: Clock = {
    goTo(day, hour = 8, minute = 0) {
      vi.setSystemTime(J0 + day * DAY_MS + hour * 3600 * 1000 + minute * 60 * 1000);
    },
    advance(ms) {
      vi.setSystemTime(Date.now() + ms);
    },
    now() {
      return Date.now();
    }
  };
  clock.goTo(0);

  const storage = createMemoryStorage();
  return { storage, store: createMatrixStore(storage, PROFILE_ID), clock, random };
}

export function disposeWorld(): void {
  vi.restoreAllMocks();
  vi.useRealTimers();
}

export function summarize(world: World): SnapshotSummary {
  return summarizeProfileData(exportProfileData(world.storage, PROFILE_ID), world.clock.now());
}

export function boxesById(world: World): Map<string, number> {
  return new Map(world.store.getAll().map((i) => [i.id, i.boxLevel]));
}

export function dueInBox(world: World, box: number): MultiplicationItem[] {
  const now = world.clock.now();
  return world.store.getAll().filter((i) => i.boxLevel === box && i.nextReviewAt !== null && now >= i.nextReviewAt);
}

const captured = new Set<string>();

// Enregistre l'état persisté du joueur à cet instant du scénario
export function capture(world: World, id: SnapshotId): SnapshotSummary {
  if (captured.has(id)) throw new Error(`Snapshot capturé deux fois : ${id}`);
  captured.add(id);

  const order = CATALOG.findIndex((entry) => entry.id === id);
  const data = exportProfileData(world.storage, PROFILE_ID);
  const summary = summarizeProfileData(data, world.clock.now());
  const snapshot: ScenarioSnapshot = {
    ...CATALOG[order],
    checks: [...CATALOG[order].checks],
    order,
    capturedAt: new Date(world.clock.now()).toISOString(),
    summary,
    data
  };

  fs.mkdirSync(STAGING_DIR, { recursive: true });
  fs.writeFileSync(path.join(STAGING_DIR, `${id}.json`), `${JSON.stringify(snapshot)}\n`);
  return summary;
}

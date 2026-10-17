// Pool de l'écoute en mode guidé : ce que les joueurs cochés ont à revoir, selon docs/progression-et-recompenses.md
// (« Le pool en mode guidé »). Les données des joueurs sont seulement lues.

import { DEFAULT_LEARNING_TABLES } from "../core/matrixStore";
import { profileKey } from "../core/profileData";
import { StorageService } from "../services/storageService";
import { MultiplicationItem } from "../types";
import { Calculation } from "./program";
import { heardLast, shuffled } from "./spacedSchedule";

export interface PlayerProgress {
  // Calculs enregistrés ; un calcul absent n'a jamais été abordé
  items: MultiplicationItem[];
  learningTables: number[];
}

export interface GuidedEntry {
  calc: Calculation;
  // 1 raté, 2 révision échue, 3 en cours ou prochain nouveau, 4 complément pris en Boîte 3 à 5
  rank: number;
  playerCount: number;
}

// Prochains nouveaux calculs de chaque joueur, entendus avant d'être appris
export const NEXT_NEW_PER_PLAYER = 2;
// En dessous, le pool est complété par les calculs les plus proches de leur échéance
export const MIN_GUIDED_POOL = 6;
// Au-delà, un calcul pas encore échu ne demande pas d'écoute
const LAST_LEARNING_BOX = 2;
const COMPLEMENT_RANK = 4;

// Lecture seule : un MatrixStore réécrirait les données d'un joueur qui n'en a pas encore
export function readPlayerProgress(storage: StorageService, profileId: string): PlayerProgress {
  const items = storage.get<MultiplicationItem[]>(profileKey("matrix_items", profileId), []);
  const tables = storage.get<number[]>(profileKey("learning_tables", profileId), DEFAULT_LEARNING_TABLES);
  return {
    items: Array.isArray(items) ? items : [],
    learningTables: Array.isArray(tables) ? tables.filter((t) => Number.isInteger(t) && t >= 1 && t <= 10) : DEFAULT_LEARNING_TABLES
  };
}

function toCalculation(a: number, b: number): Calculation {
  return { a, b, result: a * b };
}

// Calculs jamais abordés, dans l'ordre du carnet ; les tables en pause n'y sont pas
function nextNewIds(player: PlayerProgress, byId: Map<string, MultiplicationItem>): string[] {
  const ids: string[] = [];
  for (const a of player.learningTables) {
    for (let b = 1; b <= 10 && ids.length < NEXT_NEW_PER_PLAYER; b++) {
      const id = `${a}x${b}`;
      if ((byId.get(id)?.status ?? "unknown") === "unknown" && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function rankOf(item: MultiplicationItem, now: number): number | null {
  if (item.status === "review") return 1;
  if (item.nextReviewAt !== null && now >= item.nextReviewAt) return 2;
  if (item.status !== "unknown" && item.boxLevel <= LAST_LEARNING_BOX) return 3;
  return null;
}

export function guidedPool(players: PlayerProgress[], now = Date.now()): GuidedEntry[] {
  const entries = new Map<string, GuidedEntry>();
  const complements = new Map<string, number>();

  function add(id: string, a: number, b: number, rank: number) {
    const entry = entries.get(id);
    if (!entry) entries.set(id, { calc: toCalculation(a, b), rank, playerCount: 1 });
    else {
      entry.rank = Math.min(entry.rank, rank);
      entry.playerCount++;
    }
  }

  for (const player of players) {
    const byId = new Map(player.items.map((item) => [item.id, item]));
    const fresh = nextNewIds(player, byId);
    fresh.forEach((id) => {
      const [a, b] = id.split("x").map(Number);
      add(id, a, b, 3);
    });

    for (const item of player.items) {
      if (fresh.includes(item.id)) continue;
      const rank = rankOf(item, now);
      if (rank !== null) add(item.id, item.a, item.b, rank);
      else if (item.status !== "unknown" && item.nextReviewAt !== null) {
        // Boîte 3 à 5 pas encore échu : candidat au complément, par l'échéance la plus proche parmi les joueurs
        complements.set(item.id, Math.min(complements.get(item.id) ?? Infinity, item.nextReviewAt));
      }
    }
  }

  const pool = [...entries.values()].sort((x, y) => x.rank - y.rank || y.playerCount - x.playerCount);
  const missing = MIN_GUIDED_POOL - pool.length;
  if (missing > 0) {
    [...complements.entries()]
      .filter(([id]) => !entries.has(id))
      .sort(([, x], [, y]) => x - y)
      .slice(0, missing)
      .forEach(([id]) => {
        const [a, b] = id.split("x").map(Number);
        pool.push({ calc: toCalculation(a, b), rank: COMPLEMENT_RANK, playerCount: 1 });
      });
  }
  return pool;
}

// Ordre d'entrée de chaque tour : par rang et par nombre de joueurs ; à égalité complète, ce qui n'a pas été
// entendu à la dernière écoute d'abord (au premier tour), puis le hasard
export function guidedRounds(pool: GuidedEntry[], lastHeardIds: string[], random: () => number = Math.random): () => Calculation[] {
  let isFirst = true;
  return () => {
    const groups = new Map<string, Calculation[]>();
    for (const entry of pool) {
      const key = `${entry.rank}:${entry.playerCount}`;
      groups.set(key, [...(groups.get(key) ?? []), entry.calc]);
    }
    const round = [...groups.values()].flatMap((group) => {
      const mixed = shuffled(group, random);
      return isFirst ? heardLast(mixed, lastHeardIds) : mixed;
    });
    isFirst = false;
    return round;
  };
}

export function guidedLabel(names: string[]): string {
  if (names.length <= 1) return `Pour ${names[0] ?? ""}`;
  return `Pour ${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
}

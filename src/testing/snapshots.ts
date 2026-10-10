import { ProfileData, toWheelDate } from "../core/profileData";
import { isGiftUnlocked, MAX_BOX } from "../core/matrixStore";
import { UserProfile } from "../types";

// Le joueur qui porte ce prénom voit le bouton « Scénarios de test » sur l'accueil
export const TEST_PROFILE_NAME = "@test-ci";

export function isTestProfile(profile: UserProfile | null): boolean {
  return profile !== null && profile.name.trim().toLowerCase() === TEST_PROFILE_NAME;
}

export interface SnapshotSummary {
  points: number;
  giftsEarned: number;
  giftsToOpen: number;
  dueCount: number;
  // Nombre de calculs dans chaque boîte, de la Boîte 0 à la Boîte 5
  boxes: number[];
}

export interface SnapshotMeta {
  id: string;
  order: number;
  title: string;
  day: string;
  learner: string;
  description: string;
  checks: string[];
  // Instant simulé de la capture ; les scénarios tournent en UTC
  capturedAt: string;
  summary: SnapshotSummary;
}

export interface ScenarioSnapshot extends SnapshotMeta {
  data: ProfileData;
}

const DAY_MS = 24 * 3600 * 1000;

export function summarizeProfileData(data: ProfileData, now: number): SnapshotSummary {
  const opened = new Set(data.opened_gifts);
  const boxes = Array.from({ length: MAX_BOX + 1 }, () => 0);
  data.matrix_items.forEach((item) => {
    boxes[item.boxLevel] += 1;
  });
  return {
    points: data.points,
    giftsEarned: data.matrix_items.filter(isGiftUnlocked).length,
    giftsToOpen: data.matrix_items.filter((i) => isGiftUnlocked(i) && !opened.has(i.id)).length,
    dueCount: data.matrix_items.filter((i) => i.status === "review" || (i.nextReviewAt !== null && now >= i.nextReviewAt)).length,
    boxes
  };
}

// Recale un snapshot sur aujourd'hui : le jour de capture devient le jour courant.
// Une échéance en jours (minuit) reste à minuit, heure locale ; tout autre instant garde son écart avec la capture.
export function rebaseProfileData(snapshot: ScenarioSnapshot, now: Date = new Date()): ProfileData {
  const captured = new Date(snapshot.capturedAt);
  const capturedMs = captured.getTime();
  const capturedDayUtc = Date.UTC(captured.getUTCFullYear(), captured.getUTCMonth(), captured.getUTCDate());

  function shiftedDay(utcDayMs: number): Date {
    const dayOffset = Math.round((utcDayMs - capturedDayUtc) / DAY_MS);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset);
  }

  function rebase(timestamp: number): number {
    const isDayDeadline = timestamp % DAY_MS === 0;
    return isDayDeadline ? shiftedDay(timestamp).getTime() : now.getTime() + (timestamp - capturedMs);
  }

  const data: ProfileData = JSON.parse(JSON.stringify(snapshot.data));

  data.matrix_items.forEach((item) => {
    if (item.lastReviewedAt !== null) item.lastReviewedAt = rebase(item.lastReviewedAt);
    if (item.nextReviewAt !== null) item.nextReviewAt = rebase(item.nextReviewAt);
  });
  data.attempt_history.forEach((log) => {
    log.timestamp = rebase(log.timestamp);
  });
  if (data.wheel_spins) {
    const [year, month, day] = data.wheel_spins.date.split("-").map(Number);
    data.wheel_spins.date = toWheelDate(shiftedDay(Date.UTC(year, month - 1, day)));
  }
  return data;
}

function snapshotUrl(file: string): string {
  return `${import.meta.env.BASE_URL}snapshots/${file}`;
}

export async function fetchSnapshotIndex(): Promise<SnapshotMeta[]> {
  const res = await fetch(snapshotUrl("index.json"), { cache: "no-store" });
  if (!res.ok) throw new Error(`Liste des snapshots introuvable (${res.status})`);
  return (await res.json()) as SnapshotMeta[];
}

export async function fetchSnapshot(id: string): Promise<ScenarioSnapshot> {
  const res = await fetch(snapshotUrl(`${id}.json`), { cache: "no-store" });
  if (!res.ok) throw new Error(`Snapshot ${id} introuvable (${res.status})`);
  return (await res.json()) as ScenarioSnapshot;
}

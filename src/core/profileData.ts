import { AttemptLog, MultiplicationItem } from "../types";
import { StorageService } from "../services/storageService";

export interface WheelDailyState {
  date: string;
  usedSpins: number;
}

// Tout ce qui est persisté pour un joueur, sous la forme exacte du stockage
export interface ProfileData {
  matrix_items: MultiplicationItem[];
  attempt_history: AttemptLog[];
  practice_time: number;
  opened_gifts: string[];
  points: number;
  // Décors acquis avec d'anciens seuils et conservés ; vide pour un joueur qui n'a connu que les seuils actuels
  kept_bgs: string[];
  wheel_spins?: WheelDailyState;
  active_bg?: string;
}

export type ProfileDataKey = keyof ProfileData;

export const PROFILE_DATA_KEYS: ProfileDataKey[] = [
  "matrix_items",
  "attempt_history",
  "practice_time",
  "opened_gifts",
  "points",
  "kept_bgs",
  "wheel_spins",
  "active_bg"
];

export function profileKey(name: ProfileDataKey, profileId: string): string {
  return `${name}_${profileId}`;
}

// Jour au format de la roue : ses tours se comptent par jour calendaire
export function toWheelDate(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function exportProfileData(storage: StorageService, profileId: string): ProfileData {
  const read = <K extends ProfileDataKey>(name: K, fallback: ProfileData[K]): ProfileData[K] =>
    storage.get<ProfileData[K]>(profileKey(name, profileId), fallback);

  const data: ProfileData = {
    matrix_items: read("matrix_items", []),
    attempt_history: read("attempt_history", []),
    practice_time: read("practice_time", 0),
    opened_gifts: read("opened_gifts", []),
    points: read("points", 0),
    kept_bgs: read("kept_bgs", [])
  };
  const wheel = read("wheel_spins", undefined);
  if (wheel !== undefined) data.wheel_spins = wheel;
  const background = read("active_bg", undefined);
  if (background !== undefined) data.active_bg = background;
  return data;
}

// Efface toutes les données du joueur
export function deleteProfileData(storage: StorageService, profileId: string): void {
  PROFILE_DATA_KEYS.forEach((name) => storage.remove(profileKey(name, profileId)));
}

// Remplace toutes les données du joueur : une clé absente du jeu de données est effacée
export function importProfileData(storage: StorageService, profileId: string, data: ProfileData): void {
  for (const name of PROFILE_DATA_KEYS) {
    const value = data[name];
    if (value === undefined) {
      storage.remove(profileKey(name, profileId));
    } else {
      storage.set(profileKey(name, profileId), value);
    }
  }
}

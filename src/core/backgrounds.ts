import { createStorageService, STORAGE_NAMESPACE } from "../services/storageService";
import { profileKey } from "./profileData";

const storage = createStorageService(STORAGE_NAMESPACE);

export interface BackgroundItem {
  id: string;
  name: string;
  filename: string;
  pointsRequired: number;
}

// Seuils étalés sur le parcours, voir docs/progression-et-recompenses.md :
// à 6 minutes par jour, un décor tous les 2 à 3 jours au début, le dernier vers le 100e jour
export const BACKGROUNDS: BackgroundItem[] = [
  {
    id: "bg-01",
    name: "Printemps",
    filename: "01-printemps.webp",
    pointsRequired: 0
  },
  {
    id: "bg-02",
    name: "Été",
    filename: "02-ete.webp",
    pointsRequired: 1000
  },
  {
    id: "bg-03",
    name: "Hiver",
    filename: "03-hiver.webp",
    pointsRequired: 2500
  },
  {
    id: "bg-04",
    name: "Automne",
    filename: "04-autonne.webp",
    pointsRequired: 4500
  },
  {
    id: "bg-05",
    name: "Pâques",
    filename: "05-paques.webp",
    pointsRequired: 7000
  },
  {
    id: "bg-06",
    name: "Halloween",
    filename: "06-halloween.webp",
    pointsRequired: 10000
  },
  {
    id: "bg-07",
    name: "Noël",
    filename: "07-noel.webp",
    pointsRequired: 13500
  },
  {
    id: "bg-08",
    name: "Monde Plateforme",
    filename: "08-plateforme-style-mario.webp",
    pointsRequired: 18000
  },
  {
    id: "bg-09",
    name: "Monde Fermier",
    filename: "09-farmer-style-stard.webp",
    pointsRequired: 23500
  },
  {
    id: "bg-10",
    name: "Monde Voxel",
    filename: "10-voxel-style-minecraft.webp",
    pointsRequired: 30000
  },
  {
    id: "bg-11",
    name: "Village Gaulois",
    filename: "11-village-gaulois.webp",
    pointsRequired: 38000
  },
  {
    id: "bg-12",
    name: "Ville des Super-Héros",
    filename: "12-ville-super-heros.webp",
    pointsRequired: 47000
  },
  {
    id: "bg-13",
    name: "Ville Steampunk",
    filename: "13-ville-steampunk.webp",
    pointsRequired: 58000
  },
  {
    id: "bg-14",
    name: "Ville Cyberpunk",
    filename: "14-ville-cyberpunk.webp",
    pointsRequired: 72000
  }
];

// Seuils d'avant l'étalement : un décor déjà débloqué avec eux reste acquis
const LEGACY_POINTS_REQUIRED: Record<string, number> = {
  "bg-02": 500,
  "bg-03": 1200,
  "bg-04": 2200,
  "bg-05": 3600,
  "bg-06": 5500,
  "bg-07": 8000,
  "bg-08": 11500,
  "bg-09": 16000,
  "bg-10": 22000
};

const getKeptBgsKey = (profileId: string) => profileKey("kept_bgs", profileId);

// À appeler pour chaque joueur au lancement et à sa création : fige une seule fois les décors acquis avec les anciens seuils
export function keepUnlockedBackgrounds(profileId: string): void {
  if (storage.get<string[] | null>(getKeptBgsKey(profileId), null) !== null) return;
  const points = storage.get<number>(profileKey("points", profileId), 0);
  const kept = Object.keys(LEGACY_POINTS_REQUIRED).filter((id) => points >= LEGACY_POINTS_REQUIRED[id]);
  storage.set(getKeptBgsKey(profileId), kept);
}

export function isBackgroundUnlocked(profileId: string, bg: BackgroundItem, points: number): boolean {
  return points >= bg.pointsRequired || storage.get<string[]>(getKeptBgsKey(profileId), []).includes(bg.id);
}

export function countUnlockedBackgrounds(profileId: string, points: number): number {
  return BACKGROUNDS.filter((bg) => isBackgroundUnlocked(profileId, bg, points)).length;
}

const getActiveBgKey = (profileId: string) => profileKey("active_bg", profileId);

export function getBackgroundById(id: string): BackgroundItem {
  return BACKGROUNDS.find((b) => b.id === id) || BACKGROUNDS[0];
}

export function getActiveBackground(profileId: string): BackgroundItem {
  const savedId = storage.get<string>(getActiveBgKey(profileId), BACKGROUNDS[0].id);
  return getBackgroundById(savedId);
}

export function setActiveBackground(profileId: string, bgId: string): void {
  storage.set(getActiveBgKey(profileId), bgId);
  const bg = getBackgroundById(bgId);
  applyAppBackground(bg.filename);
}

export function applyAppBackground(filename: string): void {
  const bgUrl = `${import.meta.env.BASE_URL}backgrounds/${filename}`;
  document.body.style.backgroundImage = `url("${bgUrl}")`;
  document.body.style.backgroundSize = "cover";
  document.body.style.backgroundPosition = "center center";
  document.body.style.backgroundRepeat = "no-repeat";
  document.body.style.backgroundAttachment = "fixed";
}

export function initAppBackground(profileId: string): void {
  const current = getActiveBackground(profileId);
  applyAppBackground(current.filename);
}

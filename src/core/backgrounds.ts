import { createStorageService } from "../services/storageService";

const storage = createStorageService("mult_clean_v2");

export interface BackgroundItem {
  id: string;
  name: string;
  filename: string;
  pointsRequired: number;
}

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
    pointsRequired: 500
  },
  {
    id: "bg-03",
    name: "Hiver",
    filename: "03-hiver.webp",
    pointsRequired: 1200
  },
  {
    id: "bg-04",
    name: "Automne",
    filename: "04-autonne.webp",
    pointsRequired: 2200
  },
  {
    id: "bg-05",
    name: "Pâques",
    filename: "05-paques.webp",
    pointsRequired: 3600
  },
  {
    id: "bg-06",
    name: "Halloween",
    filename: "06-halloween.webp",
    pointsRequired: 5500
  },
  {
    id: "bg-07",
    name: "Noël",
    filename: "07-noel.webp",
    pointsRequired: 8000
  },
  {
    id: "bg-08",
    name: "Monde Plateforme",
    filename: "08-plateforme-style-mario.webp",
    pointsRequired: 11500
  },
  {
    id: "bg-09",
    name: "Monde Fermier",
    filename: "09-farmer-style-stard.webp",
    pointsRequired: 16000
  },
  {
    id: "bg-10",
    name: "Monde Voxel",
    filename: "10-voxel-style-minecraft.webp",
    pointsRequired: 22000
  }
];

const getActiveBgKey = (profileId: string) => `active_bg_${profileId}`;

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
  const bgUrl = `/backgrounds/${filename}`;
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

import { STORAGE_NAMESPACE } from "./storageService";
import { SyncMeta } from "./cloudMerge";

// Identifiant OAuth de l'application dans Google Cloud. Il est public par nature : il désigne l'application,
// il ne donne aucun accès. Les origines autorisées à s'en servir se règlent dans la console Google Cloud.
export const GOOGLE_CLIENT_ID = "22937077279-8h7e530vvfuj8olqi055firjg5jk93cq.apps.googleusercontent.com";

export interface AppDataBackup {
  version: number;
  appName: string;
  exportedAt: number;
  data: Record<string, any>;
  // Ce qu'il faut pour fusionner deux appareils ; absent d'un fichier exporté à la main ou d'avant la fusion
  sync?: SyncMeta;
}

// Sauvegarde présente dans le Drive ; l'empreinte change dès que son contenu change, d'où qu'il vienne
export interface RemoteBackupInfo {
  id: string;
  md5: string;
  modifiedTime: string;
}

// Jeton refusé par Google : expiré ou autorisation retirée
export class DriveAuthError extends Error {}

const BACKUP_FILE_NAME = "multiplication_backup.json";
export const DRIVE_APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";
const BACKUP_FIELDS = "id,modifiedTime,md5Checksum";

declare global {
  interface Window {
    google?: any;
  }
}

export function exportAllAppData(namespace = STORAGE_NAMESPACE): AppDataBackup {
  const result: Record<string, any> = {};
  const prefix = `${namespace}:`;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix)) {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        try {
          result[key] = JSON.parse(raw);
        } catch {
          result[key] = raw;
        }
      }
    }
  }
  return {
    version: 1,
    appName: "multiplication-pwa",
    exportedAt: Date.now(),
    data: result
  };
}

export function importAllAppData(backup: AppDataBackup, namespace = STORAGE_NAMESPACE): boolean {
  if (!backup || !backup.data || typeof backup.data !== "object") {
    throw new Error("Format de sauvegarde invalide");
  }
  const prefix = `${namespace}:`;
  for (const [k, v] of Object.entries(backup.data)) {
    if (k.startsWith(prefix)) {
      localStorage.setItem(k, JSON.stringify(v));
    }
  }
  return true;
}

export function downloadLocalBackup(backup: AppDataBackup): void {
  const str = JSON.stringify(backup, null, 2);
  const blob = new Blob([str], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const dateStr = new Date().toISOString().slice(0, 10);
  a.download = `multiplication_backup_${dateStr}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function readLocalBackupFile(file: File): Promise<AppDataBackup> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const obj = JSON.parse(reader.result as string);
        resolve(obj);
      } catch {
        reject(new Error("Fichier JSON invalide"));
      }
    };
    reader.onerror = () => reject(new Error("Erreur lecture fichier"));
    reader.readAsText(file);
  });
}

export function loadGsiScript(): Promise<void> {
  if (window.google?.accounts?.oauth2) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Erreur chargement script Google Identity")));
      return;
    }
    const script = document.createElement("script");
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Sans ce retrait, une nouvelle tentative attendrait indéfiniment un script déjà en échec
      script.remove();
      reject(new Error("Erreur chargement script Google Identity"));
    };
    document.head.appendChild(script);
  });
}

async function driveFetch(accessToken: string, url: string, init: RequestInit, action: string): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${accessToken}` } });
  if (res.status === 401) throw new DriveAuthError("Connexion Google expirée");
  if (!res.ok) throw new Error(`${action} : erreur ${res.status} de Google Drive`);
  return res;
}

function toBackupInfo(file: { id: string; md5Checksum?: string; modifiedTime?: string }): RemoteBackupInfo {
  return { id: file.id, md5: file.md5Checksum ?? "", modifiedTime: file.modifiedTime ?? "" };
}

export async function findDriveBackup(accessToken: string): Promise<RemoteBackupInfo | null> {
  const query = encodeURIComponent(`name = '${BACKUP_FILE_NAME}' and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}&fields=files(${BACKUP_FIELDS})`;
  const res = await driveFetch(accessToken, url, { method: "GET" }, "Recherche de la sauvegarde");
  const files = ((await res.json()).files ?? []) as { id: string }[];
  return files.length > 0 ? toBackupInfo(files[0]) : null;
}

// Écrit la sauvegarde : remplace le fichier existant, ou le crée dans le dossier caché de l'application
export async function uploadDriveBackup(accessToken: string, content: string, existingId: string | null): Promise<RemoteBackupInfo> {
  if (existingId) {
    const url = `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media&fields=${BACKUP_FIELDS}`;
    const res = await driveFetch(
      accessToken,
      url,
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: content },
      "Envoi de la sauvegarde"
    );
    return toBackupInfo(await res.json());
  }

  const boundary = "drive_app_data_boundary_multiplication";
  const body =
    `\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: BACKUP_FILE_NAME, parents: ["appDataFolder"] }) +
    `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n` +
    content +
    `\r\n--${boundary}--`;
  const url = `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=${BACKUP_FIELDS}`;
  const res = await driveFetch(
    accessToken,
    url,
    { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body },
    "Création de la sauvegarde"
  );
  return toBackupInfo(await res.json());
}

export async function downloadDriveBackup(accessToken: string, fileId: string): Promise<AppDataBackup> {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await driveFetch(accessToken, url, { method: "GET" }, "Téléchargement de la sauvegarde");
  return (await res.json()) as AppDataBackup;
}

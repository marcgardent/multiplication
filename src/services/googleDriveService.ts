import { StorageService, STORAGE_NAMESPACE } from "./storageService";

export interface AppDataBackup {
  version: number;
  appName: string;
  exportedAt: number;
  data: Record<string, any>;
}

export interface GoogleDriveFileInfo {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
}

const BACKUP_FILE_NAME = "multiplication_backup.json";
const DRIVE_APP_DATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const GIS_SCRIPT_URL = "https://accounts.google.com/gsi/client";

declare global {
  interface Window {
    google?: any;
  }
}

export function getSavedClientId(storage: StorageService): string {
  const envId = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID;
  return storage.get<string>("google_client_id", envId || "");
}

export function saveClientId(storage: StorageService, clientId: string): void {
  storage.set<string>("google_client_id", clientId.trim());
}

export function getLastSyncTime(storage: StorageService): number {
  return storage.get<number>("last_drive_sync_time", 0);
}

export function setLastSyncTime(storage: StorageService, timestamp: number): void {
  storage.set<number>("last_drive_sync_time", timestamp);
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
    script.onerror = () => reject(new Error("Erreur chargement script Google Identity"));
    document.head.appendChild(script);
  });
}

export function requestGoogleAccessToken(clientId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts?.oauth2) {
      reject(new Error("Module Google Identity non initialise"));
      return;
    }

    try {
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_APP_DATA_SCOPE,
        callback: (resp: any) => {
          if (resp.error) {
            reject(new Error(resp.error_description || resp.error));
            return;
          }
          if (!resp.access_token) {
            reject(new Error("Jeton d acces non recu"));
            return;
          }
          resolve(resp.access_token);
        }
      });
      tokenClient.requestAccessToken();
    } catch (err: any) {
      reject(new Error(err?.message || "Erreur ouverture fenetre Google"));
    }
  });
}

export async function findDriveBackupFile(accessToken: string): Promise<GoogleDriveFileInfo | null> {
  const query = encodeURIComponent(`name = '${BACKUP_FILE_NAME}' and trashed = false`);
  const url = `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${query}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Erreur recherche Google Drive : ${res.status} ${errText}`);
  }

  const json = await res.json();
  const files: GoogleDriveFileInfo[] = json.files || [];
  if (files.length === 0) {
    return null;
  }
  return files[0];
}

export async function uploadDriveBackup(accessToken: string, backup: AppDataBackup): Promise<GoogleDriveFileInfo> {
  const existingFile = await findDriveBackupFile(accessToken);
  const dataContent = JSON.stringify(backup, null, 2);

  if (existingFile) {
    const updateUrl = `https://www.googleapis.com/upload/drive/v3/files/${existingFile.id}?uploadType=media`;
    const res = await fetch(updateUrl, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: dataContent
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erreur mise a jour Google Drive : ${res.status} ${errText}`);
    }

    const updated = await res.json();
    return updated;
  } else {
    const boundary = "drive_app_data_boundary_multiplication";
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = {
      name: BACKUP_FILE_NAME,
      parents: ["appDataFolder"]
    };

    const multipartRequestBody =
      delimiter +
      "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(metadata) +
      delimiter +
      "Content-Type: application/json\r\n\r\n" +
      dataContent +
      closeDelimiter;

    const createUrl = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
    const res = await fetch(createUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`
      },
      body: multipartRequestBody
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erreur creation Google Drive : ${res.status} ${errText}`);
    }

    const created = await res.json();
    return created;
  }
}

export async function downloadDriveBackup(accessToken: string): Promise<AppDataBackup> {
  const existingFile = await findDriveBackupFile(accessToken);
  if (!existingFile) {
    throw new Error("Aucun fichier de sauvegarde trouve dans Google Drive");
  }

  const downloadUrl = `https://www.googleapis.com/drive/v3/files/${existingFile.id}?alt=media`;
  const res = await fetch(downloadUrl, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Erreur telechargement Google Drive : ${res.status} ${errText}`);
  }

  const backupData = await res.json();
  return backupData as AppDataBackup;
}

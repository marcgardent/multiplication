// Synchronisation des voix enregistrées avec le Drive, à côté de la sauvegarde des joueurs.
// Règle de docs/sauvegarde-et-fusion.md : pour chaque voix, la plus récente l'emporte, retrait compris.

import { DriveAuthError, RemoteVoice } from "../services/googleDriveService";
import { StorageService } from "../services/storageService";
import { VoiceRecord } from "./voiceStore";

export interface VoiceRecords {
  records(): Promise<Map<string, VoiceRecord>>;
  write(file: string, record: VoiceRecord): Promise<void>;
}

export interface VoiceDrive {
  list(token: string): Promise<RemoteVoice[]>;
  upload(token: string, voice: { file: string; at: number; wav: Blob | null }, existingId: string | null): Promise<void>;
  download(token: string, id: string): Promise<Blob>;
}

export interface VoiceSyncDeps {
  voices: VoiceRecords;
  drive: VoiceDrive;
  // Réglages de la sauvegarde : retient qu'une voix attend d'être envoyée, même après fermeture de l'application
  settings: StorageService;
  // Jeton Google déjà obtenu par la sauvegarde des joueurs ; nul tant qu'elle n'en a pas
  getToken(): string | null;
  isEnabled(): boolean;
  isOnline(): boolean;
  debounceMs?: number;
}

export interface VoiceSync {
  // Une voix vient d'être enregistrée ou retirée sur cet appareil
  notifyLocalChange(): void;
  // Regarder ce que les autres appareils ont envoyé : lancement, retour au premier plan
  requestCheck(): Promise<void>;
  // Fait ce qui attend, si la connexion Google est là ; pendant un passage en cours, attend aussi sa reprise
  run(): Promise<void>;
}

export interface VoicePlan {
  upload: string[];
  download: string[];
}

const DIRTY_KEY = "voices_dirty";
const DEBOUNCE_MS = 3000;

// Pour chaque voix, la plus récente des deux l'emporte ; à date égale, rien ne bouge
export function planVoiceSync(local: Map<string, { at: number }>, remote: Map<string, { at: number }>): VoicePlan {
  const files = new Set([...local.keys(), ...remote.keys()]);
  const plan: VoicePlan = { upload: [], download: [] };
  files.forEach((file) => {
    const mine = local.get(file)?.at ?? -1;
    const theirs = remote.get(file)?.at ?? -1;
    if (mine > theirs) plan.upload.push(file);
    else if (theirs > mine) plan.download.push(file);
  });
  return plan;
}

export function createVoiceSync(deps: VoiceSyncDeps): VoiceSync {
  const { settings, drive, voices } = deps;
  const debounceMs = deps.debounceMs ?? DEBOUNCE_MS;
  let wantsCheck = false;
  let current: Promise<void> | null = null;
  let runAgain = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const isDirty = () => settings.get<boolean>(DIRTY_KEY, false);

  async function sync(token: string) {
    const remoteList = await drive.list(token);
    const remote = new Map(remoteList.map((voice) => [voice.file, voice]));
    const local = await voices.records();
    const plan = planVoiceSync(local, remote);

    for (const file of plan.upload) {
      const record = local.get(file) as VoiceRecord;
      await drive.upload(token, { file, at: record.at, wav: record.wav }, remote.get(file)?.id ?? null);
    }
    for (const file of plan.download) {
      const voice = remote.get(file) as RemoteVoice;
      const wav = voice.deleted ? null : await drive.download(token, voice.id);
      await voices.write(file, { wav, at: voice.at });
    }
  }

  async function once(): Promise<void> {
    if (!deps.isEnabled() || !deps.isOnline() || (!isDirty() && !wantsCheck)) return;
    const token = deps.getToken();
    // Sans jeton, on attend que la sauvegarde des joueurs en obtienne un : elle relancera
    if (!token) return;

    const checked = wantsCheck;
    try {
      // Une voix enregistrée pendant l'envoi remet ce drapeau : elle partira au passage suivant
      settings.set(DIRTY_KEY, false);
      await sync(token);
      if (checked) wantsCheck = false;
    } catch (err) {
      settings.set(DIRTY_KEY, true);
      if (!(err instanceof DriveAuthError)) console.warn("Synchronisation des voix interrompue", err);
    }
  }

  function run(): Promise<void> {
    if (timer) clearTimeout(timer);
    timer = null;
    if (current) {
      runAgain = true;
      return current;
    }
    current = (async () => {
      do {
        runAgain = false;
        await once();
      } while (runAgain);
    })().finally(() => {
      current = null;
    });
    return current;
  }

  return {
    notifyLocalChange() {
      settings.set(DIRTY_KEY, true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => run(), debounceMs);
    },

    requestCheck() {
      wantsCheck = true;
      return run();
    },

    run
  };
}

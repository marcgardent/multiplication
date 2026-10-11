import { AppDataBackup, DriveAuthError, RemoteBackupInfo } from "./googleDriveService";
import { StorageService } from "./storageService";
import { canonical, counterVector, familyOf, mergeDocs, sumVector, SyncDoc, SyncMeta, withoutDeviceKeys } from "./cloudMerge";

// Sauvegarde automatique : chaque écriture de l'application part dans le Google Drive du parent, sans rien lui demander.
// Les écritures rapprochées sont regroupées en un seul envoi. Quand un autre appareil a écrit entre-temps,
// les deux sauvegardes sont fusionnées selon docs/sauvegarde-et-fusion.md, puis le résultat est renvoyé.

export type CloudSyncStatus = "off" | "synced" | "pending" | "attention";
// Ce qui demande l'intervention du parent : se reconnecter, choisir entre deux sauvegardes, ou une erreur de Google
export type CloudSyncIssue = "signin" | "conflict" | "error";

export interface CloudSyncState {
  status: CloudSyncStatus;
  issue: CloudSyncIssue | null;
  lastPushAt: number;
  // Date de la sauvegarde trouvée dans le Drive lors d'un conflit ; vide si elle n'a pas pu être lue
  remoteModifiedTime: string;
  errorMessage: string;
}

// Connexion impossible pour l'instant (hors ligne) : on réessaiera, sans déranger personne
export class CloudUnavailableError extends Error {}

export interface CloudAuth {
  // Jeton encore valable, sans rien demander à Google
  getToken(): string | null;
  // Ouvre la fenêtre Google : à appeler pendant un clic. "choose" laisse choisir le compte
  requestToken(mode: "choose" | "silent"): Promise<string>;
  // Redemande un jeton au prochain toucher sur un écran calme ; la fenêtre Google se referme seule
  requestTokenOnNextGesture(): Promise<string>;
  forgetToken(): void;
}

export interface CloudDrive {
  find(token: string): Promise<RemoteBackupInfo | null>;
  upload(token: string, content: string, existingId: string | null): Promise<RemoteBackupInfo>;
  download(token: string, fileId: string): Promise<AppDataBackup>;
}

export interface CloudSyncDeps {
  // Réglages de la sauvegarde, rangés hors des données sauvegardées
  settings: StorageService;
  auth: CloudAuth;
  drive: CloudDrive;
  exportBackup(): AppDataBackup;
  importBackup(backup: AppDataBackup): void;
  // Retire de l'appareil des données qui n'existent plus : celles d'un joueur supprimé depuis un autre appareil
  removeKeys?(fullKeys: string[]): void;
  hash(text: string): Promise<string>;
  isOnline(): boolean;
  // Une séance est en cours : une fusion modifierait les données sous les pieds de l'enfant, elle attend
  isBusy?(): boolean;
  // Les données de l'appareil viennent d'être modifiées par une fusion : l'écran doit les relire
  onMerged?(): void;
  newId?(): string;
  debounceMs?: number;
  maxWaitMs?: number;
  retryMs?: number;
  busyRetryMs?: number;
}

export interface CloudSync {
  getState(): CloudSyncState;
  subscribe(listener: (state: CloudSyncState) => void): () => void;
  // Au lancement de l'application : reprend un envoi resté en attente et regarde ce que les autres appareils ont envoyé
  start(): void;
  // À chaque écriture dans le stockage de l'application
  notifyLocalChange(fullKey?: string): void;
  // Envoie tout de suite ce qui attend : retour du réseau, application qui passe en arrière-plan
  flush(): Promise<void>;
  // Regarde aussi ce que les autres appareils ont envoyé : retour au premier plan
  refresh(): Promise<void>;
  // Les données de l'appareil viennent d'être remplacées volontairement (import d'un fichier, scénario de test) :
  // elles remplaceront la sauvegarde du Drive au lieu de fusionner avec elle
  startNewLineage(): void;
  // Les quatre actions suivantes ouvrent la fenêtre Google : à appeler pendant un clic
  enable(): Promise<void>;
  reconnect(): Promise<void>;
  // Conflit : garder les données de cet appareil et remplacer la sauvegarde du Drive
  keepLocal(): Promise<void>;
  // Conflit ou restauration demandée : remplacer les données de cet appareil par la sauvegarde du Drive
  restoreRemote(): Promise<void>;
  disable(): void;
}

// Regroupe les réponses d'une séance : un envoi 8 secondes après la dernière écriture, au plus tard après 30 secondes
const DEBOUNCE_MS = 8000;
const MAX_WAIT_MS = 30000;
const RETRY_MS = 60000;
const BUSY_RETRY_MS = 15000;
const SETTING_KEYS = ["enabled", "dirty", "remote_md5", "pushed_hash", "last_push_at", "device_id", "lineage", "counters", "times", "force_push", "merging"];

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 10)}`;
}

export function createCloudSync(deps: CloudSyncDeps): CloudSync {
  const { settings, auth, drive } = deps;
  const debounceMs = deps.debounceMs ?? DEBOUNCE_MS;
  const maxWaitMs = deps.maxWaitMs ?? MAX_WAIT_MS;
  const retryMs = deps.retryMs ?? RETRY_MS;
  const busyRetryMs = deps.busyRetryMs ?? BUSY_RETRY_MS;
  const newId = deps.newId ?? randomId;
  const isBusy = deps.isBusy ?? (() => false);

  const listeners = new Set<(state: CloudSyncState) => void>();
  let issue: CloudSyncIssue | null = null;
  let errorMessage = "";
  let remoteModifiedTime = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let waitingSince = 0;
  let isRunning = false;
  let changedWhileRunning = false;
  // Le Drive est à regarder même sans rien à envoyer : lancement, retour au premier plan, fusion remise à plus tard
  let wantsRemoteCheck = false;
  let tokenRequest: Promise<string> | null = null;

  const isEnabled = () => settings.get<boolean>("enabled", false);
  const isDirty = () => settings.get<boolean>("dirty", false);
  const lineage = () => settings.get<string>("lineage", "");

  function deviceId(): string {
    let id = settings.get<string>("device_id", "");
    if (!id) {
      id = newId();
      settings.set("device_id", id);
    }
    return id;
  }

  function getState(): CloudSyncState {
    // Regarder le Drive sans rien avoir à envoyer n'est pas une attente : la pastille reste verte
    const status: CloudSyncStatus = !isEnabled() ? "off" : issue ? "attention" : isDirty() ? "pending" : "synced";
    return { status, issue, lastPushAt: settings.get<number>("last_push_at", 0), remoteModifiedTime, errorMessage };
  }

  function emit() {
    const state = getState();
    listeners.forEach((listener) => listener(state));
  }

  function setIssue(next: CloudSyncIssue | null, message = "") {
    issue = next;
    errorMessage = message;
    if (next !== "conflict") remoteModifiedTime = "";
    emit();
  }

  function setDirty(dirty: boolean) {
    if (isDirty() !== dirty) settings.set("dirty", dirty);
  }

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function schedule(delayMs: number) {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      run();
    }, delayMs);
  }

  // Jeton pour un envoi en arrière-plan : celui en cours, ou un nouveau au prochain toucher
  function backgroundToken(): Promise<string> {
    const valid = auth.getToken();
    if (valid) return Promise.resolve(valid);
    if (!tokenRequest) {
      tokenRequest = auth.requestTokenOnNextGesture().finally(() => {
        tokenRequest = null;
      });
    }
    return tokenRequest;
  }

  // Jeton pour une action demandée par un clic du parent
  function clickToken(mode: "choose" | "silent"): Promise<string> {
    return auth.getToken() ? Promise.resolve(auth.getToken() as string) : auth.requestToken(mode);
  }

  // Les données de l'appareil avec ce qu'il faut pour les fusionner.
  // La part de cet appareil dans un compteur est son total moins ce que les autres y ont apporté.
  function localDoc(remote: SyncDoc | null): SyncDoc {
    const data = deps.exportBackup().data;
    const device = deviceId();
    const known = settings.get<SyncMeta["counters"]>("counters", {});
    const counters: SyncMeta["counters"] = {};

    Object.keys(data)
      .filter((key) => familyOf(key) === "counter")
      .forEach((key) => {
        const total = Number(data[key]) || 0;
        const vector = known[key];
        const others = vector ? sumVector(vector) - (vector[device] ?? 0) : 0;
        // Premier contact avec ce compteur : ne compte comme sien que ce que l'appareil a de plus que le Drive
        const own = vector
          ? Math.max(total - others, vector[device] ?? 0)
          : Math.max(0, total - (remote ? sumVector(counterVector(remote, key)) : 0));
        counters[key] = { ...vector };
        if (own > 0) counters[key][device] = own;
      });

    return { data, sync: { lineage: lineage(), counters, times: settings.get<SyncMeta["times"]>("times", {}) } };
  }

  // Empreinte de ce que l'appareil partage avec les autres : le joueur connecté n'en fait pas partie
  function localFingerprint(): Promise<string> {
    return deps.hash(canonical(withoutDeviceKeys(deps.exportBackup().data)));
  }

  function rememberSync(remote: RemoteBackupInfo, hash: string) {
    settings.set("remote_md5", remote.md5);
    settings.set("pushed_hash", hash);
    settings.set("last_push_at", Date.now());
  }

  async function upload(token: string, existingId: string | null) {
    if (!lineage()) settings.set("lineage", newId());
    // Photographie prise d'un seul tenant : l'empreinte retenue est bien celle de ce qui part
    const doc = localDoc(null);
    const backup: AppDataBackup = { version: 2, appName: "multiplication-pwa", exportedAt: Date.now(), data: doc.data, sync: doc.sync };
    changedWhileRunning = false;
    const hash = await deps.hash(canonical(withoutDeviceKeys(doc.data)));
    rememberSync(await drive.upload(token, JSON.stringify(backup), existingId), hash);
    settings.set("counters", doc.sync.counters);
  }

  function postpone() {
    wantsRemoteCheck = true;
    schedule(busyRetryMs);
  }

  // Le Drive a changé depuis la dernière fois. Renvoie nul si rien n'a pu être fait ; sinon dit s'il reste
  // quelque chose à envoyer au Drive, avec l'empreinte du résultat de la fusion
  async function mergeWithRemote(token: string, remote: RemoteBackupInfo): Promise<{ hasNewsForDrive: boolean; mergedHash: string } | null> {
    if (isBusy()) {
      postpone();
      return null;
    }
    const backup = await drive.download(token, remote.id);
    if (isBusy()) {
      postpone();
      return null;
    }

    if (lineage() && backup.sync?.lineage !== lineage()) {
      // Un parent a remplacé la sauvegarde depuis un autre appareil : à lui de dire laquelle garder
      remoteModifiedTime = remote.modifiedTime;
      setIssue("conflict");
      return null;
    }

    // À partir d'ici tout est synchrone : aucune réponse de l'enfant ne peut s'intercaler entre la lecture et l'écriture
    const remoteDoc: SyncDoc = { data: backup.data ?? {}, sync: backup.sync ?? { lineage: "", counters: {}, times: {} } };
    const local = localDoc(remoteDoc);
    const merged = mergeDocs(local, remoteDoc);
    const hasNewsForDevice = canonical(merged.data) !== canonical(local.data);

    if (hasNewsForDevice) {
      settings.set("merging", true);
      deps.importBackup({ version: 2, appName: "multiplication-pwa", exportedAt: Date.now(), data: merged.data });
      const removed = Object.keys(local.data).filter((key) => !(key in merged.data));
      if (removed.length > 0) deps.removeKeys?.(removed);
    }
    settings.set("counters", merged.sync.counters);
    settings.set("times", merged.sync.times);
    settings.set("lineage", merged.sync.lineage || newId());
    settings.set("remote_md5", remote.md5);
    if (hasNewsForDevice) {
      settings.remove("merging");
      deps.onMerged?.();
    }

    const shared = (doc: SyncDoc) => canonical({ data: withoutDeviceKeys(doc.data), sync: doc.sync });
    const hasNewsForDrive = !backup.sync || shared({ data: merged.data, sync: { ...merged.sync, lineage: lineage() } }) !== shared(remoteDoc);
    return { hasNewsForDrive, mergedHash: await deps.hash(canonical(withoutDeviceKeys(merged.data))) };
  }

  function handleFailure(err: unknown) {
    if (err instanceof CloudUnavailableError || err instanceof TypeError || !deps.isOnline()) {
      // Réseau absent ou coupé : l'envoi reste en attente
      schedule(retryMs);
      emit();
    } else if (err instanceof DriveAuthError) {
      auth.forgetToken();
      schedule(0);
    } else {
      setIssue("error", err instanceof Error ? err.message : "Erreur inconnue");
    }
  }

  async function run(): Promise<void> {
    clearTimer();
    if (!isEnabled() || issue === "conflict" || issue === "signin") return;
    if (isRunning) {
      changedWhileRunning = true;
      return;
    }
    if ((!isDirty() && !wantsRemoteCheck) || !deps.isOnline()) return;

    isRunning = true;
    waitingSince = 0;
    try {
      const mustReplace = settings.get<boolean>("force_push", false);
      const pushedHash = () => settings.get<string>("pushed_hash", "");
      // Écriture sans changement réel et rien à vérifier : rien à envoyer, donc personne à déranger
      if (!wantsRemoteCheck && !mustReplace && (await localFingerprint()) === pushedHash()) {
        setDirty(false);
        setIssue(null);
        return;
      }

      let token: string;
      try {
        token = await backgroundToken();
      } catch (err) {
        if (err instanceof CloudUnavailableError) throw err;
        setIssue("signin");
        return;
      }
      if (!isEnabled()) return;
      changedWhileRunning = false;

      const remote = await drive.find(token);
      let hasNewsForDrive = true;
      if (mustReplace) {
        // Le parent a décidé que cet appareil fait foi : pas de fusion
      } else if (remote && remote.md5 !== settings.get<string>("remote_md5", "")) {
        const outcome = await mergeWithRemote(token, remote);
        if (outcome === null) return;
        hasNewsForDrive = outcome.hasNewsForDrive;
        // Le Drive a déjà tout : ce qui est « envoyé » est le résultat de la fusion, pas une écriture arrivée depuis
        if (!hasNewsForDrive) settings.set("pushed_hash", outcome.mergedHash);
      } else if (remote) {
        hasNewsForDrive = (await localFingerprint()) !== pushedHash();
      }
      wantsRemoteCheck = false;

      if (hasNewsForDrive) await upload(token, remote?.id ?? null);
      settings.remove("force_push");
      // Une écriture arrivée pendant l'envoi n'est pas dans ce qui vient de partir
      setDirty(changedWhileRunning);
      setIssue(null);
    } catch (err) {
      handleFailure(err);
    } finally {
      isRunning = false;
      if (changedWhileRunning) {
        changedWhileRunning = false;
        if (isEnabled() && !issue && !timer) schedule(debounceMs);
      }
      emit();
    }
  }

  function refresh(): Promise<void> {
    wantsRemoteCheck = true;
    return run();
  }

  function openNewLineage() {
    settings.set("lineage", newId());
    settings.set("counters", {});
    settings.set("force_push", true);
    settings.remove("merging");
    setDirty(true);
  }

  return {
    getState,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start() {
      if (!isEnabled()) return;
      if (settings.get<boolean>("merging", false)) {
        // L'application a été fermée en pleine fusion : les données de l'appareil ne sont pas sûres, le parent choisit
        setIssue("conflict");
        return;
      }
      // Le jeton ne vit qu'une heure : on en reprend un dès le premier toucher, avant la séance plutôt qu'au milieu
      backgroundToken().catch((err) => {
        if (!(err instanceof CloudUnavailableError) && isEnabled()) setIssue("signin");
      });
      wantsRemoteCheck = true;
      schedule(0);
    },

    notifyLocalChange(fullKey) {
      if (!isEnabled()) return;
      if (fullKey && familyOf(fullKey) === "setting") {
        settings.set("times", { ...settings.get<SyncMeta["times"]>("times", {}), [fullKey]: Date.now() });
      }
      setDirty(true);
      if (isRunning) changedWhileRunning = true;
      if (issue === "error") setIssue(null);
      if (issue) return;

      const now = Date.now();
      if (!waitingSince) waitingSince = now;
      schedule(Math.max(0, Math.min(debounceMs, waitingSince + maxWaitMs - now)));
      emit();
    },

    flush: run,
    refresh,

    startNewLineage() {
      if (!isEnabled()) return;
      openNewLineage();
      if (!issue) schedule(0);
      emit();
    },

    async enable() {
      await auth.requestToken("choose");
      settings.set("enabled", true);
      setDirty(true);
      setIssue(null);
      await refresh();
    },

    async reconnect() {
      await clickToken("silent");
      setIssue(null);
      await refresh();
    },

    async keepLocal() {
      await clickToken("silent");
      openNewLineage();
      setIssue(null);
      await run();
    },

    async restoreRemote() {
      const token = await clickToken("silent");
      const remote = await drive.find(token);
      if (!remote) throw new Error("Aucune sauvegarde dans votre Google Drive");
      const backup = await drive.download(token, remote.id);
      // Remplacement complet : ce que la sauvegarde n'a pas disparaît de l'appareil, sauf ce qui lui est propre
      const removed = Object.keys(deps.exportBackup().data).filter((key) => !(key in backup.data) && familyOf(key) !== "device");
      deps.importBackup(backup);
      if (removed.length > 0) deps.removeKeys?.(removed);

      // L'appareil rejoint la lignée du Drive et repart de sa répartition des compteurs
      settings.set("lineage", backup.sync?.lineage || newId());
      settings.set("counters", backup.sync?.counters ?? {});
      settings.set("times", backup.sync?.times ?? {});
      settings.remove("force_push");
      settings.remove("merging");
      rememberSync(remote, await localFingerprint());
      clearTimer();
      setIssue(null);
      // Un ancien fichier ne porte pas de lignée : on le renvoie pour que les autres appareils puissent la suivre
      if (!backup.sync) {
        settings.set("pushed_hash", "");
        setDirty(true);
        schedule(0);
      } else {
        setDirty(false);
      }
    },

    disable() {
      clearTimer();
      auth.forgetToken();
      wantsRemoteCheck = false;
      SETTING_KEYS.forEach((key) => settings.remove(key));
      setIssue(null);
    }
  };
}

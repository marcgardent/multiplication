import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CloudUnavailableError, createCloudSync } from "./cloudSyncService";
import { canonical, withoutDeviceKeys } from "./cloudMerge";
import { AppDataBackup, DriveAuthError, RemoteBackupInfo } from "./googleDriveService";
import { createMemoryStorage } from "./storageService";
import { MultiplicationItem, UserProfile } from "../types";

const NS = "mult_clean_v3:";
const POINTS = `${NS}points_p-1`;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

// Faux Google Drive, partagé entre les appareils d'un même test : il ne contient que la sauvegarde
function createDrive() {
  let file: { info: RemoteBackupInfo; content: string } | null = null;
  let revision = 0;
  const calls = { upload: 0, find: 0, download: 0 };
  let nextError: Error | null = null;

  function write(content: string): RemoteBackupInfo {
    revision++;
    file = { info: { id: "fichier", md5: `md5-${revision}`, modifiedTime: `jour-${revision}` }, content };
    return file.info;
  }

  return {
    calls,
    write,
    backup: () => (file ? (JSON.parse(file.content) as AppDataBackup) : null),
    failNextCall(err: Error) {
      nextError = err;
    },
    api: {
      async find() {
        calls.find++;
        if (nextError) {
          const err = nextError;
          nextError = null;
          throw err;
        }
        return file?.info ?? null;
      },
      async upload(_token: string, content: string) {
        calls.upload++;
        return write(content);
      },
      async download() {
        calls.download++;
        return JSON.parse((file as { content: string }).content) as AppDataBackup;
      }
    }
  };
}

type Drive = ReturnType<typeof createDrive>;

// Un appareil : son stockage, sa connexion Google et sa synchronisation
function createDevice(drive: Drive, name: string, initial: Record<string, unknown> = {}) {
  const local: Record<string, unknown> = clone(initial);
  let token: string | null = null;
  let isOnline = true;
  let isBusy = false;
  let gesture: { resolve(token: string): void; reject(err: Error): void } | null = null;
  let idCount = 0;
  let uploadGate: Promise<void> | null = null;
  const calls = { gestureRequests: 0, windows: 0, merged: 0 };
  const settings = createMemoryStorage();

  const sync = createCloudSync({
    settings,
    auth: {
      getToken: () => token,
      async requestToken() {
        calls.windows++;
        token = "jeton";
        return token;
      },
      requestTokenOnNextGesture() {
        calls.gestureRequests++;
        if (!isOnline) return Promise.reject(new CloudUnavailableError("hors ligne"));
        return new Promise<string>((resolve, reject) => {
          gesture = {
            resolve(value) {
              token = value;
              resolve(value);
            },
            reject
          };
        });
      },
      forgetToken() {
        token = null;
      }
    },
    drive: {
      ...drive.api,
      async upload(accessToken, content) {
        if (uploadGate) await uploadGate;
        return drive.api.upload(accessToken, content);
      }
    },
    exportBackup: () => ({ version: 1, appName: "test", exportedAt: Date.now(), data: clone(local) }),
    importBackup(backup) {
      Object.assign(local, clone(backup.data));
    },
    removeKeys(fullKeys) {
      fullKeys.forEach((fullKey) => delete local[fullKey]);
    },
    hash: async (text) => text,
    isOnline: () => isOnline,
    isBusy: () => isBusy,
    onMerged: () => {
      calls.merged++;
    },
    newId: () => `${name}-${++idCount}`,
    debounceMs: 1000,
    maxWaitMs: 5000,
    retryMs: 10000,
    busyRetryMs: 2000
  });

  return {
    sync,
    calls,
    local,
    settings,
    // Une écriture de l'application
    write(key: string, value: unknown) {
      local[NS + key] = value;
      sync.notifyLocalChange(NS + key);
    },
    // Une suppression de donnée par l'application
    remove(key: string) {
      delete local[NS + key];
      sync.notifyLocalChange(NS + key);
    },
    // Des points gagnés, comme après une bonne réponse
    earn(points: number) {
      local[POINTS] = ((local[POINTS] as number) ?? 0) + points;
      sync.notifyLocalChange(POINTS);
    },
    points: () => local[POINTS],
    shared: () => canonical(withoutDeviceKeys(local)),
    expireToken() {
      token = null;
    },
    setOnline(online: boolean) {
      isOnline = online;
    },
    setBusy(busy: boolean) {
      isBusy = busy;
    },
    touchScreen() {
      gesture?.resolve("jeton-renouvelé");
      gesture = null;
    },
    refuseSignIn() {
      gesture?.reject(new Error("fenêtre fermée"));
      gesture = null;
    },
    // Retient les envois de cet appareil jusqu'à l'appel de la fonction renvoyée
    holdUploads(): () => void {
      let release: () => void = () => undefined;
      uploadGate = new Promise((resolve) => {
        release = resolve;
      });
      return () => {
        uploadGate = null;
        release();
      };
    }
  };
}

// Laisse passer les suites immédiates : une minuterie à zéro posée pendant un tour d'horloge simulé part 1 ms plus tard
const settle = () => vi.advanceTimersByTimeAsync(1);
const afterDebounce = () => vi.advanceTimersByTimeAsync(1001);

function item(a: number, b: number, changes: Partial<MultiplicationItem> = {}): MultiplicationItem {
  return {
    id: `${a}x${b}`,
    a,
    b,
    result: a * b,
    status: "discovery",
    boxLevel: 0,
    giftEarned: false,
    seenCount: 0,
    errorCount: 0,
    successStreak: 0,
    avgResponseTimeMs: 0,
    responseTimesMs: [],
    lastReviewedAt: null,
    nextReviewAt: null,
    intervalDays: 1,
    ...changes
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Sauvegarde automatique, un appareil", () => {
  function createWorld() {
    const drive = createDrive();
    return { drive, device: createDevice(drive, "A", { [POINTS]: 0 }) };
  }
  const remotePoints = (drive: Drive) => drive.backup()?.data[POINTS];

  it("ne fait rien tant qu'elle n'est pas activée", async () => {
    const { drive, device } = createWorld();
    device.earn(10);
    await vi.advanceTimersByTimeAsync(60000);

    expect(device.sync.getState().status).toBe("off");
    expect(drive.calls.find + drive.calls.upload).toBe(0);
  });

  it("envoie les données dès l'activation quand le Drive est vide", async () => {
    const { drive, device } = createWorld();
    device.earn(40);
    await device.sync.enable();

    expect(remotePoints(drive)).toBe(40);
    expect(device.sync.getState().status).toBe("synced");
    expect(device.sync.getState().lastPushAt).toBeGreaterThan(0);
    // Le fichier dit à quelle lignée il appartient et quel appareil a apporté les points
    expect(drive.backup()?.sync).toMatchObject({ lineage: "A-1", counters: { [POINTS]: { "A-2": 40 } } });
  });

  it("envoie chaque écriture, sans rien demander", async () => {
    const { drive, device } = createWorld();
    await device.sync.enable();

    device.earn(10);
    expect(device.sync.getState().status).toBe("pending");
    await afterDebounce();

    expect(remotePoints(drive)).toBe(10);
    expect(device.sync.getState().status).toBe("synced");
    expect(device.calls.windows).toBe(1);
  });

  it("regroupe les écritures rapprochées en un seul envoi", async () => {
    const { drive, device } = createWorld();
    await device.sync.enable();
    const uploadsBefore = drive.calls.upload;

    for (let i = 0; i < 4; i++) {
      device.earn(1);
      await vi.advanceTimersByTimeAsync(500);
    }
    await afterDebounce();

    expect(drive.calls.upload - uploadsBefore).toBe(1);
    expect(remotePoints(drive)).toBe(4);
  });

  it("n'attend jamais plus que le délai maximal pendant une longue séance", async () => {
    const { drive, device } = createWorld();
    await device.sync.enable();
    const uploadsBefore = drive.calls.upload;

    // Une réponse toutes les 800 ms pendant 6 secondes : le délai de regroupement n'est jamais atteint
    for (let i = 0; i < 8; i++) {
      device.earn(1);
      await vi.advanceTimersByTimeAsync(800);
    }

    expect(drive.calls.upload - uploadsBefore).toBeGreaterThanOrEqual(1);
  });

  it("n'envoie rien quand une écriture ne change aucune donnée", async () => {
    const { drive, device } = createWorld();
    await device.sync.enable();
    const before = { ...drive.calls };

    device.earn(0);
    await afterDebounce();

    expect(drive.calls).toEqual(before);
    expect(device.sync.getState().status).toBe("synced");
  });

  it("changer de joueur connecté n'envoie rien : c'est propre à l'appareil", async () => {
    const { drive, device } = createWorld();
    await device.sync.enable();
    const before = { ...drive.calls };

    device.write("active_profile_id_v2", "p-2");
    await afterDebounce();

    expect(drive.calls).toEqual(before);
  });

  it("jeton expiré : attend le prochain toucher, puis envoie l'état du moment", async () => {
    const { drive, device } = createWorld();
    await device.sync.enable();
    device.expireToken();

    device.earn(10);
    await afterDebounce();
    expect(device.sync.getState().status).toBe("pending");
    expect(remotePoints(drive)).toBe(0);

    device.earn(10);
    device.touchScreen();
    await settle();

    expect(remotePoints(drive)).toBe(20);
    expect(device.sync.getState().status).toBe("synced");
    expect(device.calls.windows).toBe(1);
  });

  it("connexion refusée : signale qu'il faut se reconnecter, sans insister", async () => {
    const { drive, device } = createWorld();
    await device.sync.enable();
    device.expireToken();

    device.earn(10);
    await afterDebounce();
    device.refuseSignIn();
    await settle();
    expect(device.sync.getState()).toMatchObject({ status: "attention", issue: "signin" });

    const requestsBefore = device.calls.gestureRequests;
    device.earn(10);
    await vi.advanceTimersByTimeAsync(60000);
    expect(device.calls.gestureRequests).toBe(requestsBefore);

    await device.sync.reconnect();
    expect(remotePoints(drive)).toBe(20);
    expect(device.sync.getState().status).toBe("synced");
  });

  it("jeton refusé par Google en cours d'envoi : en reprend un et renvoie", async () => {
    const { drive, device } = createWorld();
    await device.sync.enable();

    drive.failNextCall(new DriveAuthError("expiré"));
    device.earn(10);
    await afterDebounce();
    await settle();
    expect(device.sync.getState().status).toBe("pending");

    device.touchScreen();
    await settle();
    expect(remotePoints(drive)).toBe(10);
  });

  it("hors ligne : garde l'envoi en attente et le fait au retour du réseau", async () => {
    const { drive, device } = createWorld();
    await device.sync.enable();
    device.setOnline(false);

    device.earn(10);
    await vi.advanceTimersByTimeAsync(60000);
    expect(device.sync.getState().status).toBe("pending");
    expect(remotePoints(drive)).toBe(0);

    device.setOnline(true);
    await device.sync.refresh();
    expect(remotePoints(drive)).toBe(10);
    expect(device.sync.getState().status).toBe("synced");
  });

  it("coupure réseau pendant l'envoi : réessaie tout seul", async () => {
    const { drive, device } = createWorld();
    await device.sync.enable();

    drive.failNextCall(new TypeError("Failed to fetch"));
    device.earn(10);
    await afterDebounce();
    expect(device.sync.getState().status).toBe("pending");

    await vi.advanceTimersByTimeAsync(10000);
    expect(remotePoints(drive)).toBe(10);
  });

  it("erreur de Google : la signale, puis réessaie à l'écriture suivante", async () => {
    const { drive, device } = createWorld();
    await device.sync.enable();

    drive.failNextCall(new Error("Envoi de la sauvegarde : erreur 500 de Google Drive"));
    device.earn(10);
    await afterDebounce();
    expect(device.sync.getState()).toMatchObject({ status: "attention", issue: "error" });

    device.earn(10);
    await afterDebounce();
    expect(remotePoints(drive)).toBe(20);
    expect(device.sync.getState().status).toBe("synced");
  });

  it("au lancement : reprend un envoi resté en attente, après le premier toucher", async () => {
    const { drive, device } = createWorld();
    await device.sync.enable();
    device.setOnline(false);
    device.earn(10);
    await afterDebounce();

    // L'application est fermée puis rouverte plus tard : le jeton n'est plus valable
    device.setOnline(true);
    device.expireToken();
    device.sync.start();
    await settle();
    expect(remotePoints(drive)).toBe(0);

    device.touchScreen();
    await settle();
    expect(remotePoints(drive)).toBe(10);
  });

  it("désactivée : oublie la connexion et n'envoie plus rien", async () => {
    const { drive, device } = createWorld();
    await device.sync.enable();
    device.sync.disable();
    const uploadsBefore = drive.calls.upload;

    device.earn(10);
    await vi.advanceTimersByTimeAsync(60000);

    expect(device.sync.getState().status).toBe("off");
    expect(drive.calls.upload).toBe(uploadsBefore);
  });
});

describe("Fusion entre deux appareils", () => {
  // Léa a 1000 points sur A ; B active la sauvegarde et les reçoit
  async function createPair() {
    const drive = createDrive();
    const lea: UserProfile = { id: "p-1", name: "Léa", avatar: "🦁", createdAt: 1 };
    const a = createDevice(drive, "A", { [POINTS]: 1000, [`${NS}user_profiles_v2`]: [lea] });
    const b = createDevice(drive, "B");
    await a.sync.enable();
    await b.sync.enable();
    return { drive, a, b };
  }

  async function goOffline(...devices: ReturnType<typeof createDevice>[]) {
    devices.forEach((device) => device.setOnline(false));
  }

  async function comeBack(device: ReturnType<typeof createDevice>) {
    device.setOnline(true);
    await device.sync.refresh();
  }

  it("un second appareil reçoit la sauvegarde à l'activation, sans question", async () => {
    const { a, b } = await createPair();

    expect(b.points()).toBe(1000);
    expect(b.sync.getState().status).toBe("synced");
    expect(b.calls.merged).toBe(1);
    expect(b.shared()).toBe(a.shared());
  });

  it("deux appareils hors ligne : les progrès des deux sont gardés et additionnés", async () => {
    const { drive, a, b } = await createPair();
    await goOffline(a, b);
    a.earn(200);
    b.earn(300);
    await afterDebounce();

    await comeBack(a);
    await comeBack(b);
    expect(b.points()).toBe(1500);
    expect(drive.backup()?.data[POINTS]).toBe(1500);

    // A voit les progrès de B à son prochain retour au premier plan
    await a.sync.refresh();
    expect(a.points()).toBe(1500);
    expect(a.shared()).toBe(b.shared());
    expect(a.sync.getState().status).toBe("synced");
    expect(b.sync.getState().status).toBe("synced");
  });

  it("l'ordre d'arrivée ne change pas le résultat", async () => {
    const { a, b } = await createPair();
    await goOffline(a, b);
    a.earn(200);
    b.earn(300);
    await afterDebounce();

    await comeBack(b);
    await comeBack(a);
    await b.sync.refresh();

    expect(a.points()).toBe(1500);
    expect(a.shared()).toBe(b.shared());
  });

  it("synchroniser encore et encore n'ajoute rien", async () => {
    const { drive, a, b } = await createPair();
    await goOffline(a, b);
    a.earn(200);
    b.earn(300);
    await afterDebounce();
    await comeBack(a);
    await comeBack(b);
    await a.sync.refresh();
    const uploadsBefore = drive.calls.upload;

    for (let i = 0; i < 10; i++) {
      await a.sync.refresh();
      await b.sync.refresh();
    }

    expect(a.points()).toBe(1500);
    expect(b.points()).toBe(1500);
    expect(drive.calls.upload).toBe(uploadsBefore);
  });

  it("écritures simultanées : l'un écrase l'autre, mais rien n'est perdu ni compté deux fois", async () => {
    const { drive, a, b } = await createPair();
    await goOffline(a, b);
    a.earn(200);
    b.earn(300);
    await afterDebounce();

    // A lit le Drive, puis B lit et écrit, puis A écrit par-dessus sans avoir vu l'envoi de B
    const releaseA = a.holdUploads();
    a.setOnline(true);
    const pendingA = a.sync.refresh();
    await settle();
    await comeBack(b);
    releaseA();
    await pendingA;
    expect(drive.backup()?.data[POINTS]).toBe(1200);

    await b.sync.refresh();
    await a.sync.refresh();

    expect(a.points()).toBe(1500);
    expect(b.points()).toBe(1500);
    expect(a.shared()).toBe(b.shared());
  });

  it("même calcul travaillé des deux côtés : le dernier travaillé l'emporte, le cadeau reste gagné", async () => {
    const { a, b } = await createPair();
    await goOffline(a, b);
    a.write("matrix_items_p-1", [item(7, 8, { boxLevel: 5, status: "mastered", giftEarned: true, lastReviewedAt: 1000 })]);
    b.write("matrix_items_p-1", [item(7, 8, { boxLevel: 0, status: "review", errorCount: 1, lastReviewedAt: 2000 })]);
    await afterDebounce();

    await comeBack(a);
    await comeBack(b);
    await a.sync.refresh();

    const merged = (a.local[`${NS}matrix_items_p-1`] as MultiplicationItem[])[0];
    expect(merged).toMatchObject({ boxLevel: 0, status: "review", giftEarned: true });
    expect(a.shared()).toBe(b.shared());
  });

  it("joueurs créés chacun de son côté : les deux sont gardés", async () => {
    const { a, b } = await createPair();
    await goOffline(a, b);
    const lea = (a.local[`${NS}user_profiles_v2`] as UserProfile[])[0];
    const tom: UserProfile = { id: "p-2", name: "Tom", avatar: "🐼", createdAt: 2 };
    const zoe: UserProfile = { id: "p-3", name: "Zoé", avatar: "🦊", createdAt: 3 };
    a.write("user_profiles_v2", [lea, tom]);
    b.write("user_profiles_v2", [lea, zoe]);
    await afterDebounce();

    await comeBack(a);
    await comeBack(b);
    await a.sync.refresh();

    expect((a.local[`${NS}user_profiles_v2`] as UserProfile[]).map((p) => p.name)).toEqual(["Léa", "Tom", "Zoé"]);
    expect(a.shared()).toBe(b.shared());
  });

  it("joueur supprimé sur A pendant qu'il jouait sur B : il disparaît des deux, avec toutes ses données", async () => {
    const { drive, a, b } = await createPair();
    const lea = (a.local[`${NS}user_profiles_v2`] as UserProfile[])[0];
    const tom: UserProfile = { id: "p-2", name: "Tom", avatar: "🐼", createdAt: 2 };
    a.write("user_profiles_v2", [lea, tom]);
    a.write("points_p-2", 100);
    await afterDebounce();
    await b.sync.refresh();
    expect(b.local[`${NS}points_p-2`]).toBe(100);

    await goOffline(a, b);
    // Comme l'espace parent : le joueur sort de la liste, ses données sont effacées, et sa suppression est retenue
    a.write("user_profiles_v2", [lea]);
    a.remove("points_p-2");
    a.write("deleted_profiles", ["p-2"]);
    b.write("points_p-2", 450);
    b.write("matrix_items_p-2", [item(7, 8, { boxLevel: 2, lastReviewedAt: 9000 })]);
    await afterDebounce();

    await comeBack(b);
    await comeBack(a);
    await b.sync.refresh();

    [a, b].forEach((device) => {
      expect((device.local[`${NS}user_profiles_v2`] as UserProfile[]).map((p) => p.name)).toEqual(["Léa"]);
      expect(Object.keys(device.local).filter((key) => key.includes("p-2"))).toEqual([]);
    });
    expect(Object.keys(drive.backup()?.data ?? {}).filter((key) => key.includes("p-2"))).toEqual([]);
    expect(a.shared()).toBe(b.shared());
    expect(a.points()).toBe(1000);
  });

  it("chaque appareil garde son joueur connecté", async () => {
    const { a, b } = await createPair();
    a.write("active_profile_id_v2", "p-1");
    b.write("active_profile_id_v2", "p-9");
    a.earn(10);
    await afterDebounce();
    await b.sync.refresh();

    expect(a.local[`${NS}active_profile_id_v2`]).toBe("p-1");
    expect(b.local[`${NS}active_profile_id_v2`]).toBe("p-9");
    expect(b.points()).toBe(1010);
  });

  it("réglage modifié des deux côtés : le plus récent l'emporte", async () => {
    const { a, b } = await createPair();
    await goOffline(a, b);
    a.write("config_duration", 6);
    await vi.advanceTimersByTimeAsync(5000);
    b.write("config_duration", 15);
    await afterDebounce();

    await comeBack(a);
    await comeBack(b);
    await a.sync.refresh();

    expect(a.local[`${NS}config_duration`]).toBe(15);
    expect(b.local[`${NS}config_duration`]).toBe(15);
  });

  it("l'écran n'est relu que si la fusion apporte du nouveau à l'appareil", async () => {
    const { a, b } = await createPair();
    const mergedBefore = a.calls.merged;

    // B n'a rien de plus que A : A fusionne sans que rien ne change chez lui
    await a.sync.refresh();
    expect(a.calls.merged).toBe(mergedBefore);

    b.earn(50);
    await afterDebounce();
    await a.sync.refresh();
    expect(a.calls.merged).toBe(mergedBefore + 1);
  });

  it("pendant une séance, la fusion attend : rien n'est écrit sous les pieds de l'enfant", async () => {
    const { drive, a, b } = await createPair();
    b.earn(300);
    await afterDebounce();

    a.setBusy(true);
    a.earn(200);
    await afterDebounce();
    await vi.advanceTimersByTimeAsync(6000);
    expect(a.points()).toBe(1200);
    expect(drive.backup()?.data[POINTS]).toBe(1300);

    // La séance se termine : la fusion remise à plus tard s'applique toute seule
    a.setBusy(false);
    await vi.advanceTimersByTimeAsync(2001);
    expect(a.points()).toBe(1500);
    expect(drive.backup()?.data[POINTS]).toBe(1500);
  });

  it("ancien fichier sans répartition : le plus grand des deux totaux, jamais la somme", async () => {
    const drive = createDrive();
    drive.write(JSON.stringify({ version: 1, appName: "test", exportedAt: 0, data: { [POINTS]: 1000 } }));
    const device = createDevice(drive, "A", { [POINTS]: 800 });

    await device.sync.enable();

    expect(device.points()).toBe(1000);
    expect(drive.backup()?.data[POINTS]).toBe(1000);
    expect(drive.backup()?.sync?.lineage).toBe("A-2");
    expect(device.sync.getState().status).toBe("synced");
  });
});

describe("Quand le parent garde la main", () => {
  async function createPair() {
    const drive = createDrive();
    const a = createDevice(drive, "A", { [POINTS]: 1000 });
    const b = createDevice(drive, "B");
    await a.sync.enable();
    await b.sync.enable();
    return { drive, a, b };
  }

  it("données remplacées sur A (import d'un fichier) : elles remplacent le Drive, B demande au parent", async () => {
    const { drive, a, b } = await createPair();
    b.earn(300);
    await afterDebounce();

    // Le parent importe sur A un fichier plus ancien : 400 points
    a.local[POINTS] = 400;
    a.sync.startNewLineage();
    await settle();
    expect(drive.backup()?.data[POINTS]).toBe(400);

    await b.sync.refresh();
    expect(b.points()).toBe(1300);
    expect(b.sync.getState()).toMatchObject({ status: "attention", issue: "conflict" });
    // La date de la sauvegarde trouvée est donnée au parent pour l'aider à choisir
    expect(b.sync.getState().remoteModifiedTime).toMatch(/^jour-/);
  });

  it("B reprend la sauvegarde du Drive : il rejoint la nouvelle lignée et les fusions reprennent", async () => {
    const { a, b } = await createPair();
    a.local[POINTS] = 400;
    a.sync.startNewLineage();
    await settle();
    await b.sync.refresh();

    b.write("radio_tables", [7, 8]);
    await b.sync.restoreRemote();
    expect(b.points()).toBe(400);
    expect(b.sync.getState().status).toBe("synced");
    // Remplacement complet : ce que la sauvegarde n'avait pas disparaît de l'appareil
    expect(b.local[`${NS}radio_tables`]).toBeUndefined();

    a.earn(10);
    b.earn(20);
    await afterDebounce();
    await a.sync.refresh();
    await b.sync.refresh();
    expect(a.points()).toBe(430);
    expect(b.points()).toBe(430);
  });

  it("B garde ses données : elles remplacent le Drive, et c'est A qui demandera au parent", async () => {
    const { drive, a, b } = await createPair();
    b.earn(300);
    await afterDebounce();
    a.local[POINTS] = 400;
    a.sync.startNewLineage();
    await settle();
    await b.sync.refresh();

    await b.sync.keepLocal();
    expect(drive.backup()?.data[POINTS]).toBe(1300);
    expect(b.sync.getState().status).toBe("synced");

    await a.sync.refresh();
    expect(a.points()).toBe(400);
    expect(a.sync.getState()).toMatchObject({ status: "attention", issue: "conflict" });
  });

  it("application fermée en pleine fusion : au lancement suivant, le parent choisit", async () => {
    const { a } = await createPair();
    a.settings.set("merging", true);

    a.sync.start();
    await settle();

    expect(a.sync.getState()).toMatchObject({ status: "attention", issue: "conflict", remoteModifiedTime: "" });
  });

  it("enregistre l'horodatage d'un réglage même si la synchronisation n'est pas encore activée", () => {
    const drive = createDrive();
    const dev = createDevice(drive, "unconnected");
    expect(dev.sync.getState().status).toBe("off");

    dev.write("selected_tables_p-1", [6, 7]);
    const times = dev.settings.get<Record<string, number>>("times", {});
    expect(typeof times[`${NS}selected_tables_p-1`]).toBe("number");
    expect(times[`${NS}selected_tables_p-1`]).toBeGreaterThan(0);
  });
});

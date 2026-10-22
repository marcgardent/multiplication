// Voix enregistrées, rangées sur l'appareil (IndexedDB) : trop lourdes pour le stockage habituel,
// elles ne font pas partie de la sauvegarde des joueurs ni de l'export

import { setVoiceOverride } from "../services/audioService";

const DB_NAME = "multiplication-voix";
const STORE_NAME = "enregistrements";

// Chaque voix est datée, son retrait aussi : entre deux appareils, la plus récente l'emporte
export interface VoiceRecord {
  // Nul quand le parent est revenu à la voix de synthèse
  wav: Blob | null;
  at: number;
}

export interface VoiceStore {
  // Chemins des voix de synthèse déjà remplacées
  list(): Promise<string[]>;
  // Toutes les voix, retraits compris, avec leur date
  records(): Promise<Map<string, VoiceRecord>>;
  get(file: string): Promise<Blob | undefined>;
  put(file: string, wav: Blob): Promise<void>;
  remove(file: string): Promise<void>;
  // À l'ouverture de l'application : chaque voix enregistrée remplace la voix de synthèse
  applyAll(): Promise<void>;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function createVoiceStore(): VoiceStore {
  let db: Promise<IDBDatabase> | null = null;

  function open(): Promise<IDBDatabase> {
    db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return db;
  }

  async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await open()).transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  async function read(file: string): Promise<VoiceRecord | undefined> {
    return (await request((await store("readonly")).get(file))) as VoiceRecord | undefined;
  }

  return {
    async records() {
      const objectStore = await store("readonly");
      const [keys, values] = await Promise.all([request(objectStore.getAllKeys()), request(objectStore.getAll())]);
      return new Map(keys.map((key, i) => [String(key), values[i] as VoiceRecord]));
    },

    async list() {
      return [...(await this.records()).entries()].filter(([, record]) => record.wav).map(([file]) => file);
    },

    async get(file) {
      return (await read(file))?.wav ?? undefined;
    },

    async put(file, wav) {
      const record: VoiceRecord = { wav, at: Date.now() };
      await request((await store("readwrite")).put(record, file));
      setVoiceOverride(file, wav);
    },

    async remove(file) {
      const record: VoiceRecord = { wav: null, at: Date.now() };
      await request((await store("readwrite")).put(record, file));
      setVoiceOverride(file, null);
    },

    async applyAll() {
      const files = await this.list();
      await Promise.all(
        files.map(async (file) => {
          const wav = await this.get(file);
          if (wav) setVoiceOverride(file, wav);
        })
      );
    }
  };
}

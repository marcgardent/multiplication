// Modèle de reconnaissance vocale Vosk (français, petit modèle, Apache 2.0).
// Téléchargé une fois depuis le site, puis gardé décompressé par le navigateur (IndexedDB) : ensuite, plus besoin d'internet.
// La reconnaissance tourne dans un Web Worker : la voix ne quitte jamais l'appareil
import type { Model } from "vosk-browser";

export const MODEL_FILE = "models/vosk-model-small-fr-0.22.tar.gz";
export const MODEL_SIZE_MB = 42;

// Adresse complète : le worker de Vosk ne sait pas résoudre une adresse relative à la page
export function voiceModelUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}${MODEL_FILE}`, location.href).href;
}

let loading: Promise<Model> | null = null;
let downloading: Promise<void> | null = null;
let isLoadingInProgress = false;
const readyListeners = new Set<() => void>();

// Prévient quand le modèle est installé sur cet appareil : l'application le note dans la sauvegarde
export function onVoiceModelReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}

function markReady() {
  // Que le navigateur ne jette pas les 42 Mo pour faire de la place
  navigator.storage?.persist?.().catch(() => undefined);
  readyListeners.forEach((listener) => listener());
}

// Vrai pendant un téléchargement ou un chargement du modèle
export function isVoiceModelBusy(): boolean {
  return downloading !== null || isLoadingInProgress;
}

// Un seul modèle pour toute l'application : la séance et l'essai de l'espace parent le partagent
export function loadVoiceModel(): Promise<Model> {
  if (!loading) {
    isLoadingInProgress = true;
    // Jamais deux workers à la fois sur le même dossier IndexedDB : on attend un téléchargement en cours
    loading = (downloading ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => import("vosk-browser"))
      .then(({ createModel }) => createModel(voiceModelUrl(), -2))
      .then((model) => {
        markReady();
        return model;
      })
      .finally(() => {
        isLoadingInProgress = false;
      });
    // Un échec (pas d'internet au premier téléchargement) se retente au prochain essai
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

// Télécharge et installe le modèle sans le garder en mémoire : il sera prêt, même hors ligne, à la première séance.
// Ne refait rien s'il est déjà installé
export function downloadVoiceModel(): Promise<void> {
  if (loading) return loading.then(() => undefined);
  if (!downloading) {
    downloading = isVoiceModelDownloaded()
      .then(async (isDownloaded) => {
        if (!isDownloaded) {
          const { createModel } = await import("vosk-browser");
          const model = await createModel(voiceModelUrl(), -2);
          model.terminate();
        }
        markReady();
      })
      .finally(() => {
        downloading = null;
      });
  }
  return downloading;
}

// Vosk range le modèle dans la base IndexedDB « /vosk », sous un dossier nommé d'après l'adresse,
// et y dépose « extracted.ok » une fois le modèle décompressé
export function isVoiceModelDownloaded(): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open("/vosk");
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const db = request.result;
        try {
          if (!db.objectStoreNames.contains("FILE_DATA")) {
            db.close();
            resolve(false);
            return;
          }
          const key = `/vosk/${voiceModelUrl().replace(/[\W]/g, "_")}/extracted.ok`;
          const get = db.transaction("FILE_DATA", "readonly").objectStore("FILE_DATA").getKey(key);
          get.onsuccess = () => {
            db.close();
            resolve(get.result !== undefined);
          };
          get.onerror = () => {
            db.close();
            resolve(false);
          };
        } catch {
          db.close();
          resolve(false);
        }
      };
    } catch {
      resolve(false);
    }
  });
}

export interface StorageService {
  get<T>(key: string, defaultValue: T): T;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
  clear(): void;
}

// Espace de stockage commun à toute l'application ; changer la version repart de données vierges
export const STORAGE_NAMESPACE = "mult_clean_v3";

export function createStorageService(namespace = "multiplication_app_v1"): StorageService {
  const getFullKey = (key: string) => `${namespace}:${key}`;

  return {
    get<T>(key: string, defaultValue: T): T {
      try {
        const item = localStorage.getItem(getFullKey(key));
        if (item === null) return defaultValue;
        return JSON.parse(item) as T;
      } catch (err) {
        console.warn(`[StorageService] Erreur lecture ${key}`, err);
        return defaultValue;
      }
    },

    set<T>(key: string, value: T): void {
      try {
        localStorage.setItem(getFullKey(key), JSON.stringify(value));
      } catch (err) {
        console.warn(`[StorageService] Erreur écriture ${key}`, err);
      }
    },

    remove(key: string): void {
      try {
        localStorage.removeItem(getFullKey(key));
      } catch (err) {
        console.warn(`[StorageService] Erreur suppression ${key}`, err);
      }
    },

    clear(): void {
      try {
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(`${namespace}:`)) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      } catch (err) {
        console.warn(`[StorageService] Erreur nettoyage`, err);
      }
    }
  };
}

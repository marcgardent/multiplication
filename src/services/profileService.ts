import { UserProfile } from "../types";
import { StorageService } from "../services/storageService";
import { deleteProfileData } from "../core/profileData";
import { DELETED_PROFILES_KEY } from "./cloudMerge";

export const ANIMAL_AVATARS = [
  "🦁", "🐼", "🦊", "🐯", "🐨", "🐰", 
  "🐸", "🦄", "🐵", "🐧", "🦉", "🐙",
  "🐶", "🐱", "🐻", "🦒", "🦔", "🐬"
];

export interface ProfileService {
  getProfiles(): UserProfile[];
  getActiveProfile(): UserProfile | null;
  createProfile(name: string, avatar: string): UserProfile;
  selectProfile(profileId: string): UserProfile | null;
  logout(): void;
  deleteProfile(profileId: string): void;
  // Relit les joueurs depuis le stockage, après une fusion avec la sauvegarde d'un autre appareil
  reload(): void;
  subscribe(callback: (active: UserProfile | null) => void): () => void;
}

export function createProfileService(storage: StorageService): ProfileService {
  const PROFILES_KEY = "user_profiles_v2";
  const ACTIVE_PROFILE_ID_KEY = "active_profile_id_v2";

  const listeners: Set<(p: UserProfile | null) => void> = new Set();

  function loadProfiles(): UserProfile[] {
    return storage.get<UserProfile[]>(PROFILES_KEY, []);
  }

  let profiles = loadProfiles();
  let activeId: string | null = storage.get<string | null>(ACTIVE_PROFILE_ID_KEY, null);

  function getActive(): UserProfile | null {
    if (!activeId) return null;
    return profiles.find((p) => p.id === activeId) || null;
  }

  function notify() {
    const active = getActive();
    listeners.forEach((fn) => fn(active));
  }

  return {
    getProfiles(): UserProfile[] {
      return [...profiles];
    },

    getActiveProfile(): UserProfile | null {
      return getActive();
    },

    createProfile(name: string, avatar: string): UserProfile {
      const cleanName = name.trim() || "Champion";
      const newP: UserProfile = {
        id: `p-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        name: cleanName,
        avatar: avatar || "🦁",
        createdAt: Date.now()
      };
      profiles.push(newP);
      activeId = newP.id;
      storage.set(PROFILES_KEY, profiles);
      storage.set(ACTIVE_PROFILE_ID_KEY, activeId);
      notify();
      return newP;
    },

    selectProfile(profileId: string): UserProfile | null {
      const found = profiles.find((p) => p.id === profileId);
      if (found) {
        activeId = found.id;
        storage.set(ACTIVE_PROFILE_ID_KEY, activeId);
        notify();
        return found;
      }
      return null;
    },

    logout(): void {
      activeId = null;
      storage.remove(ACTIVE_PROFILE_ID_KEY);
      notify();
    },

    // Définitif : le joueur, sa progression, ses points et ses cadeaux disparaissent, ici puis sur les autres appareils
    deleteProfile(profileId: string): void {
      profiles = profiles.filter((p) => p.id !== profileId);
      storage.set(PROFILES_KEY, profiles);
      deleteProfileData(storage, profileId);
      const deleted = storage.get<string[]>(DELETED_PROFILES_KEY, []);
      if (!deleted.includes(profileId)) storage.set(DELETED_PROFILES_KEY, [...deleted, profileId]);
      if (activeId === profileId) {
        activeId = null;
        storage.remove(ACTIVE_PROFILE_ID_KEY);
      }
      notify();
    },

    reload(): void {
      profiles = loadProfiles();
      activeId = storage.get<string | null>(ACTIVE_PROFILE_ID_KEY, null);
      notify();
    },

    subscribe(callback: (active: UserProfile | null) => void): () => void {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  };
}

import { StorageService } from "./storageService";

// Code à 4 chiffres de l'espace parent. Il reste sur l'appareil, hors de la sauvegarde,
// et seule son empreinte est enregistrée.
export interface ParentCodeService {
  hasCode(): boolean;
  setCode(code: string): Promise<void>;
  isCorrect(code: string): Promise<boolean>;
}

export const PARENT_CODE_LENGTH = 4;

export function createParentCodeService(storage: StorageService, hash: (text: string) => Promise<string>): ParentCodeService {
  const fingerprint = (code: string) => hash(`multiplication-parent:${code}`);

  return {
    hasCode: () => storage.get<string>("code", "") !== "",

    async setCode(code: string): Promise<void> {
      storage.set("code", await fingerprint(code));
    },

    async isCorrect(code: string): Promise<boolean> {
      return storage.get<string>("code", "") === (await fingerprint(code));
    }
  };
}

export interface ParentChallenge {
  question: string;
  answer: string;
}

// Calcul hors de portée d'un enfant, demandé pour remettre le code à zéro quand il est oublié
export function createParentChallenge(random: () => number = Math.random): ParentChallenge {
  // Entre 12 et 99, sans les multiples de 10 ni de 11 qui se calculent de tête
  const pick = (): number => {
    const n = 12 + Math.floor(random() * 88);
    return n % 10 === 0 || n % 11 === 0 ? pick() : n;
  };
  const a = pick();
  const b = pick();
  return { question: `${a} × ${b}`, answer: String(a * b) };
}

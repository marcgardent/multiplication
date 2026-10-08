import { MultiplicationItem, SessionConfig } from "../types";
import { MatrixStore } from "./matrixStore";

export interface RepetitionEngine {
  getActivePool(): MultiplicationItem[];
  getNextQuestion(): MultiplicationItem;
  registerResult(item: MultiplicationItem, mode: "discovery" | "practice" | "time-attack", isCorrect: boolean, timeMs: number): void;
  isReviewQueueOverloaded(): boolean;
  getQueueStats(): { activePoolSize: number; reviewQueueCount: number; newAvailableCount: number; masteredCount: number };
}

export function createRepetitionEngine(
  matrixStore: MatrixStore,
  config: SessionConfig
): RepetitionEngine {
  let activePool: MultiplicationItem[] = [];
  let lastItemId: string | null = null;

  function refreshPool() {
    const all = matrixStore.getAll();
    const reviews = all.filter((i) => i.status === "review");
    const discoveries = all.filter((i) => i.status === "discovery");
    const unknowns = all.filter((i) => i.status === "unknown");
    const mastered = all.filter((i) => i.status === "mastered");

    // Trier les révisions par priorité (les erreurs les plus récentes ou boxLevel le plus bas)
    reviews.sort((a, b) => a.boxLevel - b.boxLevel || b.errorCount - a.errorCount);

    // Si on a déjà un pool actif, garder les éléments non encore maîtrisés
    const currentActiveIds = new Set(activePool.map((i) => i.id));
    const nextPool: MultiplicationItem[] = [];

    // 1. Récupérer les éléments déjà actifs
    for (const item of activePool) {
      const fresh = matrixStore.get(item.id);
      if (fresh) {
        nextPool.push(fresh);
      }
    }

    // 2. Gestion de la surcharge (Backpressure)
    // Seuil de surcharge : si la file de révision est trop chargée, on n'ajoute pas de nouvelles
    const isOverloaded = reviews.length >= config.reviewThreshold;

    // Remplir avec les révisions en priorité absolue
    for (const rev of reviews) {
      if (nextPool.length >= config.maxActivePool) break;
      if (!currentActiveIds.has(rev.id)) {
        nextPool.push(rev);
        currentActiveIds.add(rev.id);
      }
    }

    // Si la file de révision n'est pas surchargée, ajouter un panache de nouveaux calculs
    if (!isOverloaded && nextPool.length < config.maxActivePool) {
      // D'abord les découvertes en cours
      for (const disc of discoveries) {
        if (nextPool.length >= config.maxActivePool) break;
        if (!currentActiveIds.has(disc.id)) {
          nextPool.push(disc);
          currentActiveIds.add(disc.id);
        }
      }

      // Ensuite les inconnus (jusqu'à config.newItemsBatch)
      let addedNew = 0;
      for (const unk of unknowns) {
        if (nextPool.length >= config.maxActivePool || addedNew >= config.newItemsBatch) break;
        if (!currentActiveIds.has(unk.id)) {
          nextPool.push(unk);
          currentActiveIds.add(unk.id);
          addedNew++;
        }
      }
    }

    // Si le pool est toujours incomplet (par exemple l'élève a tout réussi et peu de révisions),
    // on complète par des inconnus ou des consolidations de calculs maîtrisés les plus anciens
    if (nextPool.length < config.maxActivePool) {
      for (const unk of unknowns) {
        if (nextPool.length >= config.maxActivePool) break;
        if (!currentActiveIds.has(unk.id)) {
          nextPool.push(unk);
          currentActiveIds.add(unk.id);
        }
      }
    }

    if (nextPool.length === 0) {
      // Fallback si tout est maîtrisé : prendre les calculs avec le temps le plus lent
      mastered.sort((a, b) => b.avgResponseTimeMs - a.avgResponseTimeMs);
      nextPool.push(...mastered.slice(0, config.maxActivePool));
    }

    activePool = nextPool;
  }

  // Initialisation du premier pool
  refreshPool();

  return {
    getActivePool(): MultiplicationItem[] {
      refreshPool();
      return [...activePool];
    },

    getNextQuestion(): MultiplicationItem {
      refreshPool();
      if (activePool.length === 0) {
        const all = matrixStore.getAll();
        return all[Math.floor(Math.random() * all.length)];
      }

      // Pondération intelligente selon le boxLevel et le statut :
      // Plus le boxLevel est bas (erreur récente), plus la probabilité de tirage est élevée.
      // Éviter de répéter immédiatement la même question consécutive si possible.
      const candidates = activePool.length > 1 && lastItemId 
        ? activePool.filter((i) => i.id !== lastItemId) 
        : activePool;

      // Calcul des poids : poids = (5 - boxLevel) * (status === 'review' ? 3 : 1)
      const weights = candidates.map((item) => {
        let w = (5 - item.boxLevel) * 2;
        if (item.status === "review") w *= 3;
        if (item.status === "discovery") w *= 2;
        return Math.max(1, w);
      });

      const totalWeight = weights.reduce((acc, cur) => acc + cur, 0);
      let rand = Math.random() * totalWeight;
      let selected = candidates[0];

      for (let i = 0; i < candidates.length; i++) {
        if (rand < weights[i]) {
          selected = candidates[i];
          break;
        }
        rand -= weights[i];
      }

      lastItemId = selected.id;
      return selected;
    },

    registerResult(item: MultiplicationItem, mode: "discovery" | "practice" | "time-attack", isCorrect: boolean, timeMs: number): void {
      matrixStore.recordAttempt(item.a, item.b, mode, isCorrect, timeMs);
      refreshPool();
    },

    isReviewQueueOverloaded(): boolean {
      const reviews = matrixStore.getAll().filter((i) => i.status === "review");
      return reviews.length >= config.reviewThreshold;
    },

    getQueueStats() {
      const all = matrixStore.getAll();
      return {
        activePoolSize: activePool.length,
        reviewQueueCount: all.filter((i) => i.status === "review").length,
        newAvailableCount: all.filter((i) => i.status === "unknown").length,
        masteredCount: all.filter((i) => i.status === "mastered").length
      };
    }
  };
}

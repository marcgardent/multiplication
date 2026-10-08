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
  const recentPresentedIds: string[] = [];
  const errorLockouts: Map<string, number> = new Map();

  function isItemDue(item: MultiplicationItem, now = Date.now()): boolean {
    if (item.status === "review") return true;
    if (item.nextReviewAt !== null && now >= item.nextReviewAt) return true;
    return false;
  }

  function refreshPool() {
    const all = matrixStore.getAll();
    const now = Date.now();

    const dueReviews = all.filter((i) => isItemDue(i, now));
    const discoveries = all.filter((i) => i.status === "discovery" && !isItemDue(i, now));
    const unknowns = all.filter((i) => i.status === "unknown");
    const mastered = all.filter((i) => i.status === "mastered" && !isItemDue(i, now));

    // Tri des révisions échues par urgence
    // Priorité 1 : erreurs au statut review
    // Priorité 2 : calculs dont l échéance est la plus dépassée
    dueReviews.sort((a, b) => {
      const aIsReview = a.status === "review" ? 1 : 0;
      const bIsReview = b.status === "review" ? 1 : 0;
      if (aIsReview !== bIsReview) return bIsReview - aIsReview;

      if (a.boxLevel !== b.boxLevel) return a.boxLevel - b.boxLevel;

      const aDueDiff = now - (a.nextReviewAt ?? a.lastReviewedAt ?? now);
      const bDueDiff = now - (b.nextReviewAt ?? b.lastReviewedAt ?? now);
      return bDueDiff - aDueDiff;
    });

    const currentActiveIds = new Set<string>();
    const nextPool: MultiplicationItem[] = [];

    // 1. Remplir en priorité absolue avec les révisions échues
    for (const rev of dueReviews) {
      if (nextPool.length >= config.maxActivePool) break;
      if (!currentActiveIds.has(rev.id)) {
        nextPool.push(rev);
        currentActiveIds.add(rev.id);
      }
    }

    // 2. Conserver les éléments du pool précédent qui restent pertinents
    for (const item of activePool) {
      if (nextPool.length >= config.maxActivePool) break;
      const fresh = matrixStore.get(item.id);
      if (fresh && !currentActiveIds.has(fresh.id)) {
        const shouldKeep = fresh.status !== "mastered" || isItemDue(fresh, now);
        if (shouldKeep) {
          nextPool.push(fresh);
          currentActiveIds.add(fresh.id);
        }
      }
    }

    // 3. Gestion de la surcharge régulatrice
    const isOverloaded = dueReviews.length >= config.reviewThreshold;

    // Si la file n est pas surchargée, injecter les découvertes puis des nouveautés
    if (!isOverloaded && nextPool.length < config.maxActivePool) {
      // Découvertes en cours
      for (const disc of discoveries) {
        if (nextPool.length >= config.maxActivePool) break;
        if (!currentActiveIds.has(disc.id)) {
          nextPool.push(disc);
          currentActiveIds.add(disc.id);
        }
      }

      // Nouveaux calculs
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

    // Compléter le pool si nécessaire
    if (nextPool.length < config.maxActivePool) {
      for (const unk of unknowns) {
        if (nextPool.length >= config.maxActivePool) break;
        if (!currentActiveIds.has(unk.id)) {
          nextPool.push(unk);
          currentActiveIds.add(unk.id);
        }
      }
    }

    // Si le pool reste incomplet, planifier les calculs dont l échéance approche
    if (nextPool.length < config.maxActivePool) {
      const upcomingReviews = all
        .filter((i) => !currentActiveIds.has(i.id) && i.nextReviewAt !== null)
        .sort((a, b) => (a.nextReviewAt ?? 0) - (b.nextReviewAt ?? 0));

      for (const up of upcomingReviews) {
        if (nextPool.length >= config.maxActivePool) break;
        nextPool.push(up);
        currentActiveIds.add(up.id);
      }
    }

    // Fallback si tout est maîtrisé et aucune échéance immédiate
    if (nextPool.length === 0) {
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

      const now = Date.now();

      // 1. Filtrer les calculs en période de verrouillage après une erreur
      // L enfant doit voir au moins 3 autres calculs avant de revoir une erreur
      const errorFreePool = activePool.filter((item) => {
        const lockCount = errorLockouts.get(item.id) ?? 0;
        return lockCount <= 0;
      });

      // 2. Éviter la répétition des 3 dernières questions présentées
      const recentWindow = recentPresentedIds.slice(-3);
      let candidates = errorFreePool.filter((item) => !recentWindow.includes(item.id));

      // Si le filtre strict ne laisse aucun candidat, assouplir progressivement
      if (candidates.length === 0) {
        const lastId = recentPresentedIds[recentPresentedIds.length - 1];
        candidates = errorFreePool.filter((item) => item.id !== lastId);
      }
      if (candidates.length === 0 && errorFreePool.length > 0) {
        candidates = errorFreePool;
      }
      if (candidates.length === 0) {
        const lastId = recentPresentedIds[recentPresentedIds.length - 1];
        candidates = activePool.filter((item) => item.id !== lastId);
      }
      if (candidates.length === 0) {
        candidates = activePool;
      }

      // Pondération intelligente
      const weights = candidates.map((item) => {
        let w = (5 - item.boxLevel) * 2;
        if (item.status === "review") w *= 3;
        if (item.status === "discovery") w *= 2;
        if (isItemDue(item, now)) w *= 2;
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

      // Décrémenter le verrouillage des autres calculs ratés
      for (const [lockedId, count] of Array.from(errorLockouts.entries())) {
        if (lockedId !== selected.id) {
          if (count <= 1) {
            errorLockouts.delete(lockedId);
          } else {
            errorLockouts.set(lockedId, count - 1);
          }
        }
      }

      // Mettre à jour l historique des présentations
      recentPresentedIds.push(selected.id);
      if (recentPresentedIds.length > 6) {
        recentPresentedIds.shift();
      }

      return selected;
    },

    registerResult(item: MultiplicationItem, mode: "discovery" | "practice" | "time-attack", isCorrect: boolean, timeMs: number): void {
      if (!isCorrect) {
        // Verrouillage de 3 questions intercalaires avant réapparition
        errorLockouts.set(item.id, 3);
      } else {
        errorLockouts.delete(item.id);
      }

      matrixStore.recordAttempt(item.a, item.b, mode, isCorrect, timeMs);
      refreshPool();
    },

    isReviewQueueOverloaded(): boolean {
      const all = matrixStore.getAll();
      const now = Date.now();
      const dueCount = all.filter((i) => isItemDue(i, now)).length;
      return dueCount >= config.reviewThreshold;
    },

    getQueueStats() {
      const all = matrixStore.getAll();
      const now = Date.now();
      const dueCount = all.filter((i) => isItemDue(i, now)).length;
      return {
        activePoolSize: activePool.length,
        reviewQueueCount: dueCount,
        newAvailableCount: all.filter((i) => i.status === "unknown").length,
        masteredCount: all.filter((i) => i.status === "mastered").length
      };
    }
  };
}

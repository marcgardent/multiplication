import { MultiplicationItem, SessionConfig } from "../types";
import { MatrixStore, MAX_BOX } from "./matrixStore";
import { EarnedPoints } from "./calcPoints";

export interface SessionLot {
  items: MultiplicationItem[];
  reviewCount: number;
  newCount: number;
}

export interface DetailedLot extends SessionLot {
  reviews: MultiplicationItem[];
  news: MultiplicationItem[];
  reinforcements: MultiplicationItem[];
}

export interface QueueStats {
  dueCount: number;
  learningCount: number;
  masteredCount: number;
  newAvailableCount: number;
  nextSessionNewCount: number;
}

export interface RepetitionEngine {
  startSession(): DetailedLot;
  getDiscoveryItems(): MultiplicationItem[];
  getNextDiscovery(): MultiplicationItem;
  getNextQuestion(): MultiplicationItem;
  registerResult(item: MultiplicationItem, mode: "discovery" | "practice" | "time-attack", isCorrect: boolean, timeMs: number): EarnedPoints;
  isReviewQueueOverloaded(durationMinutes?: number): boolean;
  getQueueStats(durationMinutes?: number): QueueStats;
  previewLot(durationMinutes?: number): DetailedLot;
  getCurrentLotDetails(): DetailedLot | null;
}

// Taille du lot selon la durée choisie : nouveaux calculs au plus, et calculs au total
const LOT_BY_DURATION: Record<number, { news: number; max: number }> = {
  3: { news: 2, max: 6 },
  6: { news: 4, max: 10 },
  9: { news: 6, max: 14 },
  15: { news: 8, max: 18 }
};

// En dessous de 4 calculs, le verrouillage « 3 calculs intercalaires » après une erreur ne peut pas jouer
const MIN_LOT_SIZE = 4;

function getLotRule(durationMinutes: number): { news: number; max: number } {
  const durations = Object.keys(LOT_BY_DURATION).map(Number).sort((a, b) => a - b);
  const fitting = durations.filter((d) => d <= durationMinutes);
  return LOT_BY_DURATION[fitting.length > 0 ? fitting[fitting.length - 1] : durations[0]];
}

export function createRepetitionEngine(
  matrixStore: MatrixStore,
  config: SessionConfig
): RepetitionEngine {
  // Le lot est figé au lancement de la séance : rien n'y entre ni n'en sort en cours de route
  let lotIds: string[] = [];
  let discoveryIds: string[] = [];
  let discoveryCursor = 0;
  let recentPresentedIds: string[] = [];
  const errorLockouts: Map<string, number> = new Map();

  function isItemDue(item: MultiplicationItem, now = Date.now()): boolean {
    return matrixStore.isItemDue(item, now);
  }

  function getOrderedUnknowns(): MultiplicationItem[] {
    const tables = matrixStore.getLearningTables ? matrixStore.getLearningTables() : [1, 10, 2, 5, 3, 4, 6, 7, 8, 9];
    const result: MultiplicationItem[] = [];
    const seen = new Set<string>();

    for (const tableNum of tables) {
      for (let b = 1; b <= 10; b++) {
        const item = matrixStore.getByFactors(tableNum, b);
        if (item && item.status === "unknown" && !seen.has(item.id)) {
          result.push(item);
          seen.add(item.id);
        }
      }
    }
    return result;
  }

  let activeLot: DetailedLot | null = null;

  function planLot(durationMinutes = config.durationMinutes): DetailedLot {
    const rule = getLotRule(durationMinutes);
    const all = matrixStore.getAll();
    const now = Date.now();

    // Tri des révisions échues par urgence
    // Priorité 1 : calculs en Boîte 4, dont la révision du 21e jour donne le cadeau : elle ne doit jamais attendre
    // Priorité 2 : erreurs au statut review
    // Priorité 3 : boîtes les plus basses, puis échéance la plus dépassée
    const dueReviews = all.filter((i) => isItemDue(i, now));
    dueReviews.sort((a, b) => {
      const aIsGiftReview = a.boxLevel === MAX_BOX - 1 ? 1 : 0;
      const bIsGiftReview = b.boxLevel === MAX_BOX - 1 ? 1 : 0;
      if (aIsGiftReview !== bIsGiftReview) return bIsGiftReview - aIsGiftReview;

      const aIsReview = a.status === "review" ? 1 : 0;
      const bIsReview = b.status === "review" ? 1 : 0;
      if (aIsReview !== bIsReview) return bIsReview - aIsReview;

      if (a.boxLevel !== b.boxLevel) return a.boxLevel - b.boxLevel;

      const aDueDiff = now - (a.nextReviewAt ?? a.lastReviewedAt ?? now);
      const bDueDiff = now - (b.nextReviewAt ?? b.lastReviewedAt ?? now);
      return bDueDiff - aDueDiff;
    });
    const unknowns = getOrderedUnknowns();

    // 1. Les révisions échues d'abord : quand elles remplissent le lot, aucun nouveau calcul n'entre
    const reviews = dueReviews.slice(0, rule.max);

    // 2. Puis les nouveaux calculs, dans la limite prévue pour la durée
    const news = unknowns.slice(0, Math.min(rule.news, rule.max - reviews.length));

    const items = [...reviews, ...news];
    const ids = new Set(items.map((i) => i.id));
    const reinforcements: MultiplicationItem[] = [];

    // 3. Lot trop court : compléter avec les calculs en apprentissage dont l'échéance approche
    if (items.length < MIN_LOT_SIZE) {
      const upcoming = all
        .filter((i) => !ids.has(i.id) && i.status !== "unknown" && i.nextReviewAt !== null)
        .sort((a, b) => (a.nextReviewAt ?? 0) - (b.nextReviewAt ?? 0));
      for (const item of upcoming) {
        if (items.length >= MIN_LOT_SIZE) break;
        items.push(item);
        reinforcements.push(item);
        ids.add(item.id);
      }
    }

    // 4. Toujours trop court (premières séances) : quelques nouveaux de plus
    for (const item of unknowns) {
      if (items.length >= MIN_LOT_SIZE) break;
      if (!ids.has(item.id)) {
        items.push(item);
        news.push(item);
        ids.add(item.id);
      }
    }

    return {
      items,
      reviews,
      news,
      reinforcements,
      reviewCount: reviews.length,
      newCount: items.filter((i) => i.status === "unknown").length
    };
  }

  function startSession(): DetailedLot {
    const lot = planLot();
    activeLot = lot;
    lotIds = lot.items.map((i) => i.id);
    // À écouter avant d'être interrogés : les nouveaux et les erreurs. Les révisions échues se font sans rappel
    discoveryIds = lot.items.filter((i) => i.boxLevel === 0).map((i) => i.id);
    discoveryCursor = 0;
    recentPresentedIds = [];
    errorLockouts.clear();
    return lot;
  }

  function getLotItems(ids: string[]): MultiplicationItem[] {
    return ids.map((id) => matrixStore.get(id)).filter((i): i is MultiplicationItem => i !== undefined);
  }

  function getCurrentLot(): MultiplicationItem[] {
    if (lotIds.length === 0) startSession();
    return getLotItems(lotIds);
  }

  return {
    startSession,

    getDiscoveryItems(): MultiplicationItem[] {
      return getLotItems(discoveryIds);
    },

    getNextDiscovery(): MultiplicationItem {
      const items = getLotItems(discoveryIds);
      if (items.length === 0) return this.getNextQuestion();
      const item = items[discoveryCursor % items.length];
      discoveryCursor++;
      return item;
    },

    getNextQuestion(): MultiplicationItem {
      const lot = getCurrentLot();
      if (lot.length === 0) {
        const all = matrixStore.getAll();
        return all[Math.floor(Math.random() * all.length)];
      }

      const now = Date.now();

      // 1. Filtrer les calculs en période de verrouillage après une erreur
      // L enfant doit voir au moins 3 autres calculs avant de revoir une erreur
      const errorFreePool = lot.filter((item) => {
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
        candidates = lot.filter((item) => item.id !== lastId);
      }
      if (candidates.length === 0) {
        candidates = lot;
      }

      // Pondération intelligente
      const weights = candidates.map((item) => {
        let w = (MAX_BOX + 1 - item.boxLevel) * 2;
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

    registerResult(item: MultiplicationItem, mode: "discovery" | "practice" | "time-attack", isCorrect: boolean, timeMs: number): EarnedPoints {
      if (!isCorrect) {
        // Verrouillage de 3 questions intercalaires avant réapparition
        errorLockouts.set(item.id, 3);
      } else {
        errorLockouts.delete(item.id);
      }

      return matrixStore.recordAttempt(item.a, item.b, mode, isCorrect, timeMs);
    },

    // Vrai quand les révisions occupent toute la prochaine séance alors qu'il reste des calculs à découvrir
    isReviewQueueOverloaded(durationMinutes?: number): boolean {
      const stats = this.getQueueStats(durationMinutes);
      return stats.nextSessionNewCount === 0 && stats.newAvailableCount > 0;
    },

    getQueueStats(durationMinutes?: number): QueueStats {
      const all = matrixStore.getAll();
      const now = Date.now();
      const unknowns = getOrderedUnknowns();
      return {
        dueCount: all.filter((i) => isItemDue(i, now)).length,
        learningCount: all.filter((i) => i.status === "discovery" || i.status === "review").length,
        masteredCount: all.filter((i) => i.status === "mastered").length,
        newAvailableCount: unknowns.length,
        nextSessionNewCount: planLot(durationMinutes).newCount
      };
    },

    previewLot(durationMinutes = config.durationMinutes): DetailedLot {
      return planLot(durationMinutes);
    },

    getCurrentLotDetails(): DetailedLot | null {
      return activeLot;
    }
  };
}

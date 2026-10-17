import { MultiplicationItem, ItemStatus, AttemptLog } from "../types";
import { StorageService } from "../services/storageService";
import { profileKey, toWheelDate, WheelDailyState } from "./profileData";

export interface MatrixStore {
  getAll(): MultiplicationItem[];
  get(id: string): MultiplicationItem | undefined;
  getByFactors(a: number, b: number): MultiplicationItem | undefined;
  update(item: MultiplicationItem): void;
  recordAttempt(a: number, b: number, mode: "discovery" | "practice" | "time-attack" | "evaluation", isCorrect: boolean, responseTimeMs: number): void;
  getCountsByStatus(): Record<ItemStatus, number>;
  getDueItemsCount(): number;
  isItemDue(item: MultiplicationItem, now?: number): boolean;
  getHistory(): AttemptLog[];
  addPracticeTimeMs(durationMs: number): void;
  getTotalPracticeTimeMs(): number;
  getOpenedGifts(): string[];
  openGift(itemId: string): void;
  getPoints(): number;
  addPoints(amount: number): number;
  getDailyWheelSpinsLeft(): number;
  useWheelSpin(): boolean;
  getLearningTables(): number[];
  setLearningTables(tables: number[]): void;
  setProfile(profileId: string): void;
  reload(): void;
  resetAll(): void;
  subscribe(callback: () => void): () => void;
}

const DAY_MS = 24 * 3600 * 1000;
// Après une erreur, le calcul revient 10 minutes plus tard
const ERROR_RETRY_MS = 10 * 60 * 1000;
// Règles décrites dans docs/progression-et-recompenses.md : tout changement ici se fait d'abord là-bas
export const MAX_BOX = 5;
// Jours d'attente une fois dans chaque boîte : révisions à J1, J3, J7 et J21, puis entretien tous les 21 jours
const BOX_WAIT_DAYS = [0, 1, 2, 4, 14, 21];
// Au-delà, la réponse n'est pas fluide : elle ne suffit pas pour entrer en Boîte 5
export const SLOW_ANSWER_MS = 3800;
export const GIFT_OPEN_POINTS = 25;

// On ne monte d'une boîte qu'à l'échéance : les réussites répétées d'une même séance entraînent sans faire monter
export function canPromote(item: MultiplicationItem, now = Date.now()): boolean {
  return item.nextReviewAt === null || now >= item.nextReviewAt;
}

// Le cadeau d'un calcul se gagne à la première arrivée en Boîte 5 et n'est jamais repris
export function isGiftUnlocked(item: MultiplicationItem): boolean {
  return item.giftEarned;
}

// Les échéances en jours tombent à minuit : une séance peut avoir lieu à n'importe quelle heure du jour prévu
function startOfDayAfter(now: number, days: number): number {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.getTime();
}

// Ordre des tables à apprendre tant que le parent ne l'a pas changé dans le carnet de suivi
export const DEFAULT_LEARNING_TABLES = [1, 10, 2, 5, 3, 4, 6, 7, 8, 9];

export function createMatrixStore(storage: StorageService, initialProfileId = "default-1"): MatrixStore {
  let currentProfileId = initialProfileId;
  const getStorageKey = () => profileKey("matrix_items", currentProfileId);
  const getHistoryKey = () => profileKey("attempt_history", currentProfileId);
  const getTimeKey = () => profileKey("practice_time", currentProfileId);
  const getGiftsKey = () => profileKey("opened_gifts", currentProfileId);
  const getPointsKey = () => profileKey("points", currentProfileId);
  const getWheelKey = () => profileKey("wheel_spins", currentProfileId);
  const getLearningTablesKey = () => profileKey("learning_tables", currentProfileId);

  let itemsMap: Map<string, MultiplicationItem> = new Map();
  let history: AttemptLog[] = [];
  let openedGifts: Set<string> = new Set();
  let totalPracticeTimeMs = 0;
  let points = 0;
  let learningTables: number[] = [...DEFAULT_LEARNING_TABLES];
  const listeners: Set<() => void> = new Set();

  function isItemDueCheck(item: MultiplicationItem, now = Date.now()): boolean {
    if (item.status === "review") return true;
    if (item.nextReviewAt !== null && now >= item.nextReviewAt) return true;
    return false;
  }

  function initDefaultItems(): Map<string, MultiplicationItem> {
    const map = new Map<string, MultiplicationItem>();
    for (let a = 1; a <= 10; a++) {
      for (let b = 1; b <= 10; b++) {
        const id = `${a}x${b}`;
        map.set(id, {
          id,
          a,
          b,
          result: a * b,
          status: "unknown",
          boxLevel: 0,
          giftEarned: false,
          seenCount: 0,
          errorCount: 0,
          successStreak: 0,
          avgResponseTimeMs: 0,
          responseTimesMs: [],
          lastReviewedAt: null,
          nextReviewAt: null,
          intervalDays: 1
        });
      }
    }
    return map;
  }

  function getTodayString(): string {
    return toWheelDate(new Date());
  }

  function loadForCurrentProfile() {
    history = storage.get<AttemptLog[]>(getHistoryKey(), []);
    totalPracticeTimeMs = storage.get<number>(getTimeKey(), 0);
    openedGifts = new Set(storage.get<string[]>(getGiftsKey(), []));
    points = storage.get<number>(getPointsKey(), 0);
    const savedTables = storage.get<number[]>(getLearningTablesKey(), DEFAULT_LEARNING_TABLES);
    if (Array.isArray(savedTables)) {
      learningTables = Array.from(new Set(savedTables.filter((t) => Number.isInteger(t) && t >= 1 && t <= 10)));
    } else {
      learningTables = [...DEFAULT_LEARNING_TABLES];
    }
    const savedItems = storage.get<MultiplicationItem[]>(getStorageKey(), []);

    itemsMap = new Map();
    if (savedItems && savedItems.length === 100) {
      savedItems.forEach((item) => {
        if (!Array.isArray(item.responseTimesMs)) {
          item.responseTimesMs = [];
        }
        if (typeof item.giftEarned !== "boolean") {
          // Données d'avant la Boîte 5 : le cadeau se gagnait dès la Boîte 2, et un cadeau gagné reste acquis
          const legacy = item as MultiplicationItem & { bestBoxLevel?: number };
          item.giftEarned = (legacy.bestBoxLevel ?? 0) >= 2 || openedGifts.has(item.id);
          delete legacy.bestBoxLevel;
        }
        // Avant la Boîte 5, la maîtrise s'obtenait en Boîte 4 : il reste à ces calculs la révision de J21
        if (item.status === "mastered" && item.boxLevel < MAX_BOX) {
          item.status = "discovery";
        }
        if (typeof item.intervalDays !== "number") {
          item.intervalDays = BOX_WAIT_DAYS[Math.min(MAX_BOX, Math.max(0, item.boxLevel || 0))] || 1;
        }
        if (item.nextReviewAt === undefined) {
          item.nextReviewAt = item.lastReviewedAt ? item.lastReviewedAt + Math.round(item.intervalDays * DAY_MS) : null;
        }
        itemsMap.set(item.id, item);
      });
    } else {
      itemsMap = initDefaultItems();
      save();
    }
  }

  loadForCurrentProfile();

  function save() {
    storage.set(getStorageKey(), Array.from(itemsMap.values()));
    storage.set(getHistoryKey(), history);
    storage.set(getTimeKey(), totalPracticeTimeMs);
    storage.set(getGiftsKey(), Array.from(openedGifts));
    storage.set(getPointsKey(), points);
    notify();
  }

  function notify() {
    listeners.forEach((fn) => fn());
  }

  return {
    getAll(): MultiplicationItem[] {
      return Array.from(itemsMap.values());
    },

    get(id: string): MultiplicationItem | undefined {
      return itemsMap.get(id);
    },

    getByFactors(a: number, b: number): MultiplicationItem | undefined {
      return itemsMap.get(`${a}x${b}`);
    },

    update(item: MultiplicationItem): void {
      itemsMap.set(item.id, item);
      save();
    },

    isItemDue(item: MultiplicationItem, now?: number): boolean {
      return isItemDueCheck(item, now);
    },

    getDueItemsCount(): number {
      const now = Date.now();
      let count = 0;
      itemsMap.forEach((item) => {
        if (isItemDueCheck(item, now)) {
          count++;
        }
      });
      return count;
    },

    recordAttempt(a: number, b: number, mode: "discovery" | "practice" | "time-attack" | "evaluation", isCorrect: boolean, responseTimeMs: number): void {
      const id = `${a}x${b}`;
      const item = itemsMap.get(id);
      if (!item) return;

      const now = Date.now();
      const isDueForPromotion = canPromote(item, now);
      item.seenCount += 1;
      item.lastReviewedAt = now;

      // Historique des tentatives
      const log: AttemptLog = {
        id: `${now}-${Math.random().toString(36).substring(2, 6)}`,
        itemId: id,
        a,
        b,
        mode,
        isCorrect,
        responseTimeMs,
        timestamp: now
      };
      history.unshift(log);
      if (history.length > 500) {
        history.pop();
      }

      if (mode === "discovery") {
        if (item.status === "unknown") {
          item.status = "discovery";
        }
        // Échu tout de suite : la première réussite au quiz qui suit l'écoute fait entrer en Boîte 1
        if (item.nextReviewAt === null) {
          item.nextReviewAt = now;
        }
        points += 5;
      } else {
        // Enregistrer tous les temps mesurés
        if (responseTimeMs > 0) {
          if (!Array.isArray(item.responseTimesMs)) {
            item.responseTimesMs = [];
          }
          item.responseTimesMs.push(responseTimeMs);
          const sum = item.responseTimesMs.reduce((acc, cur) => acc + cur, 0);
          item.avgResponseTimeMs = Math.round(sum / item.responseTimesMs.length);
        }

        if (isCorrect) {
          item.successStreak += 1;

          // Toute bonne réponse rapporte des points, même à l'entraînement
          points += 10;

          // Bonus rapidité sous 2500ms
          if (responseTimeMs > 0 && responseTimeMs < 2500) {
            points += 5;
          }

          if (isDueForPromotion) {
            // L'entrée en Boîte 5 demande une réponse fluide : sinon le calcul revient le lendemain
            const isHeldBack = item.boxLevel === MAX_BOX - 1 && responseTimeMs > SLOW_ANSWER_MS;
            if (isHeldBack) {
              item.intervalDays = 1;
            } else {
              item.boxLevel = Math.min(MAX_BOX, item.boxLevel + 1);
              item.intervalDays = BOX_WAIT_DAYS[item.boxLevel];
            }

            if (item.boxLevel === MAX_BOX) {
              if (item.status !== "mastered") {
                points += 50; // Super bonus maîtrise
              }
              item.status = "mastered";
              item.giftEarned = true;
            } else {
              item.status = "discovery";
            }
            item.nextReviewAt = startOfDayAfter(now, item.intervalDays);
          }
        } else {
          item.errorCount += 1;
          item.successStreak = 0;
          item.boxLevel = 0;
          item.status = "review";
          item.intervalDays = Number((ERROR_RETRY_MS / DAY_MS).toFixed(4));
          item.nextReviewAt = now + ERROR_RETRY_MS;
        }
      }

      itemsMap.set(id, item);
      save();
    },

    getCountsByStatus(): Record<ItemStatus, number> {
      const counts: Record<ItemStatus, number> = {
        unknown: 0,
        discovery: 0,
        review: 0,
        mastered: 0
      };
      itemsMap.forEach((item) => {
        counts[item.status] += 1;
      });
      return counts;
    },

    getHistory(): AttemptLog[] {
      return [...history];
    },

    addPracticeTimeMs(durationMs: number): void {
      if (durationMs > 0) {
        totalPracticeTimeMs += durationMs;
        save();
      }
    },

    getTotalPracticeTimeMs(): number {
      return totalPracticeTimeMs;
    },

    getOpenedGifts(): string[] {
      return Array.from(openedGifts);
    },

    openGift(itemId: string): void {
      if (!openedGifts.has(itemId)) {
        openedGifts.add(itemId);
        save();
      }
    },

    getPoints(): number {
      return points;
    },

    addPoints(amount: number): number {
      if (amount > 0) {
        points += amount;
        save();
      }
      return points;
    },

    getDailyWheelSpinsLeft(): number {
      const today = getTodayString();
      const state = storage.get<WheelDailyState>(getWheelKey(), { date: today, usedSpins: 0 });
      if (state.date !== today) {
        return 3;
      }
      return Math.max(0, 3 - state.usedSpins);
    },

    useWheelSpin(): boolean {
      const today = getTodayString();
      const state = storage.get<WheelDailyState>(getWheelKey(), { date: today, usedSpins: 0 });
      let currentUsed = state.usedSpins;
      if (state.date !== today) {
        currentUsed = 0;
      }
      if (currentUsed >= 3) {
        return false;
      }
      storage.set(getWheelKey(), { date: today, usedSpins: currentUsed + 1 });
      notify();
      return true;
    },

    getLearningTables(): number[] {
      return [...learningTables];
    },

    setLearningTables(tables: number[]): void {
      const sanitized = Array.from(new Set(tables.filter((t) => Number.isInteger(t) && t >= 1 && t <= 10)));
      learningTables = sanitized;
      storage.set(getLearningTablesKey(), learningTables);
      notify();
    },

    setProfile(profileId: string): void {
      if (currentProfileId !== profileId) {
        currentProfileId = profileId;
        loadForCurrentProfile();
        notify();
      }
    },

    reload(): void {
      loadForCurrentProfile();
      notify();
    },

    resetAll(): void {
      itemsMap = initDefaultItems();
      history = [];
      totalPracticeTimeMs = 0;
      openedGifts.clear();
      points = 0;
      storage.remove(getLearningTablesKey());
      learningTables = [...DEFAULT_LEARNING_TABLES];
      save();
    },

    subscribe(callback: () => void): () => void {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  };
}

import { MultiplicationItem, ItemStatus, AttemptLog } from "../types";
import { StorageService } from "../services/storageService";

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
  setProfile(profileId: string): void;
  resetAll(): void;
  subscribe(callback: () => void): () => void;
}

export function createMatrixStore(storage: StorageService, initialProfileId = "default-1"): MatrixStore {
  let currentProfileId = initialProfileId;
  const getStorageKey = () => `matrix_items_${currentProfileId}`;
  const getHistoryKey = () => `attempt_history_${currentProfileId}`;
  const getTimeKey = () => `practice_time_${currentProfileId}`;
  const getGiftsKey = () => `opened_gifts_${currentProfileId}`;
  const getPointsKey = () => `points_${currentProfileId}`;
  const getWheelKey = () => `wheel_spins_${currentProfileId}`;

  let itemsMap: Map<string, MultiplicationItem> = new Map();
  let history: AttemptLog[] = [];
  let openedGifts: Set<string> = new Set();
  let totalPracticeTimeMs = 0;
  let points = 0;
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
          seenCount: 0,
          errorCount: 0,
          successStreak: 0,
          avgResponseTimeMs: 0,
          responseTimesMs: [],
          lastReviewedAt: null,
          nextReviewAt: null,
          intervalDays: 1,
          easeFactor: 2.5
        });
      }
    }
    return map;
  }

  interface WheelDailyState {
    date: string;
    usedSpins: number;
  }

  function getTodayString(): string {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }

  function loadForCurrentProfile() {
    history = storage.get<AttemptLog[]>(getHistoryKey(), []);
    totalPracticeTimeMs = storage.get<number>(getTimeKey(), 0);
    openedGifts = new Set(storage.get<string[]>(getGiftsKey(), []));
    points = storage.get<number>(getPointsKey(), 0);
    const savedItems = storage.get<MultiplicationItem[]>(getStorageKey(), []);

    itemsMap = new Map();
    if (savedItems && savedItems.length === 100) {
      savedItems.forEach((item) => {
        if (!Array.isArray(item.responseTimesMs)) {
          item.responseTimesMs = [];
        }
        if (typeof item.easeFactor !== "number") {
          item.easeFactor = 2.5;
        }
        if (typeof item.intervalDays !== "number") {
          const baseDays = [10 / 1440, 1, 3, 7, 21][Math.min(4, Math.max(0, item.boxLevel || 0))];
          item.intervalDays = baseDays;
        }
        if (item.nextReviewAt === undefined) {
          if (item.lastReviewedAt) {
            item.nextReviewAt = item.lastReviewedAt + Math.round(item.intervalDays * 24 * 3600 * 1000);
          } else {
            item.nextReviewAt = null;
          }
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
        if (item.nextReviewAt === null) {
          item.intervalDays = 1;
          item.nextReviewAt = now + 24 * 3600 * 1000;
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
          item.boxLevel = Math.min(4, item.boxLevel + 1);

          // Ajustement selon la vitesse de réponse
          let speedFactor = 1.0;
          if (responseTimeMs > 0 && responseTimeMs < 2200) {
            speedFactor = 1.2;
            item.easeFactor = Math.min(3.0, Number((item.easeFactor + 0.1).toFixed(2)));
          } else if (responseTimeMs > 3800) {
            speedFactor = 0.8;
            item.easeFactor = Math.max(1.3, Number((item.easeFactor - 0.1).toFixed(2)));
          }

          // Paliers de référence : 0 = 10min, 1 = 1j, 2 = 3j, 3 = 7j, 4 = 21j
          const baseDays = [10 / 1440, 1, 3, 7, 21][item.boxLevel];
          const calculatedDays = baseDays * (item.easeFactor / 2.5) * speedFactor;
          item.intervalDays = Math.max(0.007, Number(Math.min(21, calculatedDays).toFixed(2)));
          item.nextReviewAt = now + Math.round(item.intervalDays * 24 * 3600 * 1000);

          // Attribution des points
          points += 10;

          // Bonus rapidité sous 2500ms
          if (responseTimeMs > 0 && responseTimeMs < 2500) {
            points += 5;
          }

          if (item.boxLevel >= 3 && item.successStreak >= 3 && (responseTimeMs === 0 || responseTimeMs < 3800)) {
            if (item.status !== "mastered") {
              points += 50; // Super bonus maîtrise
            }
            item.status = "mastered";
            item.intervalDays = 21;
            item.nextReviewAt = now + 21 * 24 * 3600 * 1000;
          } else if (item.status === "unknown") {
            item.status = "discovery";
          }
        } else {
          item.errorCount += 1;
          item.successStreak = 0;
          item.boxLevel = 0;
          item.status = "review";
          item.easeFactor = Math.max(1.3, Number((item.easeFactor - 0.2).toFixed(2)));
          item.intervalDays = Number((10 / 1440).toFixed(4));
          item.nextReviewAt = now + 10 * 60 * 1000;
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

    setProfile(profileId: string): void {
      if (currentProfileId !== profileId) {
        currentProfileId = profileId;
        loadForCurrentProfile();
        notify();
      }
    },

    resetAll(): void {
      itemsMap = initDefaultItems();
      history = [];
      totalPracticeTimeMs = 0;
      openedGifts.clear();
      points = 0;
      save();
    },

    subscribe(callback: () => void): () => void {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }
  };
}

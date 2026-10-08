import { MultiplicationItem, ItemStatus, AttemptLog } from "../types";
import { StorageService } from "../services/storageService";

export interface MatrixStore {
  getAll(): MultiplicationItem[];
  get(id: string): MultiplicationItem | undefined;
  getByFactors(a: number, b: number): MultiplicationItem | undefined;
  update(item: MultiplicationItem): void;
  recordAttempt(a: number, b: number, mode: "discovery" | "practice" | "time-attack" | "evaluation", isCorrect: boolean, responseTimeMs: number): void;
  getCountsByStatus(): Record<ItemStatus, number>;
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
          lastReviewedAt: null
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

    recordAttempt(a: number, b: number, mode: "discovery" | "practice" | "time-attack" | "evaluation", isCorrect: boolean, responseTimeMs: number): void {
      const id = `${a}x${b}`;
      const item = itemsMap.get(id);
      if (!item) return;

      const now = Date.now();
      item.seenCount += 1;
      item.lastReviewedAt = now;

      // Historique
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
        points += 5;
      } else {
        // Enregistrer tous les temps mesurés
        if (responseTimeMs > 0) {
          if (!Array.isArray(item.responseTimesMs)) {
            item.responseTimesMs = [];
          }
          item.responseTimesMs.push(responseTimeMs);
          const sum = item.responseTimesMs.reduce((a, b) => a + b, 0);
          item.avgResponseTimeMs = Math.round(sum / item.responseTimesMs.length);
        }

        if (isCorrect) {
          item.successStreak += 1;
          item.boxLevel = Math.min(4, item.boxLevel + 1);

          // Toute bonne réponse donne des points (+10 points)
          points += 10;

          // Bonus de rapidité (< 2500ms -> +5 points bonus)
          if (responseTimeMs > 0 && responseTimeMs < 2500) {
            points += 5;
          }

          if (item.boxLevel >= 3 && item.successStreak >= 3 && (responseTimeMs === 0 || responseTimeMs < 3800)) {
            if (item.status !== "mastered") {
              points += 50; // Super bonus maîtrise !
            }
            item.status = "mastered";
          } else if (item.status === "unknown") {
            item.status = "discovery";
          }
        } else {
          item.errorCount += 1;
          item.successStreak = 0;
          item.boxLevel = 0;
          item.status = "review";
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

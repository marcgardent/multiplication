export interface SessionTimer {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  getRemainingSeconds(): number;
  getTotalSeconds(): number;
  getFormattedRemaining(): string;
  getProgressPercent(): number;
}

export function createSessionTimer(
  durationMinutes: number,
  onTick?: (remainingSeconds: number, formatted: string) => void,
  onComplete?: () => void
): SessionTimer {
  const totalSeconds = Math.max(10, Math.round(durationMinutes * 60));
  let remaining = totalSeconds;
  let intervalId: number | null = null;
  let isRunning = false;

  function formatTime(secs: number): string {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? "0" : ""}${s}`;
  }

  function tick() {
    if (remaining > 0) {
      remaining -= 1;
      onTick?.(remaining, formatTime(remaining));
      if (remaining === 0) {
        stop();
        onComplete?.();
      }
    }
  }

  function stop() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
    isRunning = false;
  }

  return {
    start() {
      stop();
      remaining = totalSeconds;
      isRunning = true;
      onTick?.(remaining, formatTime(remaining));
      intervalId = window.setInterval(tick, 1000);
    },

    pause() {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
      isRunning = false;
    },

    resume() {
      if (!isRunning && remaining > 0) {
        isRunning = true;
        intervalId = window.setInterval(tick, 1000);
      }
    },

    stop,

    getRemainingSeconds() {
      return remaining;
    },

    getTotalSeconds() {
      return totalSeconds;
    },

    getFormattedRemaining() {
      return formatTime(remaining);
    },

    getProgressPercent() {
      return Math.round(((totalSeconds - remaining) / totalSeconds) * 100);
    }
  };
}

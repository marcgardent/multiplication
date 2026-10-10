import { AudioService } from "../services/audioService";

// Durée minimale avant d'afficher les boutons : un double appui ne doit pas refermer la fenêtre
const MIN_REVEAL_MS = 1200;
// Garde-fou : les boutons finissent toujours par apparaître, même si un son ne se termine jamais
const MAX_WAIT_MS = 15000;
const COUNT_DURATION_MS = 2500;

export interface CelebrationOptions {
  root: HTMLElement;
  audioService: AudioService;
  // Opération dite à voix haute avant la félicitation : « 2 fois 3, 6 »
  operation?: { a: number; b: number; result: number };
  cheer?: boolean;
  points?: { element: HTMLElement | null; from: number; to: number };
  // Attente avant le décompte quand aucune opération n'est dite
  leadInMs?: number;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fonction utilitaire pour animer le compteur de points
export function animateCounter(
  element: HTMLElement,
  start: number,
  end: number,
  durationMs = COUNT_DURATION_MS,
  onFinish?: () => void,
  onTick?: () => void
): void {
  const range = end - start;
  if (range <= 0) {
    element.textContent = end.toString();
    onFinish?.();
    return;
  }
  const startTime = performance.now();
  let lastVal = start;

  function update(currentTime: number) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    // Easing out cubic
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + range * ease);

    if (current !== lastVal) {
      lastVal = current;
      element.textContent = current.toString();
      onTick?.();
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = end.toString();
      onFinish?.();
    }
  }

  requestAnimationFrame(update);
}

// Séquence commune aux fenêtres de félicitation :
// boutons masqués, opération dite, félicitation, décompte des points, puis boutons
export async function runCelebration(options: CelebrationOptions): Promise<void> {
  const { root, audioService, operation, cheer = false, points, leadInMs = 0 } = options;
  const openedAt = performance.now();
  const buttons = Array.from(root.querySelectorAll("button"));
  const badge = root.querySelector(".points-added-badge");
  let isRevealed = false;

  buttons.forEach((btn) => btn.classList.add("is-waiting"));

  const reveal = () => {
    if (isRevealed) return;
    isRevealed = true;
    badge?.classList.remove("is-counting");
    badge?.classList.add("is-counted");
    buttons.forEach((btn) => {
      btn.classList.remove("is-waiting");
      btn.classList.add("is-revealed");
    });
  };
  const guard = setTimeout(reveal, MAX_WAIT_MS);

  if (operation) {
    await audioService.playQuestion(operation.a, operation.b);
    if (root.isConnected) await audioService.playAnswer(operation.result);
  } else if (leadInMs > 0) {
    await wait(leadInMs);
  }

  if (cheer && root.isConnected) await audioService.playCheer();

  // Une chose à la fois : le décompte ne démarre qu'une fois la voix terminée
  const pointsEl = points?.element;
  if (root.isConnected && points && pointsEl && points.to > points.from) {
    badge?.classList.add("is-counting");
    await new Promise<void>((resolve) => {
      animateCounter(
        pointsEl,
        points.from,
        points.to,
        COUNT_DURATION_MS,
        () => {
          audioService.playCoinSound();
          resolve();
        },
        () => audioService.playPointTick()
      );
    });
  }

  if (root.isConnected) {
    await wait(Math.max(0, MIN_REVEAL_MS - (performance.now() - openedAt)));
  }

  clearTimeout(guard);
  reveal();
}

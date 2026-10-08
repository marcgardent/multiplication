import { RepetitionEngine } from "../core/repetitionEngine";
import { AudioService } from "../services/audioService";
import { SessionTimer, createSessionTimer } from "../components/timer";
import { SessionConfig, MultiplicationItem } from "../types";

export interface GameMode {
  start(container: HTMLElement, onFinished: () => void): void;
  stop(): void;
}

export function createDiscoveryMode(
  engine: RepetitionEngine,
  audioService: AudioService,
  config: SessionConfig
): GameMode {
  let isRunning = false;
  let timer: SessionTimer | null = null;
  let containerEl: HTMLElement | null = null;
  let currentItem: MultiplicationItem | null = null;
  let onFinishCallback: (() => void) | null = null;

  function renderView(): HTMLElement {
    const root = document.createElement("div");
    root.className = "mode-screen mode-discovery";
    root.innerHTML = `
      <div class="mode-header">
        <div class="session-badge">🎧 Mode Découverte et Écoute</div>
        <div class="timer-display" id="disc-timer">--:--</div>
      </div>

      <div class="progress-bar-container">
        <div class="progress-bar-fill" id="disc-progress" style="width: 0%;"></div>
      </div>

      <div class="question-stage">
        <div class="stage-card">
          <div class="stage-factors" id="disc-factors">Préparation...</div>
          <div class="stage-equals">=</div>
          <div class="stage-answer" id="disc-answer">?</div>
        </div>
        <div class="status-cue" id="disc-cue">Écoutez attentivement...</div>
      </div>

      <div class="mode-controls">
        <button type="button" class="btn-cancel" id="btn-quit-disc">Arrêter la session</button>
      </div>
    `;
    return root;
  }

  async function loopStep() {
    if (!isRunning || !containerEl) return;

    currentItem = engine.getNextQuestion();
    const factorsEl = containerEl.querySelector("#disc-factors");
    const answerEl = containerEl.querySelector("#disc-answer");
    const cueEl = containerEl.querySelector("#disc-cue");

    if (factorsEl) factorsEl.textContent = `${currentItem.a} × ${currentItem.b}`;
    if (answerEl) {
      answerEl.textContent = "?";
      answerEl.classList.remove("revealed");
    }
    if (cueEl) cueEl.textContent = `Question : ${currentItem.a} fois ${currentItem.b}...`;

    // 1. Jouer la question audio
    await audioService.playQuestion(currentItem.a, currentItem.b);
    if (!isRunning) return;

    // 2. Pause réflexive
    if (cueEl) cueEl.textContent = "Réfléchissez à la réponse...";
    await new Promise((r) => setTimeout(r, config.pauseBetweenAudioMs));
    if (!isRunning) return;

    // 3. Révéler la réponse visuellement et vocalement
    if (answerEl) {
      answerEl.textContent = currentItem.result.toString();
      answerEl.classList.add("revealed");
    }
    if (cueEl) cueEl.textContent = `Réponse : ${currentItem.result} !`;

    await audioService.playAnswer(currentItem.result);
    if (!isRunning) return;

    // Enregistrer comme vu en mode découverte
    engine.registerResult(currentItem, "discovery", true, 0);

    // Pause avant le calcul suivant
    await new Promise((r) => setTimeout(r, 1200));

    if (isRunning) {
      loopStep();
    }
  }

  return {
    start(container: HTMLElement, onFinished: () => void) {
      isRunning = true;
      onFinishCallback = onFinished;
      containerEl = renderView();
      container.appendChild(containerEl);

      containerEl.querySelector("#btn-quit-disc")?.addEventListener("click", () => {
        this.stop();
        onFinished();
      });

      // Minuterie stricte des N minutes
      timer = createSessionTimer(
        config.durationMinutes,
        (_remaining, formatted) => {
          const tEl = containerEl?.querySelector("#disc-timer");
          const pEl = containerEl?.querySelector("#disc-progress") as HTMLElement;
          if (tEl) tEl.textContent = formatted;
          if (pEl && timer) pEl.style.width = `${timer.getProgressPercent()}%`;
        },
        () => {
          // Fin de session atteinte après N minutes
          this.stop();
          audioService.playFeedback("finish");
          onFinishCallback?.();
        }
      );

      timer.start();
      loopStep();
    },

    stop() {
      isRunning = false;
      timer?.stop();
      timer = null;
      audioService.stop();
      containerEl?.remove();
      containerEl = null;
    }
  };
}

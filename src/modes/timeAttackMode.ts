import { RepetitionEngine } from "../core/repetitionEngine";
import { AudioService } from "../services/audioService";
import { SessionTimer, createSessionTimer } from "../components/timer";
import { KeypadComponent, createKeypad } from "../components/keypad";
import { SessionConfig, MultiplicationItem } from "../types";
import { GameMode } from "./discoveryMode";

export function createTimeAttackMode(
  engine: RepetitionEngine,
  audioService: AudioService,
  config: SessionConfig
): GameMode {
  let isRunning = false;
  let sessionTimer: SessionTimer | null = null;
  let keypad: KeypadComponent | null = null;
  let containerEl: HTMLElement | null = null;
  let currentItem: MultiplicationItem | null = null;
  let currentInput = "";
  let questionStartTime = 0;

  // Statistiques de la session courante
  let totalCount = 0;
  let successCount = 0;
  let totalResponseTimeMs = 0;

  function renderView(): HTMLElement {
    const root = document.createElement("div");
    root.className = "mode-screen mode-timeattack";
    root.innerHTML = `
      <div class="mode-header">
        <div class="session-badge">⚡ Time-Attack Vitesse</div>
        <div class="timer-display" id="ta-timer">--:--</div>
      </div>

      <div class="progress-bar-container">
        <div class="progress-bar-fill" id="ta-progress" style="width: 0%;"></div>
      </div>

      <div class="stats-live-bar">
        <span class="live-stat" id="ta-score">Score : 0/0</span>
        <span class="live-stat" id="ta-avg">Moyenne : -</span>
      </div>

      <div class="question-stage">
        <div class="stage-card" id="ta-card">
          <div class="stage-factors" id="ta-factors">Prêt ?</div>
          <div class="stage-equals">=</div>
          <div class="stage-answer user-answer" id="ta-input">?</div>
        </div>
        <div class="feedback-cue" id="ta-cue">Réponds le plus vite possible !</div>
      </div>

      <div class="keypad-mount-point" id="ta-keypad"></div>

      <div class="mode-controls">
        <button type="button" class="btn-cancel" id="btn-quit-ta">Arrêter le défi</button>
      </div>
    `;
    return root;
  }

  function updateLiveStats() {
    if (!containerEl) return;
    const scoreEl = containerEl.querySelector("#ta-score");
    const avgEl = containerEl.querySelector("#ta-avg");
    if (scoreEl) scoreEl.textContent = `Score : ${successCount}/${totalCount}`;
    if (avgEl) {
      if (successCount > 0) {
        const avg = Math.round(totalResponseTimeMs / totalCount);
        avgEl.textContent = `Moyenne : ${(avg / 1000).toFixed(2)}s`;
      } else {
        avgEl.textContent = `Moyenne : -`;
      }
    }
  }

  function nextQuestion() {
    if (!isRunning || !containerEl) return;
    currentItem = engine.getNextQuestion();
    currentInput = "";
    keypad?.clear();
    keypad?.setEnabled(true);

    const factorsEl = containerEl.querySelector("#ta-factors");
    const inputEl = containerEl.querySelector("#ta-input");
    const cueEl = containerEl.querySelector("#ta-cue");
    const cardEl = containerEl.querySelector("#ta-card");

    if (factorsEl) factorsEl.textContent = `${currentItem.a} × ${currentItem.b}`;
    if (inputEl) {
      inputEl.textContent = "_";
      inputEl.className = "stage-answer user-answer";
    }
    if (cueEl) cueEl.textContent = "⏱️ Chrono en cours...";
    if (cardEl) cardEl.className = "stage-card";

    // Déclencher le chronomètre précis de la question
    questionStartTime = performance.now();

    // Audio facultatif ou simultané
    audioService.playQuestion(currentItem.a, currentItem.b);
  }

  async function checkAnswer(valueStr: string) {
    if (!currentItem || !containerEl || questionStartTime === 0) return;
    const responseTimeMs = Math.round(performance.now() - questionStartTime);
    const value = parseInt(valueStr, 10);
    const isCorrect = value === currentItem.result;

    totalCount++;
    totalResponseTimeMs += responseTimeMs;
    if (isCorrect) successCount++;
    updateLiveStats();

    keypad?.setEnabled(false);
    const cardEl = containerEl.querySelector("#ta-card");
    const cueEl = containerEl.querySelector("#ta-cue");
    const inputEl = containerEl.querySelector("#ta-input");
    const item = currentItem;

    // Enregistrement précis dans le store pour les statistiques et la répétition espacée
    engine.registerResult(item, "time-attack", isCorrect, responseTimeMs);

    if (isCorrect) {
      cardEl?.classList.add("card-correct");
      if (inputEl) {
        inputEl.textContent = item.result.toString();
        inputEl.classList.add("revealed");
      }
      if (cueEl) cueEl.textContent = `Correct en ${(responseTimeMs / 1000).toFixed(2)}s ! ⚡`;
      audioService.playFeedback("correct");
      await audioService.playAnswer(item.result);
    } else {
      cardEl?.classList.add("card-wrong");
      if (cueEl) cueEl.textContent = `Correction : ${item.a} × ${item.b} = ${item.result} ⚠️`;
      audioService.playFeedback("wrong");
      await new Promise((r) => setTimeout(r, 350));
      if (!isRunning) return;
      if (inputEl) {
        inputEl.textContent = item.result.toString();
        inputEl.classList.add("revealed");
      }
      await audioService.playAnswer(item.result);
    }

    await new Promise((r) => setTimeout(r, 700));
    if (isRunning) nextQuestion();
  }

  return {
    start(container: HTMLElement, onFinished: () => void) {
      isRunning = true;
      totalCount = 0;
      successCount = 0;
      totalResponseTimeMs = 0;

      containerEl = renderView();
      container.appendChild(containerEl);

      const keypadMount = containerEl.querySelector("#ta-keypad") as HTMLElement;
      keypad = createKeypad({
        showHelpButton: false,
        onInput: (_digit, fullVal) => {
          currentInput = fullVal;
          const inputEl = containerEl?.querySelector("#ta-input");
          if (inputEl) inputEl.textContent = currentInput;

          if (currentItem && currentInput.length >= currentItem.result.toString().length) {
            checkAnswer(currentInput);
          }
        },
        onDelete: (fullVal) => {
          currentInput = fullVal;
          const inputEl = containerEl?.querySelector("#ta-input");
          if (inputEl) inputEl.textContent = currentInput.length > 0 ? currentInput : "_";
        }
      });
      keypad.mount(keypadMount);

      containerEl.querySelector("#btn-quit-ta")?.addEventListener("click", () => {
        this.stop();
        onFinished();
      });

      sessionTimer = createSessionTimer(
        config.durationMinutes,
        (_remaining, formatted) => {
          const tEl = containerEl?.querySelector("#ta-timer");
          const pEl = containerEl?.querySelector("#ta-progress") as HTMLElement;
          if (tEl) tEl.textContent = formatted;
          if (pEl && sessionTimer) pEl.style.width = `${sessionTimer.getProgressPercent()}%`;
        },
        () => {
          this.stop();
          audioService.playFeedback("finish");
          onFinished();
        }
      );

      sessionTimer.start();
      nextQuestion();
    },

    stop() {
      isRunning = false;
      sessionTimer?.stop();
      sessionTimer = null;
      keypad?.destroy();
      keypad = null;
      audioService.stop();
      containerEl?.remove();
      containerEl = null;
    }
  };
}

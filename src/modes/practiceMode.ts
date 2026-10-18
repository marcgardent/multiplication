import { RepetitionEngine } from "../core/repetitionEngine";
import { AudioService } from "../services/audioService";
import { SessionTimer, createSessionTimer } from "../components/timer";
import { KeypadComponent, createKeypad } from "../components/keypad";
import { SessionConfig, MultiplicationItem } from "../types";
import { GameMode } from "./discoveryMode";

export function createPracticeMode(
  engine: RepetitionEngine,
  audioService: AudioService,
  config: SessionConfig
): GameMode {
  let isRunning = false;
  let timer: SessionTimer | null = null;
  let keypad: KeypadComponent | null = null;
  let containerEl: HTMLElement | null = null;
  let currentItem: MultiplicationItem | null = null;
  let currentInput = "";
  let hasUsedHelpForCurrent = false;
  let questionStartTime = 0;

  function renderView(): HTMLElement {
    const root = document.createElement("div");
    root.className = "mode-screen mode-practice";
    root.innerHTML = `
      <div class="mode-header">
        <div class="session-badge">🎯 Quiz Sans Enjeu</div>
        <div class="timer-display" id="prac-timer">--:--</div>
      </div>

      <div class="progress-bar-container">
        <div class="progress-bar-fill" id="prac-progress" style="width: 0%;"></div>
      </div>

      <div class="question-stage">
        <div class="stage-card" id="prac-card">
          <div class="stage-factors" id="prac-factors">Chargement...</div>
          <div class="stage-equals">=</div>
          <div class="stage-answer user-answer" id="prac-input">?</div>
        </div>
        <div class="feedback-cue" id="prac-cue">Tape ta réponse</div>
      </div>

      <div class="action-bar-secondary">
        <button type="button" class="btn-help-inline" id="btn-show-answer">💡 Donner la réponse</button>
        <button type="button" class="btn-repeat-audio" id="btn-audio-repeat" aria-label="Répéter la question">🔊</button>
      </div>

      <div class="keypad-mount-point" id="prac-keypad"></div>

      <div class="mode-controls">
        <button type="button" class="btn-cancel" id="btn-quit-prac">Quitter le quiz</button>
      </div>
    `;
    return root;
  }

  function nextQuestion() {
    if (!isRunning || !containerEl) return;
    currentItem = engine.getNextQuestion();
    currentInput = "";
    hasUsedHelpForCurrent = false;
    keypad?.clear();
    keypad?.setEnabled(true);

    const factorsEl = containerEl.querySelector("#prac-factors");
    const inputEl = containerEl.querySelector("#prac-input");
    const cueEl = containerEl.querySelector("#prac-cue");
    const cardEl = containerEl.querySelector("#prac-card");

    if (factorsEl) factorsEl.textContent = `${currentItem.a} × ${currentItem.b}`;
    if (inputEl) {
      inputEl.textContent = "_";
      inputEl.className = "stage-answer user-answer";
    }
    if (cueEl) cueEl.textContent = "Prends ton temps...";
    if (cardEl) cardEl.className = "stage-card";

    // Lecture vocale de la question
    questionStartTime = performance.now();
    audioService.playQuestion(currentItem.a, currentItem.b);
  }

  async function checkAnswer(valueStr: string) {
    if (!currentItem || !containerEl) return;
    const responseTimeMs = questionStartTime > 0 ? Math.round(performance.now() - questionStartTime) : 0;
    const value = parseInt(valueStr, 10);
    const cardEl = containerEl.querySelector("#prac-card");
    const cueEl = containerEl.querySelector("#prac-cue");
    const inputEl = containerEl.querySelector("#prac-input");

    if (value === currentItem.result) {
      // Bonne réponse
      keypad?.setEnabled(false);
      cardEl?.classList.add("card-correct");
      if (cueEl) cueEl.textContent = "Bravo ! Exact ! 🎉";
      audioService.playFeedback("correct");

      // Si l'élève a utilisé l'aide pour ce calcul, il ne compte pas comme un succès direct
      engine.registerResult(currentItem, "practice", !hasUsedHelpForCurrent, responseTimeMs);

      await new Promise((r) => setTimeout(r, 900));
      if (isRunning) nextQuestion();
    } else {
      // Mauvaise réponse (sans enjeu : on peut recommencer immédiatement)
      cardEl?.classList.add("card-wrong");
      if (cueEl) cueEl.textContent = "Pas tout à fait, réessaie ou demande la réponse !";
      audioService.playFeedback("wrong");

      // Rétrogradation dans la file de révision
      engine.registerResult(currentItem, "practice", false, responseTimeMs);

      setTimeout(() => {
        cardEl?.classList.remove("card-wrong");
        currentInput = "";
        keypad?.clear();
        if (inputEl) inputEl.textContent = "_";
      }, 700);
    }
  }

  async function revealAnswer() {
    if (!currentItem || !containerEl) return;
    const responseTimeMs = questionStartTime > 0 ? Math.round(performance.now() - questionStartTime) : 0;
    hasUsedHelpForCurrent = true;
    keypad?.setEnabled(false);

    const inputEl = containerEl.querySelector("#prac-input");
    const cueEl = containerEl.querySelector("#prac-cue");
    const cardEl = containerEl.querySelector("#prac-card");

    if (inputEl) {
      inputEl.textContent = currentItem.result.toString();
      inputEl.classList.add("revealed");
    }
    if (cardEl) cardEl.classList.add("card-hint");
    if (cueEl) cueEl.textContent = `La réponse est ${currentItem.result}`;

    await audioService.playAnswer(currentItem.result);
    // Enregistré comme faux pour être révisé dans le pool
    engine.registerResult(currentItem, "practice", false, responseTimeMs);

    await new Promise((r) => setTimeout(r, 1400));
    if (isRunning) nextQuestion();
  }

  return {
    start(container: HTMLElement, onFinished: () => void) {
      isRunning = true;
      containerEl = renderView();
      container.appendChild(containerEl);

      // Monter le Keypad
      const keypadMount = containerEl.querySelector("#prac-keypad") as HTMLElement;
      keypad = createKeypad({
        onSubmit: (value) => checkAnswer(value),
        onInput: (_digit, fullVal) => {
          currentInput = fullVal;
          const inputEl = containerEl?.querySelector("#prac-input");
          if (inputEl) inputEl.textContent = currentInput;
        },
        onDelete: (fullVal) => {
          currentInput = fullVal;
          const inputEl = containerEl?.querySelector("#prac-input");
          if (inputEl) inputEl.textContent = currentInput.length > 0 ? currentInput : "_";
        }
      });
      keypad.mount(keypadMount);

      // Bouton Donner la réponse
      containerEl.querySelector("#btn-show-answer")?.addEventListener("click", () => {
        revealAnswer();
      });

      // Répéter l'audio
      containerEl.querySelector("#btn-audio-repeat")?.addEventListener("click", () => {
        if (currentItem) audioService.playQuestion(currentItem.a, currentItem.b);
      });

      // Quitter
      containerEl.querySelector("#btn-quit-prac")?.addEventListener("click", () => {
        this.stop();
        onFinished();
      });

      // Minuterie stricte des N minutes
      timer = createSessionTimer(
        config.durationMinutes,
        (_remaining, formatted) => {
          const tEl = containerEl?.querySelector("#prac-timer");
          const pEl = containerEl?.querySelector("#prac-progress") as HTMLElement;
          if (tEl) tEl.textContent = formatted;
          if (pEl && timer) pEl.style.width = `${timer.getProgressPercent()}%`;
        },
        () => {
          this.stop();
          audioService.playFeedback("finish");
          onFinished();
        }
      );

      timer.start();
      nextQuestion();
    },

    stop() {
      isRunning = false;
      timer?.stop();
      timer = null;
      keypad?.destroy();
      keypad = null;
      audioService.stop();
      containerEl?.remove();
      containerEl = null;
    }
  };
}

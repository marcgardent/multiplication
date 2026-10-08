import { MatrixStore } from "../core/matrixStore";
import { AudioService } from "../services/audioService";
import { KeypadComponent, createKeypad } from "../components/keypad";
import { MultiplicationItem } from "../types";

export interface EvaluationResult {
  total: number;
  correct: number;
  wrongItems: MultiplicationItem[];
  avgTimeMs: number;
  times: number[];
  actualPracticeTimeMs: number;
}

export function startEvaluationModal(
  selectedTables: number[],
  matrixStore: MatrixStore,
  audioService: AudioService,
  onComplete: (result: EvaluationResult) => void,
  onCancel: (actualPracticeTimeMs: number) => void
): void {
  // 1. Rassembler toutes les multiplications pour les tables sélectionnées
  const pool: MultiplicationItem[] = [];
  selectedTables.forEach((tableNum) => {
    for (let b = 1; b <= 10; b++) {
      const item = matrixStore.getByFactors(tableNum, b);
      if (item) pool.push(item);
    }
  });

  // Mélanger le pool aléatoirement
  pool.sort(() => Math.random() - 0.5);

  let currentIndex = 0;
  let correctCount = 0;
  let isRunning = true;
  let isPaused = false;
  const wrongItems: MultiplicationItem[] = [];
  const times: number[] = [];
  let questionStartTime = 0;
  let currentInput = "";
  let keypad: KeypadComponent | null = null;

  // Création du container de modale
  const modalEl = document.createElement("div");
  modalEl.className = "session-modal-overlay";

  modalEl.innerHTML = `
    <div class="session-modal-container workshop-active-modal mode-screen">
      <div class="session-modal-header">
        <div class="workshop-title">
          <span class="workshop-tag tag-eval">📝 Évaluation</span>
          <span class="workshop-name">Tables : ${selectedTables.join(", ")}</span>
        </div>
        <div class="header-controls-group">
          <div class="step-indicator" id="eval-progress-text">${currentIndex + 1}/${pool.length}</div>
          <button type="button" class="btn-session-pause" id="btn-pause-eval" aria-label="Pause ou Reprendre">⏸️</button>
          <button type="button" class="btn-modal-close" id="btn-cancel-eval" aria-label="Fermer">✕</button>
        </div>
      </div>

      <div class="progress-bar-container">
        <div class="progress-bar-fill" id="eval-progress-bar" style="width: 0%;"></div>
      </div>

      <!-- Zone Scène Question (MOITIÉ SUPÉRIEURE DE L'ÉCRAN) -->
      <div class="question-stage giant-stage giant-operation-zone">
        <div class="stage-card giant-card" id="eval-card">
          <span class="stage-factors giant-factors" id="eval-factors">...</span>
          <span class="stage-equals giant-equals">=</span>
          <span class="stage-answer giant-answer user-answer" id="eval-input">_</span>
        </div>
        <div class="feedback-cue" id="eval-cue">Calculez et entrez le résultat</div>
      </div>

      <!-- Emplacement Keypad (MOITIÉ INFÉRIEURE DE L'ÉCRAN) -->
      <div class="keypad-mount-point giant-keypad-mount giant-keypad-zone" id="eval-keypad"></div>
    </div>
  `;

  document.body.appendChild(modalEl);

  const evalStartTime = performance.now();

  function fitOperation(cardEl: Element | null) {
    if (!cardEl) return;
    const htmlCard = cardEl as HTMLElement;
    const factorsEl = cardEl.querySelector(".giant-factors") as HTMLElement | null;
    const equalsEl = cardEl.querySelector(".giant-equals") as HTMLElement | null;
    const answerEl = cardEl.querySelector(".giant-answer") as HTMLElement | null;
    if (!factorsEl || !answerEl) return;

    factorsEl.style.fontSize = "";
    if (equalsEl) equalsEl.style.fontSize = "";
    answerEl.style.fontSize = "";

    if (htmlCard.scrollWidth > htmlCard.clientWidth && htmlCard.clientWidth > 0) {
      const ratio = htmlCard.clientWidth / htmlCard.scrollWidth;
      const computed = parseFloat(window.getComputedStyle(factorsEl).fontSize);
      const safeSize = Math.max(16, Math.floor(computed * ratio * 0.94));
      factorsEl.style.fontSize = `${safeSize}px`;
      answerEl.style.fontSize = `${safeSize}px`;
      if (equalsEl) {
        equalsEl.style.fontSize = `${Math.max(14, Math.floor(safeSize * 0.85))}px`;
      }
    }
  }

  const handleResize = () => {
    const cardEl = modalEl.querySelector("#eval-card") as HTMLElement | null;
    fitOperation(cardEl);
  };
  window.addEventListener("resize", handleResize);

  function cleanUp() {
    window.removeEventListener("resize", handleResize);
    isRunning = false;
    isPaused = false;
    keypad?.destroy();
    keypad = null;
    audioService.stop();
    modalEl.remove();
  }

  // --- GESTION DE LA PAUSE ---
  function pauseEval() {
    if (isPaused || !isRunning) return;
    isPaused = true;
    audioService.stop();
    keypad?.setEnabled(false);

    const pauseBtn = modalEl.querySelector("#btn-pause-eval");
    if (pauseBtn) {
      pauseBtn.textContent = "▶️";
      pauseBtn.setAttribute("aria-label", "Reprendre la session");
      pauseBtn.classList.add("is-paused");
    }

    let pauseOverlay = modalEl.querySelector("#eval-pause-overlay");
    if (!pauseOverlay) {
      pauseOverlay = document.createElement("div");
      pauseOverlay.className = "session-pause-overlay";
      pauseOverlay.id = "eval-pause-overlay";
      pauseOverlay.innerHTML = `
        <div class="pause-card">
          <div class="pause-icon">⏸️</div>
          <h3>Évaluation en pause</h3>
          <p>Prends ton temps pour te reposer.</p>
          <div class="quit-confirm-buttons" style="width: 100%;">
            <button type="button" class="btn-confirm-launch btn-resume-action" id="btn-resume-eval">
              Reprendre l'évaluation ▶️
            </button>
            <button type="button" class="btn-confirm-launch" id="btn-pause-finish-eval" style="background: linear-gradient(135deg, #10b981, #06b6d4);">
              Terminer et voir mon bilan 📊
            </button>
          </div>
        </div>
      `;
      const container = modalEl.querySelector(".session-modal-container");
      container?.appendChild(pauseOverlay);

      pauseOverlay.querySelector("#btn-resume-eval")?.addEventListener("click", () => {
        resumeEval();
      });

      pauseOverlay.querySelector("#btn-pause-finish-eval")?.addEventListener("click", () => {
        const elapsed = Math.round(performance.now() - evalStartTime);
        cleanUp();
        const avgTime = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
        onComplete({
          total: Math.max(1, currentIndex),
          correct: correctCount,
          wrongItems,
          avgTimeMs: avgTime,
          times,
          actualPracticeTimeMs: elapsed
        });
      });
    }
  }

  function resumeEval() {
    if (!isPaused || !isRunning) return;
    isPaused = false;
    modalEl.querySelector("#eval-pause-overlay")?.remove();
    keypad?.setEnabled(true);

    const pauseBtn = modalEl.querySelector("#btn-pause-eval");
    if (pauseBtn) {
      pauseBtn.textContent = "⏸️";
      pauseBtn.setAttribute("aria-label", "Mettre en pause");
      pauseBtn.classList.remove("is-paused");
    }

    const currentItem = pool[currentIndex];
    if (currentItem) {
      audioService.playQuestion(currentItem.a, currentItem.b);
    }
  }

  function togglePause() {
    if (isPaused) {
      resumeEval();
    } else {
      pauseEval();
    }
  }

  // --- CONFIRMATION AVANT DE QUITTER ---
  function requestQuitConfirmation() {
    const wasPausedBefore = isPaused;
    if (!wasPausedBefore) {
      pauseEval();
    }

    const confirmOverlay = document.createElement("div");
    confirmOverlay.className = "session-modal-overlay quit-confirm-overlay";
    confirmOverlay.innerHTML = `
      <div class="session-modal-container quit-confirm-modal">
        <div class="quit-confirm-icon">⚠️</div>
        <h3>Terminer ou quitter ?</h3>
        <p>Tu peux terminer dès maintenant pour valider tes calculs et tes points, ou continuer l'exercice.</p>
        <div class="quit-confirm-buttons">
          <button type="button" class="btn-confirm-launch btn-continue-action" id="btn-confirm-stay-eval">
            Continuer l'évaluation 🚀
          </button>
          <button type="button" class="btn-confirm-launch" id="btn-confirm-finish-eval" style="background: linear-gradient(135deg, #10b981, #06b6d4);">
            Terminer et voir mon bilan 📊
          </button>
          <button type="button" class="btn-quit-danger" id="btn-confirm-quit-eval">
            Quitter la session
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(confirmOverlay);

    confirmOverlay.querySelector("#btn-confirm-stay-eval")?.addEventListener("click", () => {
      confirmOverlay.remove();
      if (!wasPausedBefore) {
        resumeEval();
      }
    });

    confirmOverlay.querySelector("#btn-confirm-finish-eval")?.addEventListener("click", () => {
      confirmOverlay.remove();
      const elapsed = Math.round(performance.now() - evalStartTime);
      cleanUp();
      const avgTime = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
      onComplete({
        total: Math.max(1, currentIndex),
        correct: correctCount,
        wrongItems,
        avgTimeMs: avgTime,
        times,
        actualPracticeTimeMs: elapsed
      });
    });

    confirmOverlay.querySelector("#btn-confirm-quit-eval")?.addEventListener("click", () => {
      confirmOverlay.remove();
      const elapsed = Math.round(performance.now() - evalStartTime);
      cleanUp();
      onCancel(elapsed);
    });
  }

  modalEl.querySelector("#btn-pause-eval")?.addEventListener("click", () => {
    togglePause();
  });

  modalEl.querySelector("#btn-cancel-eval")?.addEventListener("click", () => {
    requestQuitConfirmation();
  });

  const keypadMount = modalEl.querySelector("#eval-keypad") as HTMLElement;
  keypad = createKeypad({
    showHelpButton: false,
    onInput: (_digit, fullVal) => {
      if (isPaused || !isRunning) return;
      currentInput = fullVal;
      const inputEl = modalEl.querySelector("#eval-input");
      if (inputEl) inputEl.textContent = currentInput;
      fitOperation(modalEl.querySelector("#eval-card"));

      const currentItem = pool[currentIndex];
      if (currentItem && currentInput.length >= currentItem.result.toString().length) {
        checkCurrentAnswer(currentInput);
      }
    },
    onDelete: (fullVal) => {
      if (isPaused || !isRunning) return;
      currentInput = fullVal;
      const inputEl = modalEl.querySelector("#eval-input");
      if (inputEl) inputEl.textContent = currentInput.length > 0 ? currentInput : "_";
      fitOperation(modalEl.querySelector("#eval-card"));
    }
  });
  keypad.mount(keypadMount);

  function showQuestion() {
    if (!isRunning) return;
    if (currentIndex >= pool.length) {
      // Fin de l'évaluation
      const elapsed = Math.round(performance.now() - evalStartTime);
      cleanUp();
      const avgTime = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0;
      onComplete({
        total: pool.length,
        correct: correctCount,
        wrongItems,
        avgTimeMs: avgTime,
        times,
        actualPracticeTimeMs: elapsed
      });
      return;
    }

    const item = pool[currentIndex];
    currentInput = "";
    keypad?.clear();
    keypad?.setEnabled(!isPaused);

    const factorsEl = modalEl.querySelector("#eval-factors");
    const inputEl = modalEl.querySelector("#eval-input");
    const cueEl = modalEl.querySelector("#eval-cue");
    const cardEl = modalEl.querySelector("#eval-card");
    const progressText = modalEl.querySelector("#eval-progress-text");
    const progressBar = modalEl.querySelector("#eval-progress-bar") as HTMLElement;

    if (factorsEl) factorsEl.textContent = `${item.a} × ${item.b}`;
    if (inputEl) inputEl.textContent = "_";
    if (cueEl) cueEl.textContent = "Calculez et entrez le résultat";
    if (cardEl) cardEl.className = "stage-card giant-card";
    fitOperation(cardEl);
    if (progressText) progressText.textContent = `${currentIndex + 1}/${pool.length}`;
    if (progressBar) progressBar.style.width = `${Math.round((currentIndex / pool.length) * 100)}%`;

    questionStartTime = performance.now();
    audioService.playQuestion(item.a, item.b);
  }

  async function checkCurrentAnswer(valStr: string) {
    if (!isRunning || isPaused) return;
    const item = pool[currentIndex];
    const val = parseInt(valStr, 10);
    const timeMs = Math.round(performance.now() - questionStartTime);
    times.push(timeMs);

    const isCorrect = val === item.result;
    keypad?.setEnabled(false);

    const cardEl = modalEl.querySelector("#eval-card");
    const cueEl = modalEl.querySelector("#eval-cue");

    if (isCorrect) {
      correctCount++;
      cardEl?.classList.add("card-correct");
      if (cueEl) cueEl.textContent = `Correct ! ${(timeMs / 1000).toFixed(2)}s ⚡`;
      audioService.playFeedback("correct");
    } else {
      wrongItems.push(item);
      cardEl?.classList.add("card-wrong");
      if (cueEl) cueEl.textContent = `Faux : ${item.a} × ${item.b} = ${item.result}`;
      audioService.playFeedback("wrong");
    }

    // Enregistrer les statistiques dans le store
    matrixStore.recordAttempt(item.a, item.b, "evaluation", isCorrect, timeMs);

    currentIndex++;
    await new Promise((r) => setTimeout(r, 650));
    if (isRunning) {
      showQuestion();
    }
  }

  showQuestion();
}

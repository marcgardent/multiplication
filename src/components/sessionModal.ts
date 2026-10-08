import { RepetitionEngine } from "../core/repetitionEngine";
import { AudioService } from "../services/audioService";
import { SessionTimer, createSessionTimer } from "../components/timer";
import { KeypadComponent, createKeypad } from "../components/keypad";
import { SessionConfig, MultiplicationItem } from "../types";

export interface SessionResult {
  completedWorkshops: number;
  totalTimeMinutes: number;
  actualPracticeTimeMs: number;
}

export function startSessionModal(
  engine: RepetitionEngine,
  audioService: AudioService,
  config: SessionConfig,
  onFinish: (result: SessionResult) => void,
  onCancel: (actualPracticeTimeMs: number) => void
): void {
  // Découper la session globale de N minutes en 3 ateliers équilibrés
  // Atelier 1: Découverte (1/3 du temps)
  // Atelier 2: Quiz sans enjeu (1/3 du temps)
  // Atelier 3: Time-Attack (1/3 du temps)
  const workshopMinutes = config.durationMinutes / 3;

  let currentWorkshopIndex = 0; // 0 = Découverte, 1 = Quiz, 2 = Time-Attack
  let isRunning = true;
  let isPaused = false;
  let timer: SessionTimer | null = null;
  let keypad: KeypadComponent | null = null;
  let currentItem: MultiplicationItem | null = null;
  let questionStartTime = 0;
  let currentInput = "";
  let hasUsedHelp = false;

  const modalEl = document.createElement("div");
  modalEl.className = "session-modal-overlay";

  function getWorkshopInfo(idx: number) {
    switch (idx) {
      case 0:
        return { num: 1, name: "Découverte & Écoute", tag: "Atelier 1/3", class: "tag-disc" };
      case 1:
        return { num: 2, name: "Quiz Sans Enjeu", tag: "Atelier 2/3", class: "tag-prac" };
      case 2:
      default:
        return { num: 3, name: "Time-Attack Défis", tag: "Atelier 3/3", class: "tag-ta" };
    }
  }

  function renderModalLayout(): HTMLElement {
    const info = getWorkshopInfo(currentWorkshopIndex);
    modalEl.innerHTML = `
      <div class="session-modal-container workshop-active-modal mode-screen">
        <div class="session-modal-header">
          <div class="workshop-title">
            <span class="workshop-tag ${info.class}">${info.tag}</span>
            <span class="workshop-name">${info.name}</span>
          </div>
          <div class="header-controls-group">
            <div class="timer-display" id="modal-timer">--:--</div>
            <button type="button" class="btn-session-pause ${isPaused ? "is-paused" : ""}" id="btn-pause-session" aria-label="Pause ou Reprendre">
              ${isPaused ? "▶️" : "⏸️"}
            </button>
            <button type="button" class="btn-modal-close" id="btn-close-session" aria-label="Quitter la session">✕</button>
          </div>
        </div>

        <div class="session-tabs-indicator">
          <div class="step-pill ${currentWorkshopIndex === 0 ? "active" : currentWorkshopIndex > 0 ? "done" : ""}">1. Découverte</div>
          <div class="step-pill ${currentWorkshopIndex === 1 ? "active" : currentWorkshopIndex > 1 ? "done" : ""}">2. Quiz</div>
          <div class="step-pill ${currentWorkshopIndex === 2 ? "active" : ""}">3. Time-Attack</div>
        </div>

        <div class="progress-bar-container">
          <div class="progress-bar-fill" id="modal-progress-bar" style="width: 0%;"></div>
        </div>

        <!-- Zone Scène Question (MOITIÉ SUPÉRIEURE DE L'ÉCRAN) -->
        <div class="question-stage giant-stage giant-operation-zone">
          <div class="stage-card giant-card" id="modal-card">
            <span class="stage-factors giant-factors" id="modal-factors">...</span>
            <span class="stage-equals giant-equals">=</span>
            <span class="stage-answer giant-answer" id="modal-answer">?</span>
          </div>
          <div class="feedback-cue" id="modal-cue">Préparez-vous...</div>
        </div>

        <!-- Barre d'aide (Atelier 2 uniquement) -->
        <div class="action-bar-secondary" id="modal-practice-actions" style="display: none;">
          <button type="button" class="btn-help-inline" id="btn-modal-help">💡 Donner la réponse</button>
          <button type="button" class="btn-repeat-audio" id="btn-modal-repeat" aria-label="Répéter la question">🔊</button>
        </div>

        <!-- Emplacement Keypad (MOITIÉ INFÉRIEURE DE L'ÉCRAN) -->
        <div class="keypad-mount-point giant-keypad-mount giant-keypad-zone" id="modal-keypad-mount"></div>
      </div>
    `;

    // Attacher les écouteurs de Pause et Quitter
    modalEl.querySelector("#btn-pause-session")?.addEventListener("click", () => {
      togglePause();
    });

    modalEl.querySelector("#btn-close-session")?.addEventListener("click", () => {
      requestQuitConfirmation();
    });

    return modalEl;
  }

  document.body.appendChild(renderModalLayout());

  const sessionStartTime = performance.now();

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
    const cardEl = modalEl.querySelector("#modal-card") as HTMLElement | null;
    fitOperation(cardEl);
  };
  window.addEventListener("resize", handleResize);

  function cleanUp() {
    window.removeEventListener("resize", handleResize);
    isRunning = false;
    isPaused = false;
    timer?.stop();
    timer = null;
    keypad?.destroy();
    keypad = null;
    audioService.stop();
    modalEl.remove();
  }

  // --- GESTION DE LA PAUSE ---
  function pauseSession() {
    if (isPaused || !isRunning) return;
    isPaused = true;
    timer?.pause();
    audioService.stop();
    keypad?.setEnabled(false);

    const pauseBtn = modalEl.querySelector("#btn-pause-session");
    if (pauseBtn) {
      pauseBtn.textContent = "▶️";
      pauseBtn.setAttribute("aria-label", "Reprendre la session");
      pauseBtn.classList.add("is-paused");
    }

    let pauseOverlay = modalEl.querySelector("#session-pause-overlay");
    if (!pauseOverlay) {
      pauseOverlay = document.createElement("div");
      pauseOverlay.className = "session-pause-overlay";
      pauseOverlay.id = "session-pause-overlay";
      pauseOverlay.innerHTML = `
        <div class="pause-card">
          <div class="pause-icon">⏸️</div>
          <h3>Session en pause</h3>
          <p>Prends ton temps, le chronomètre est arrêté.</p>
          <button type="button" class="btn-confirm-launch btn-resume-action" id="btn-resume-session">
            Reprendre l'entraînement ▶️
          </button>
        </div>
      `;
      const container = modalEl.querySelector(".session-modal-container");
      container?.appendChild(pauseOverlay);

      pauseOverlay.querySelector("#btn-resume-session")?.addEventListener("click", () => {
        resumeSession();
      });
    }
  }

  function resumeSession() {
    if (!isPaused || !isRunning) return;
    isPaused = false;
    modalEl.querySelector("#session-pause-overlay")?.remove();
    timer?.resume();
    keypad?.setEnabled(true);

    const pauseBtn = modalEl.querySelector("#btn-pause-session");
    if (pauseBtn) {
      pauseBtn.textContent = "⏸️";
      pauseBtn.setAttribute("aria-label", "Mettre en pause");
      pauseBtn.classList.remove("is-paused");
    }

    if (currentItem && (currentWorkshopIndex === 1 || currentWorkshopIndex === 2)) {
      audioService.playQuestion(currentItem.a, currentItem.b);
    }
  }

  function togglePause() {
    if (isPaused) {
      resumeSession();
    } else {
      pauseSession();
    }
  }

  // --- CONFIRMATION AVANT DE QUITTER ---
  function requestQuitConfirmation() {
    const wasPausedBefore = isPaused;
    if (!wasPausedBefore) {
      pauseSession();
    }

    const confirmOverlay = document.createElement("div");
    confirmOverlay.className = "session-modal-overlay quit-confirm-overlay";
    confirmOverlay.innerHTML = `
      <div class="session-modal-container quit-confirm-modal">
        <div class="quit-confirm-icon">⚠️</div>
        <h3>Quitter l'entraînement ?</h3>
        <p>Veux-tu vraiment quitter ? Ton temps déjà passé sera bien enregistré dans ton carnet.</p>
        <div class="quit-confirm-buttons">
          <button type="button" class="btn-confirm-launch btn-continue-action" id="btn-confirm-stay">
            Continuer l'activité 🚀
          </button>
          <button type="button" class="btn-quit-danger" id="btn-confirm-quit">
            Quitter la session
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(confirmOverlay);

    confirmOverlay.querySelector("#btn-confirm-stay")?.addEventListener("click", () => {
      confirmOverlay.remove();
      if (!wasPausedBefore) {
        resumeSession();
      }
    });

    confirmOverlay.querySelector("#btn-confirm-quit")?.addEventListener("click", () => {
      confirmOverlay.remove();
      const elapsedMs = Math.round(performance.now() - sessionStartTime);
      cleanUp();
      onCancel(elapsedMs);
    });
  }

  async function waitWithPauseCheck(durationMs: number): Promise<boolean> {
    const start = performance.now();
    while (performance.now() - start < durationMs) {
      if (!isRunning) return false;
      while (isPaused) {
        if (!isRunning) return false;
        await new Promise((r) => setTimeout(r, 100));
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    return isRunning;
  }

  function startWorkshop(idx: number) {
    if (!isRunning) return;
    currentWorkshopIndex = idx;
    renderModalLayout();

    const info = getWorkshopInfo(idx);
    const cueEl = modalEl.querySelector("#modal-cue");
    if (cueEl) cueEl.textContent = `Bienvenue dans l'${info.tag} : ${info.name}`;

    // Configurer le timer pour cet atelier
    timer = createSessionTimer(
      workshopMinutes,
      (_rem, formatted) => {
        const tEl = modalEl.querySelector("#modal-timer");
        const pEl = modalEl.querySelector("#modal-progress-bar") as HTMLElement;
        if (tEl) tEl.textContent = formatted;
        if (pEl && timer) pEl.style.width = `${timer.getProgressPercent()}%`;
      },
      () => {
        // Fin de l'atelier courant
        audioService.playFeedback("finish");
        if (currentWorkshopIndex < 2) {
          showActivityTransitionSplash(currentWorkshopIndex + 1);
        } else {
          // Fin de la session complète (les 3 ateliers sont terminés)
          const elapsedMs = Math.round(performance.now() - sessionStartTime);
          cleanUp();
          onFinish({
            completedWorkshops: 3,
            totalTimeMinutes: config.durationMinutes,
            actualPracticeTimeMs: elapsedMs
          });
        }
      }
    );

    timer.start();

    // Lancer la mécanique correspondante
    if (idx === 0) {
      runDiscoveryStep();
    } else if (idx === 1) {
      setupPracticeWorkshop();
    } else {
      setupTimeAttackWorkshop();
    }
  }

  // Splashscreen animé plein écran lors du changement d'activité / atelier
  function showActivityTransitionSplash(nextIdx: number) {
    const nextInfo = getWorkshopInfo(nextIdx);
    keypad?.setEnabled(false);
    audioService.playFeedback("finish");

    const splashOverlay = document.createElement("div");
    splashOverlay.className = "session-modal-overlay activity-transition-overlay";

    let stepTitle = "";
    let stepDescription = "";
    let buttonLabel = "";
    let iconEmoji = "";

    if (nextIdx === 1) {
      stepTitle = "Bravo ! Étape 1 validée !";
      stepDescription = "Place au Quiz ! Écoute le calcul et tape la bonne réponse au clavier !";
      buttonLabel = "C'est parti pour le Quiz ! 🚀";
      iconEmoji = "🎯";
    } else {
      stepTitle = "Génial ! Étape 2 réussie !";
      stepDescription = "Place au Défi Chrono ! Sois le plus rapide avant la fin du chronomètre !";
      buttonLabel = "Je suis prêt pour le Défi Chrono ! ⚡";
      iconEmoji = "⚡";
    }

    splashOverlay.innerHTML = `
      <div class="session-modal-container activity-transition-card">
        <div class="transition-fireworks">🎉 🌟 ✨</div>
        <div class="transition-badge-tag ${nextInfo.class}">${nextInfo.tag}</div>
        <div class="transition-huge-icon">${iconEmoji}</div>
        <h2 class="transition-title">${stepTitle}</h2>
        <p class="transition-subtitle">${stepDescription}</p>
        <button type="button" class="btn-confirm-launch btn-start-next-workshop" id="btn-start-next-step">
          ${buttonLabel}
        </button>
      </div>
    `;

    document.body.appendChild(splashOverlay);

    let isClosed = false;
    const proceedToNext = () => {
      if (isClosed) return;
      isClosed = true;
      splashOverlay.remove();
      if (isRunning) {
        startWorkshop(nextIdx);
      }
    };

    splashOverlay.querySelector("#btn-start-next-step")?.addEventListener("click", proceedToNext);

    // Auto-démarrage après 4.5 secondes si pas de clic
    setTimeout(() => {
      proceedToNext();
    }, 4500);
  }

  // --- ATELIER 1 : DÉCOUVERTE ---
  async function runDiscoveryStep() {
    if (!isRunning || currentWorkshopIndex !== 0) return;
    while (isPaused) {
      if (!isRunning) return;
      await new Promise((r) => setTimeout(r, 100));
    }

    currentItem = engine.getNextQuestion();

    const factorsEl = modalEl.querySelector("#modal-factors");
    const answerEl = modalEl.querySelector("#modal-answer");
    const cueEl = modalEl.querySelector("#modal-cue");

    if (factorsEl) factorsEl.textContent = `${currentItem.a} × ${currentItem.b}`;
    if (answerEl) {
      answerEl.textContent = "?";
      answerEl.className = "stage-answer giant-answer";
    }
    fitOperation(modalEl.querySelector("#modal-card"));
    if (cueEl) cueEl.textContent = `Question : ${currentItem.a} fois ${currentItem.b}...`;

    await audioService.playQuestion(currentItem.a, currentItem.b);
    if (!isRunning || currentWorkshopIndex !== 0) return;

    if (cueEl) cueEl.textContent = "Réfléchissez au résultat...";
    const ok1 = await waitWithPauseCheck(config.pauseBetweenAudioMs);
    if (!ok1 || currentWorkshopIndex !== 0) return;

    if (answerEl) {
      answerEl.textContent = currentItem.result.toString();
      answerEl.classList.add("revealed");
    }
    fitOperation(modalEl.querySelector("#modal-card"));
    if (cueEl) cueEl.textContent = `Réponse : ${currentItem.result} !`;

    await audioService.playAnswer(currentItem.result);
    if (!isRunning || currentWorkshopIndex !== 0) return;

    engine.registerResult(currentItem, "discovery", true, 0);

    const ok2 = await waitWithPauseCheck(1100);
    if (ok2 && currentWorkshopIndex === 0) {
      runDiscoveryStep();
    }
  }

  // --- ATELIER 2 : QUIZ SANS ENJEU ---
  function setupPracticeWorkshop() {
    const actionsEl = modalEl.querySelector("#modal-practice-actions") as HTMLElement;
    if (actionsEl) actionsEl.style.display = "flex";

    const keypadMount = modalEl.querySelector("#modal-keypad-mount") as HTMLElement;
    keypad = createKeypad({
      showHelpButton: false,
      onInput: (_d, fullVal) => {
        if (isPaused) return;
        currentInput = fullVal;
        const ansEl = modalEl.querySelector("#modal-answer");
        if (ansEl) ansEl.textContent = currentInput;
        fitOperation(modalEl.querySelector("#modal-card"));

        if (currentItem && currentInput.length >= currentItem.result.toString().length) {
          checkPracticeAnswer(currentInput);
        }
      },
      onDelete: (fullVal) => {
        if (isPaused) return;
        currentInput = fullVal;
        const ansEl = modalEl.querySelector("#modal-answer");
        if (ansEl) ansEl.textContent = currentInput.length > 0 ? currentInput : "_";
        fitOperation(modalEl.querySelector("#modal-card"));
      }
    });
    keypad.mount(keypadMount);

    modalEl.querySelector("#btn-modal-help")?.addEventListener("click", revealPracticeAnswer);
    modalEl.querySelector("#btn-modal-repeat")?.addEventListener("click", () => {
      if (currentItem && !isPaused) audioService.playQuestion(currentItem.a, currentItem.b);
    });

    nextPracticeQuestion();
  }

  function nextPracticeQuestion() {
    if (!isRunning || currentWorkshopIndex !== 1) return;
    currentItem = engine.getNextQuestion();
    currentInput = "";
    hasUsedHelp = false;
    keypad?.clear();
    keypad?.setEnabled(!isPaused);

    const factorsEl = modalEl.querySelector("#modal-factors");
    const answerEl = modalEl.querySelector("#modal-answer");
    const cueEl = modalEl.querySelector("#modal-cue");
    const cardEl = modalEl.querySelector("#modal-card");

    if (factorsEl) factorsEl.textContent = `${currentItem.a} × ${currentItem.b}`;
    if (answerEl) {
      answerEl.textContent = "_";
      answerEl.className = "stage-answer giant-answer user-answer";
    }
    if (cueEl) cueEl.textContent = "Prenez votre temps pour taper la réponse...";
    if (cardEl) cardEl.className = "stage-card giant-card";
    fitOperation(cardEl);

    questionStartTime = performance.now();
    audioService.playQuestion(currentItem.a, currentItem.b);
  }

  async function checkPracticeAnswer(valStr: string) {
    if (!currentItem || isPaused) return;
    const val = parseInt(valStr, 10);
    const timeMs = questionStartTime > 0 ? Math.round(performance.now() - questionStartTime) : 0;
    const cardEl = modalEl.querySelector("#modal-card");
    const cueEl = modalEl.querySelector("#modal-cue");
    const inputEl = modalEl.querySelector("#modal-answer");

    if (val === currentItem.result) {
      keypad?.setEnabled(false);
      cardEl?.classList.add("card-correct");
      if (cueEl) cueEl.textContent = "Exact ! Bien joué ! 🎉";
      audioService.playFeedback("correct");

      engine.registerResult(currentItem, "practice", !hasUsedHelp, timeMs);

      await new Promise((r) => setTimeout(r, 800));
      if (isRunning && currentWorkshopIndex === 1) nextPracticeQuestion();
    } else {
      cardEl?.classList.add("card-wrong");
      if (cueEl) cueEl.textContent = "Pas tout à fait, réessayez ou demandez l'aide !";
      audioService.playFeedback("wrong");

      engine.registerResult(currentItem, "practice", false, timeMs);

      setTimeout(() => {
        cardEl?.classList.remove("card-wrong");
        currentInput = "";
        keypad?.clear();
        if (inputEl) inputEl.textContent = "_";
      }, 700);
    }
  }

  async function revealPracticeAnswer() {
    if (!currentItem || isPaused) return;
    hasUsedHelp = true;
    keypad?.setEnabled(false);

    const answerEl = modalEl.querySelector("#modal-answer");
    const cueEl = modalEl.querySelector("#modal-cue");
    const cardEl = modalEl.querySelector("#modal-card");

    if (answerEl) {
      answerEl.textContent = currentItem.result.toString();
      answerEl.classList.add("revealed");
    }
    fitOperation(modalEl.querySelector("#modal-card"));
    if (cardEl) cardEl.classList.add("card-hint");
    if (cueEl) cueEl.textContent = `La réponse est ${currentItem.result}`;

    await audioService.playAnswer(currentItem.result);
    engine.registerResult(currentItem, "practice", false, 0);

    await new Promise((r) => setTimeout(r, 1200));
    if (isRunning && currentWorkshopIndex === 1) nextPracticeQuestion();
  }

  // --- ATELIER 3 : TIME-ATTACK ---
  function setupTimeAttackWorkshop() {
    const keypadMount = modalEl.querySelector("#modal-keypad-mount") as HTMLElement;
    keypad = createKeypad({
      showHelpButton: false,
      onInput: (_d, fullVal) => {
        if (isPaused) return;
        currentInput = fullVal;
        const ansEl = modalEl.querySelector("#modal-answer");
        if (ansEl) ansEl.textContent = currentInput;
        fitOperation(modalEl.querySelector("#modal-card"));

        if (currentItem && currentInput.length >= currentItem.result.toString().length) {
          checkTimeAttackAnswer(currentInput);
        }
      },
      onDelete: (fullVal) => {
        if (isPaused) return;
        currentInput = fullVal;
        const ansEl = modalEl.querySelector("#modal-answer");
        if (ansEl) ansEl.textContent = currentInput.length > 0 ? currentInput : "_";
        fitOperation(modalEl.querySelector("#modal-card"));
      }
    });
    keypad.mount(keypadMount);

    nextTimeAttackQuestion();
  }

  function nextTimeAttackQuestion() {
    if (!isRunning || currentWorkshopIndex !== 2) return;
    currentItem = engine.getNextQuestion();
    currentInput = "";
    keypad?.clear();
    keypad?.setEnabled(!isPaused);

    const factorsEl = modalEl.querySelector("#modal-factors");
    const answerEl = modalEl.querySelector("#modal-answer");
    const cueEl = modalEl.querySelector("#modal-cue");
    const cardEl = modalEl.querySelector("#modal-card");

    if (factorsEl) factorsEl.textContent = `${currentItem.a} × ${currentItem.b}`;
    if (answerEl) {
      answerEl.textContent = "_";
      answerEl.className = "stage-answer giant-answer user-answer";
    }
    if (cueEl) cueEl.textContent = "⚡ Répondez aussi vite que possible !";
    if (cardEl) cardEl.className = "stage-card giant-card";
    fitOperation(cardEl);

    questionStartTime = performance.now();
    audioService.playQuestion(currentItem.a, currentItem.b);
  }

  async function checkTimeAttackAnswer(valStr: string) {
    if (!currentItem || isPaused) return;
    const timeMs = Math.round(performance.now() - questionStartTime);
    const val = parseInt(valStr, 10);
    const isCorrect = val === currentItem.result;

    keypad?.setEnabled(false);
    const cardEl = modalEl.querySelector("#modal-card");
    const cueEl = modalEl.querySelector("#modal-cue");

    if (isCorrect) {
      cardEl?.classList.add("card-correct");
      if (cueEl) cueEl.textContent = `Éclair ! ${(timeMs / 1000).toFixed(2)}s ⚡`;
      audioService.playFeedback("correct");
    } else {
      cardEl?.classList.add("card-wrong");
      if (cueEl) cueEl.textContent = `Erreur : ${currentItem.a} × ${currentItem.b} = ${currentItem.result}`;
      audioService.playFeedback("wrong");
    }

    engine.registerResult(currentItem, "time-attack", isCorrect, timeMs);

    await new Promise((r) => setTimeout(r, 600));
    if (isRunning && currentWorkshopIndex === 2) nextTimeAttackQuestion();
  }

  // Démarrer sur le premier atelier
  startWorkshop(0);
}

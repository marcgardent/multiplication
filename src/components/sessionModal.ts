import { RepetitionEngine } from "../core/repetitionEngine";
import { AudioService } from "../services/audioService";
import { SessionTimer, createSessionTimer } from "../components/timer";
import { KeypadComponent, answerTimeMs, spokenAnswerTimeMs } from "../components/keypad";
import { AnswerPreferencesStore } from "../services/answerPreferences";
import { createAnswerInput } from "./answerInput";
import { answerTogglesHtml, bindAnswerToggles } from "./answerToggles";
import { SessionConfig, MultiplicationItem } from "../types";
import { runCelebration } from "./celebration";

export interface SessionResult {
  completedWorkshops: number;
  totalTimeMinutes: number;
  actualPracticeTimeMs: number;
}

export function startSessionModal(
  engine: RepetitionEngine,
  audioService: AudioService,
  preferences: AnswerPreferencesStore,
  config: SessionConfig,
  onFinish: (result: SessionResult) => void,
  onCancel: (actualPracticeTimeMs: number) => void
): void {
  // Le lot de calculs est figé pour toute la séance
  const sessionLot = engine.startSession();

  // Ateliers : 0 = Découverte, 1 = Quiz sans enjeu, 2 = Time-Attack, à durées égales.
  // Sans nouveau calcul ni erreur à réécouter, la séance commence directement au Quiz
  const workshops = engine.getDiscoveryItems().length > 0 ? [0, 1, 2] : [1, 2];
  const workshopMinutes = config.durationMinutes / workshops.length;
  const workshopLabels = ["Découverte", "Quiz", "Time-Attack"];

  let currentWorkshopIndex = workshops[0];
  let isRunning = true;
  let isPaused = false;
  let timer: SessionTimer | null = null;
  let keypad: KeypadComponent | null = null;
  let currentItem: MultiplicationItem | null = null;
  let questionStartTime = 0;
  let currentInput = "";
  let hasUsedHelp = false;
  let isDiscoveryAudioActive = false;
  let hasDiscoveryWorkshopTimerEnded = false;
  let isCheckingAnswer = false;
  let unbindToggles: (() => void) | null = null;

  const modalEl = document.createElement("div");
  modalEl.className = "session-modal-overlay";

  function renderModalLayout(): HTMLElement {
    modalEl.innerHTML = `
      <div class="session-modal-container workshop-active-modal mode-screen">
        <div class="session-modal-header">
          <div class="timer-display" id="modal-timer">--:--</div>
          <div class="header-controls-group">
            ${answerTogglesHtml()}
            <button type="button" class="btn-session-pause ${isPaused ? "is-paused" : ""}" id="btn-pause-session" aria-label="Pause ou Reprendre">
              ${isPaused ? "▶️" : "⏸️"}
            </button>
            <button type="button" class="btn-modal-close" id="btn-close-session" aria-label="Quitter la session">✕</button>
          </div>
        </div>

        <div class="session-tabs-indicator">
          ${workshops
            .map(
              (w, i) =>
                `<div class="step-pill ${currentWorkshopIndex === w ? "active" : currentWorkshopIndex > w ? "done" : ""}">${i + 1}. ${workshopLabels[w]}</div>`
            )
            .join("")}
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
          <div class="feedback-cue" id="modal-cue">Prépare-toi...</div>
        </div>

        <!-- Barre d'aide (Atelier 2 uniquement) -->
        <div class="action-bar-secondary" id="modal-practice-actions" style="display: none;">
          <button type="button" class="btn-help-inline" id="btn-modal-help">💡 Donner la réponse</button>
          <button type="button" class="btn-repeat-audio" id="btn-modal-repeat" aria-label="Répéter la question">🔊</button>
        </div>

        <!-- Barre du défi chrono (Atelier 3 uniquement) -->
        <div class="action-bar-secondary" id="modal-timeattack-actions" style="display: none;">
          <button type="button" class="btn-help-inline" id="btn-modal-dontknow">🤷 Je ne sais pas</button>
        </div>

        <!-- Emplacement Keypad (MOITIÉ INFÉRIEURE DE L'ÉCRAN) -->
        <div class="keypad-mount-point giant-keypad-mount giant-keypad-zone" id="modal-keypad-mount"></div>
      </div>
    `;

    unbindToggles?.();
    unbindToggles = bindAnswerToggles(modalEl, preferences);

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
    isCheckingAnswer = false;
    timer?.stop();
    timer = null;
    keypad?.destroy();
    keypad = null;
    unbindToggles?.();
    unbindToggles = null;
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
          <div class="pause-lot-preview">
            <div class="pause-lot-title">📋 Au programme de ta séance (${sessionLot.items.length} calculs) :</div>
            <div class="pause-chips-list">
              ${sessionLot.items
                .map((i) => {
                  const isNew = sessionLot.news.some((n) => n.id === i.id);
                  const isReinforce = sessionLot.reinforcements?.some((r) => r.id === i.id);
                  let chipClass = "chip-scheduled";
                  if (isNew) chipClass = "chip-news";
                  else if (isReinforce) chipClass = "chip-reinforce";
                  else if (i.status === "review") chipClass = "chip-review";
                  else if (i.boxLevel === 4) chipClass = "chip-gift";
                  else if (i.boxLevel === 0) chipClass = "chip-listen";

                  return `
                    <span class="queue-item-chip ${chipClass}">
                      <span class="chip-factors">${i.a} × ${i.b}</span>
                    </span>
                  `;
                })
                .join("")}
            </div>
          </div>
          <div class="quit-confirm-buttons" style="width: 100%;">
            <button type="button" class="btn-confirm-launch btn-resume-action" id="btn-resume-session">
              Reprendre l'entraînement ▶️
            </button>
            <button type="button" class="btn-finish-action" id="btn-pause-finish">
              Terminer et voir mon bilan 📊
            </button>
          </div>
        </div>
      `;
      const container = modalEl.querySelector(".session-modal-container");
      container?.appendChild(pauseOverlay);

      pauseOverlay.querySelector("#btn-resume-session")?.addEventListener("click", () => {
        resumeSession();
      });

      pauseOverlay.querySelector("#btn-pause-finish")?.addEventListener("click", () => {
        const elapsedMs = Math.round(performance.now() - sessionStartTime);
        cleanUp();
        onFinish({
          completedWorkshops: currentWorkshopIndex + 1,
          totalTimeMinutes: config.durationMinutes,
          actualPracticeTimeMs: elapsedMs
        });
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

    if (!isCheckingAnswer) {
      keypad?.setEnabled(true);
      if (currentItem && (currentWorkshopIndex === 1 || currentWorkshopIndex === 2)) {
        audioService.playQuestion(currentItem.a, currentItem.b);
      }
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
        <h3>Terminer ou quitter ?</h3>
        <p>Tu peux terminer dès maintenant pour valider tes calculs et tes points, ou continuer l'exercice.</p>
        <div class="quit-confirm-buttons">
          <button type="button" class="btn-confirm-launch btn-continue-action" id="btn-confirm-stay">
            Continuer l'activité 🚀
          </button>
          <button type="button" class="btn-finish-action" id="btn-confirm-finish">
            Terminer et voir mon bilan 📊
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

    confirmOverlay.querySelector("#btn-confirm-finish")?.addEventListener("click", () => {
      confirmOverlay.remove();
      const elapsedMs = Math.round(performance.now() - sessionStartTime);
      cleanUp();
      onFinish({
        completedWorkshops: currentWorkshopIndex + 1,
        totalTimeMinutes: config.durationMinutes,
        actualPracticeTimeMs: elapsedMs
      });
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

  function proceedToNextWorkshop() {
    audioService.stop();
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

  function startWorkshop(idx: number) {
    if (!isRunning) return;
    currentWorkshopIndex = idx;
    // Le clavier et le micro de l'atelier précédent ne répondent plus
    keypad?.destroy();
    keypad = null;
    renderModalLayout();

    hasDiscoveryWorkshopTimerEnded = false;
    isDiscoveryAudioActive = false;

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
        if (currentWorkshopIndex === 0 && isDiscoveryAudioActive) {
          // Un calcul d'écoute est en cours : on laisse la question et la réponse se terminer avant le splash !
          hasDiscoveryWorkshopTimerEnded = true;
          return;
        }
        proceedToNextWorkshop();
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
    keypad?.setEnabled(false);
    audioService.stop();
    audioService.playFeedback("finish");

    const splashOverlay = document.createElement("div");
    splashOverlay.className = "session-modal-overlay activity-transition-overlay";

    let stepTitle = "";
    let stepDescription = "";
    let iconEmoji = "";

    if (nextIdx === 1) {
      stepTitle = "Bravo ! Découverte terminée !";
      stepDescription = "Place au Quiz ! Écoute le calcul et donne la bonne réponse !";
      iconEmoji = "🎯";
    } else {
      stepTitle = "Génial ! Quiz réussi !";
      stepDescription = "Place au Défi Chrono ! Sois le plus rapide avant la fin du chronomètre !";
      iconEmoji = "⚡";
    }

    splashOverlay.innerHTML = `
      <div class="session-modal-container activity-transition-card">
        <div class="transition-fireworks">🎉 🌟 ✨</div>
        <div class="transition-huge-icon">${iconEmoji}</div>
        <h2 class="transition-title">${stepTitle}</h2>
        <p class="transition-subtitle">${stepDescription}</p>
        <button type="button" class="btn-confirm-launch btn-start-next-workshop" id="btn-start-next-step">
          Continuer 🚀
        </button>
      </div>
    `;

    document.body.appendChild(splashOverlay);
    runCelebration({ root: splashOverlay, audioService });

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
  }

  // --- ATELIER 1 : DÉCOUVERTE ---
  async function runDiscoveryStep() {
    if (!isRunning || currentWorkshopIndex !== 0 || hasDiscoveryWorkshopTimerEnded) return;
    while (isPaused) {
      if (!isRunning) return;
      await new Promise((r) => setTimeout(r, 100));
    }

    isDiscoveryAudioActive = true;
    currentItem = engine.getNextDiscovery();

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
    if (!isRunning || currentWorkshopIndex !== 0) {
      isDiscoveryAudioActive = false;
      return;
    }

    if (cueEl) cueEl.textContent = "Réfléchis au résultat...";
    const ok1 = await waitWithPauseCheck(config.pauseBetweenAudioMs);
    if (!ok1 || currentWorkshopIndex !== 0) {
      isDiscoveryAudioActive = false;
      return;
    }

    if (answerEl) {
      answerEl.textContent = currentItem.result.toString();
      answerEl.classList.add("revealed");
    }
    fitOperation(modalEl.querySelector("#modal-card"));
    if (cueEl) cueEl.textContent = `Réponse : ${currentItem.result} !`;

    await audioService.playAnswer(currentItem.result);
    if (!isRunning || currentWorkshopIndex !== 0) {
      isDiscoveryAudioActive = false;
      return;
    }

    engine.registerResult(currentItem, "discovery", true, 0);
    isDiscoveryAudioActive = false;

    // Si le minuteur s'est écoulé pendant cette lecture, on termine l'atelier proprement maintenant
    if (hasDiscoveryWorkshopTimerEnded) {
      proceedToNextWorkshop();
      return;
    }

    const ok2 = await waitWithPauseCheck(1100);
    if (ok2 && currentWorkshopIndex === 0 && !hasDiscoveryWorkshopTimerEnded) {
      runDiscoveryStep();
    }
  }

  // --- ATELIER 2 : QUIZ SANS ENJEU ---
  function setupPracticeWorkshop() {
    const actionsEl = modalEl.querySelector("#modal-practice-actions") as HTMLElement;
    if (actionsEl) actionsEl.style.display = "flex";

    const keypadMount = modalEl.querySelector("#modal-keypad-mount") as HTMLElement;
    keypad = createAnswerInput({
      audio: audioService,
      preferences,
      onDontKnow: revealPracticeAnswer,
      onSubmit: (value, spokenAt) => checkPracticeAnswer(value, spokenAt),
      onInput: (_d, fullVal) => {
        if (isPaused) return;
        currentInput = fullVal;
        const ansEl = modalEl.querySelector("#modal-answer");
        if (ansEl) ansEl.textContent = currentInput;
        fitOperation(modalEl.querySelector("#modal-card"));
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
    if (cueEl) cueEl.textContent = "Prends ton temps pour répondre...";
    if (cardEl) cardEl.className = "stage-card giant-card";
    fitOperation(cardEl);

    questionStartTime = performance.now();
    audioService.playQuestion(currentItem.a, currentItem.b);
  }

  async function checkPracticeAnswer(valStr: string, spokenAt?: number) {
    if (!currentItem || isPaused) return;
    const val = parseInt(valStr, 10);
    const timeMs =
      questionStartTime <= 0 ? 0 : spokenAt !== undefined ? spokenAnswerTimeMs(questionStartTime, spokenAt) : answerTimeMs(questionStartTime);
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
      if (cueEl) cueEl.textContent = "Pas tout à fait, réessaie ou demande de l'aide !";
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

    const ok = await waitWithPauseCheck(1200);
    if (ok && isRunning && currentWorkshopIndex === 1) nextPracticeQuestion();
  }

  // --- ATELIER 3 : TIME-ATTACK ---
  async function handleTimeAttackDontKnow() {
    if (!currentItem || isPaused || isCheckingAnswer || currentWorkshopIndex !== 2) return;
    isCheckingAnswer = true;
    const timeMs = answerTimeMs(questionStartTime);
    const item = currentItem;

    keypad?.setEnabled(false);
    const cardEl = modalEl.querySelector("#modal-card");
    const cueEl = modalEl.querySelector("#modal-cue");
    const answerEl = modalEl.querySelector("#modal-answer");

    engine.registerResult(item, "time-attack", false, timeMs);

    cardEl?.classList.add("card-hint");
    if (cueEl) cueEl.textContent = `C'est noté ! ${item.a} × ${item.b} = ${item.result}`;
    if (answerEl) {
      answerEl.textContent = item.result.toString();
      answerEl.classList.add("revealed");
    }
    fitOperation(cardEl);
    await audioService.playAnswer(item.result);

    const ok = await waitWithPauseCheck(1000);
    isCheckingAnswer = false;
    if (ok && currentWorkshopIndex === 2) nextTimeAttackQuestion();
  }

  function setupTimeAttackWorkshop() {
    const actionsEl = modalEl.querySelector("#modal-timeattack-actions") as HTMLElement;
    if (actionsEl) actionsEl.style.display = "flex";
    modalEl.querySelector("#btn-modal-dontknow")?.addEventListener("click", handleTimeAttackDontKnow);

    const keypadMount = modalEl.querySelector("#modal-keypad-mount") as HTMLElement;
    keypad = createAnswerInput({
      audio: audioService,
      preferences,
      onDontKnow: handleTimeAttackDontKnow,
      onSubmit: (value, spokenAt) => checkTimeAttackAnswer(value, spokenAt),
      onInput: (_d, fullVal) => {
        if (isPaused) return;
        currentInput = fullVal;
        const ansEl = modalEl.querySelector("#modal-answer");
        if (ansEl) ansEl.textContent = currentInput;
        fitOperation(modalEl.querySelector("#modal-card"));
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
    if (cueEl) cueEl.textContent = "⚡ Réponds aussi vite que possible !";
    if (cardEl) cardEl.className = "stage-card giant-card";
    fitOperation(cardEl);

    questionStartTime = performance.now();
    audioService.playQuestion(currentItem.a, currentItem.b);
  }

  async function checkTimeAttackAnswer(valStr: string, spokenAt?: number) {
    if (!currentItem || isPaused || isCheckingAnswer) return;
    isCheckingAnswer = true;
    const timeMs = spokenAt !== undefined ? spokenAnswerTimeMs(questionStartTime, spokenAt) : answerTimeMs(questionStartTime);
    const val = parseInt(valStr, 10);
    const item = currentItem;
    const isCorrect = val === item.result;

    keypad?.setEnabled(false);
    const cardEl = modalEl.querySelector("#modal-card");
    const cueEl = modalEl.querySelector("#modal-cue");
    const answerEl = modalEl.querySelector("#modal-answer");

    engine.registerResult(item, "time-attack", isCorrect, timeMs);

    if (isCorrect) {
      cardEl?.classList.add("card-correct");
      if (answerEl) {
        answerEl.textContent = item.result.toString();
        answerEl.classList.add("revealed");
      }
      fitOperation(cardEl);
      if (cueEl) cueEl.textContent = `Éclair ! ${(timeMs / 1000).toFixed(2)}s ⚡`;
      audioService.playFeedback("correct");
      await audioService.playAnswer(item.result);
    } else {
      cardEl?.classList.add("card-wrong");
      if (cueEl) cueEl.textContent = `À revoir : ${item.a} × ${item.b} = ${item.result}`;
      audioService.playFeedback("wrong");
      const ok1 = await waitWithPauseCheck(350);
      if (!ok1 || currentWorkshopIndex !== 2) {
        isCheckingAnswer = false;
        return;
      }
      if (answerEl) {
        answerEl.textContent = item.result.toString();
        answerEl.classList.add("revealed");
      }
      fitOperation(cardEl);
      await audioService.playAnswer(item.result);
    }

    const ok2 = await waitWithPauseCheck(700);
    isCheckingAnswer = false;
    if (ok2 && currentWorkshopIndex === 2) nextTimeAttackQuestion();
  }

  // Démarrer sur le premier atelier
  startWorkshop(workshops[0]);
}

import { guessLabel, interpretAlternatives, SpeechGuess, SpeechRule } from "../voices/speechGuess";
import { createHoldToTalk } from "../voices/holdToTalk";
import { createSpeechListener, HeardSpeech, ListenMode, SpeechProblem } from "../voices/speechListener";
import { MODEL_SIZE_MB } from "../voices/voiceModel";

const PROBLEMS: Record<SpeechProblem, string> = {
  "no-mic": "Le micro n'est pas autorisé pour cette application.",
  download: `Le modèle vocal (${MODEL_SIZE_MB} Mo) n'a pas pu être téléchargé : il faut internet la première fois.`,
  unavailable: "La reconnaissance vocale ne marche pas sur cet appareil."
};

// Heuristique qui a décidé du résultat, dite simplement
const RULE_TEXTS: Record<SpeechRule, string> = {
  alternatives: "2e proposition de la reconnaissance",
  skipQuestion: "question répétée ignorée",
  lastNumber: "dernier nombre dit",
  numberOverCommand: "nombre plutôt que commande",
  loneHomophones: "mot qui sonne comme un nombre"
};

interface Attempt {
  a: number;
  b: number;
  transcript: string;
}

const THINKING_MAX_MS = 8000;

// Espace parent : essayer la réponse à voix haute, sans toucher à la progression. Le micro s'ouvre avec la fenêtre.
// Elle écoute comme la séance sur ce téléphone : avec le même bouton à maintenir, ou au volume
export function openSpeechTestModal(options: { mode: () => ListenMode; floor: () => number | undefined }): void {
  const isHold = options.mode() === "hold";
  let a = 0;
  let b = 0;
  const attempts: Attempt[] = [];

  const modal = document.createElement("div");
  modal.className = "session-modal-overlay";
  modal.innerHTML = `
    <div class="session-modal-container prompt-choice-modal speech-test-modal">
      <div class="prompt-header">
        <h3>🎤 Essai de la réponse à voix haute</h3>
        <button type="button" class="btn-modal-close" id="btn-speech-test-close" aria-label="Fermer">✕</button>
      </div>
      <p class="speech-test-help">Dites la réponse, ou « je passe », ou « je ne sais pas ». Rien n'est compté dans la progression.</p>

      <div class="speech-test-card">
        <span class="speech-test-label">Combien font</span>
        <span class="speech-test-question" id="speech-test-question"></span>
      </div>

      <div class="speech-test-card" aria-live="polite">
        <span class="speech-test-guess" id="speech-test-guess">…</span>
        <span class="speech-test-heard" id="speech-test-heard"></span>
        <span class="speech-test-rules" id="speech-test-rules"></span>
      </div>

      <p class="speech-test-status" id="speech-test-status"></p>
      <div class="speech-test-level" aria-hidden="true"><span id="speech-test-level"></span></div>
      <div class="speech-strip is-hold-mode" ${isHold ? "" : "hidden"}>
        <button type="button" class="speech-hold" disabled><span class="speech-hold-icon" aria-hidden="true">🎤</span><span class="speech-hold-label">Maintenez et parlez</span></button>
      </div>

      <div class="speech-test-actions">
        <button type="button" class="btn-choice-helper" id="btn-speech-test-next">Autre calcul →</button>
      </div>

      <ol class="speech-test-history" id="speech-test-history"></ol>
    </div>
  `;

  const questionEl = modal.querySelector("#speech-test-question") as HTMLElement;
  const guessEl = modal.querySelector("#speech-test-guess") as HTMLElement;
  const heardEl = modal.querySelector("#speech-test-heard") as HTMLElement;
  const rulesEl = modal.querySelector("#speech-test-rules") as HTMLElement;
  const statusEl = modal.querySelector("#speech-test-status") as HTMLElement;
  const historyEl = modal.querySelector("#speech-test-history") as HTMLElement;
  const levelEl = modal.querySelector("#speech-test-level") as HTMLElement;
  const holdBtn = modal.querySelector(".speech-hold") as HTMLButtonElement;
  const holdLabelEl = modal.querySelector(".speech-hold-label") as HTMLElement;

  const label = (guess: SpeechGuess | null) => (guess ? guessLabel(guess) : "?");
  const verdictClass = (guess: SpeechGuess | null, x: number, y: number) =>
    guess?.kind === "number" ? (guess.value === x * y ? "is-right" : "is-wrong") : "";

  // Ce que la séance comprendrait, et l'heuristique qui en a décidé
  function interpret(attempt: Attempt) {
    const result = interpretAlternatives([attempt.transcript]);
    const usedText = result.rulesUsed.map((rule) => RULE_TEXTS[rule]).join(", ");
    return { result, rulesText: usedText ? `Deviné : ${usedText}` : "" };
  }

  function showCurrent(attempt: Attempt | null, isInterim = false) {
    if (!attempt) {
      guessEl.textContent = "…";
      guessEl.className = "speech-test-guess";
      heardEl.textContent = "";
      rulesEl.textContent = "";
      return;
    }
    const { result, rulesText } = interpret(attempt);
    const verdict = result.guess?.kind === "number" ? (result.guess.value === a * b ? " ✓" : " ✗") : "";
    guessEl.textContent = `${label(result.guess)}${verdict}`;
    guessEl.className = `speech-test-guess ${isInterim ? "is-interim" : ""} ${verdictClass(result.guess, a, b)}`;
    heardEl.textContent = `Entendu : « ${attempt.transcript} »`;
    rulesEl.textContent = rulesText;
  }

  function renderHistory() {
    historyEl.innerHTML = attempts
      .map((attempt) => {
        const { result, rulesText } = interpret(attempt);
        return `
          <li>
            <span>${attempt.a} × ${attempt.b}</span>
            <strong class="${verdictClass(result.guess, attempt.a, attempt.b)}">${label(result.guess)}</strong>
            <em>« ${attempt.transcript} »</em>
            ${rulesText ? `<small>${rulesText}</small>` : ""}
          </li>
        `;
      })
      .join("");
  }

  function showHeard({ transcript, isFinal }: HeardSpeech) {
    const attempt = { a, b, transcript };
    showCurrent(attempt, !isFinal);
    if (isFinal) {
      attempts.unshift(attempt);
      attempts.length = Math.min(attempts.length, 12);
      renderHistory();
    }
  }

  const readyText = isHold
    ? "🎤 Maintenez le bouton pendant que vous parlez. Tout se passe sur l'appareil, sans internet."
    : "🎤 J'écoute… Tout se passe sur l'appareil, sans internet.";

  const listener = createSpeechListener({
    onHeard: (heard) => (isHold ? hold.heard(heard) : showHeard(heard)),
    onState(state) {
      statusEl.textContent =
        state === "loading" ? `⏳ Préparation de la reconnaissance… La première fois, téléchargement du modèle vocal (${MODEL_SIZE_MB} Mo).` : readyText;
      holdBtn.disabled = state !== "ready";
    },
    // Ce que le micro capte : rien ne bouge, c'est le micro ; ça bouge sans texte, c'est la reconnaissance
    onLevel(level) {
      levelEl.style.width = `${Math.round(level * 100)}%`;
    },
    onProblem(problem) {
      statusEl.textContent = `⚠️ ${PROBLEMS[problem]}`;
      statusEl.classList.add("is-warning");
      holdBtn.disabled = true;
    },
    mode: options.mode,
    floor: options.floor
  });

  const hold = createHoldToTalk({
    listener,
    thinkingMaxMs: THINKING_MAX_MS,
    onPhase(phase) {
      holdBtn.dataset.state = phase === "holding" ? "hearing" : phase;
      holdLabelEl.textContent = phase === "holding" ? "Relâchez quand vous avez fini" : phase === "thinking" ? "Je réfléchis…" : "Maintenez et parlez";
      if (phase === "holding") {
        showCurrent(null);
        statusEl.textContent = readyText;
      }
    },
    onPartial: showHeard,
    onOutcome(outcome) {
      if (outcome.kind === "heard") showHeard(outcome.heard);
      else statusEl.textContent = outcome.kind === "too-short" ? "✋ Trop court : gardez le doigt appuyé pendant que vous parlez." : "🤔 Rien n'est revenu de la reconnaissance : réessayez.";
    }
  });
  const unbindHold = hold.bind(holdBtn);

  function newQuestion() {
    hold.cancel();
    a = 1 + Math.floor(Math.random() * 10);
    b = 1 + Math.floor(Math.random() * 10);
    questionEl.textContent = `${a} × ${b}`;
    showCurrent(null);
  }

  modal.querySelector("#btn-speech-test-next")?.addEventListener("click", newQuestion);
  modal.querySelector("#btn-speech-test-close")?.addEventListener("click", () => {
    unbindHold();
    hold.cancel();
    listener.release();
    modal.remove();
  });

  newQuestion();
  document.body.appendChild(modal);
  listener.start();
}

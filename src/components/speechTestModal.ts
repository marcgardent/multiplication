import { guessLabel, interpretAlternatives, SpeechGuess, SpeechRule } from "../voices/speechGuess";
import { createSpeechListener, SpeechProblem } from "../voices/speechListener";
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

// Espace parent : essayer la réponse à voix haute, sans toucher à la progression. Le micro s'ouvre avec la fenêtre
export function openSpeechTestModal(): void {
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

  const listener = createSpeechListener({
    onHeard({ transcript, isFinal }) {
      const attempt = { a, b, transcript };
      showCurrent(attempt, !isFinal);
      if (isFinal) {
        attempts.unshift(attempt);
        attempts.length = Math.min(attempts.length, 12);
        renderHistory();
      }
    },
    onState(state) {
      statusEl.textContent =
        state === "loading"
          ? `⏳ Préparation de la reconnaissance… La première fois, téléchargement du modèle vocal (${MODEL_SIZE_MB} Mo).`
          : "🎤 J'écoute… Tout se passe sur l'appareil, sans internet.";
    },
    onProblem(problem) {
      statusEl.textContent = `⚠️ ${PROBLEMS[problem]}`;
      statusEl.classList.add("is-warning");
    }
  });

  function newQuestion() {
    a = 1 + Math.floor(Math.random() * 10);
    b = 1 + Math.floor(Math.random() * 10);
    questionEl.textContent = `${a} × ${b}`;
    showCurrent(null);
  }

  modal.querySelector("#btn-speech-test-next")?.addEventListener("click", newQuestion);
  modal.querySelector("#btn-speech-test-close")?.addEventListener("click", () => {
    listener.release();
    modal.remove();
  });

  newQuestion();
  document.body.appendChild(modal);
  listener.start();
}

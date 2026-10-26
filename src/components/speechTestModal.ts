import { AnswerPreferencesStore } from "../services/answerPreferences";
import { AudioService } from "../services/audioService";
import { SpeechRule } from "../voices/speechGuess";
import { HeardSpeech } from "../voices/speechListener";
import { createAnswerInput } from "./answerInput";
import { KeypadComponent } from "./keypad";

// Heuristique qui a décidé du résultat, dite simplement
const RULE_TEXTS: Record<SpeechRule, string> = {
  alternatives: "2e proposition de la reconnaissance",
  skipQuestion: "question répétée ignorée",
  lastNumber: "dernier nombre dit",
  numberOverCommand: "nombre plutôt que commande",
  loneHomophones: "mot qui sonne comme un nombre"
};

// Temps pendant lequel le verdict reste affiché avant la suite
const VERDICT_MS = 1500;

// Les réglages de l'enfant, la voix allumée en plus : l'essai écoute même si l'enfant a choisi le clavier,
// et un micro refusé ne la lui éteint pas
function withSpeechOn(preferences: AnswerPreferencesStore): AnswerPreferencesStore {
  return {
    ...preferences,
    get: () => ({ ...preferences.get(), speech: true }),
    set({ speech: _speech, ...change }) {
      if (Object.keys(change).length > 0) preferences.set(change);
    },
    subscribe: (listener) => preferences.subscribe((p) => listener({ ...p, speech: true }))
  };
}

// Espace parent : essayer la réponse à voix haute, sans toucher à la progression.
// C'est l'écran de la séance, avec la même saisie (bouton à maintenir ou volume, micro dans la case, clavier) :
// le parent voit exactement ce que verra l'enfant, plus ce qui a été entendu et la règle qui a décidé
export function openSpeechTestModal(options: { audio: AudioService; preferences: AnswerPreferencesStore }): void {
  const { audio } = options;
  let a = 0;
  let b = 0;
  let nextTimer: ReturnType<typeof setTimeout> | null = null;

  const modal = document.createElement("div");
  modal.className = "session-modal-overlay";
  modal.innerHTML = `
    <div class="session-modal-container workshop-active-modal mode-screen speech-test-modal">
      <div class="prompt-header">
        <h3>🎤 Essai de la réponse à voix haute</h3>
        <button type="button" class="btn-modal-close" id="btn-speech-test-close" aria-label="Fermer">✕</button>
      </div>
      <p class="speech-test-help">Comme en séance. Rien n'est compté.</p>

      <div class="question-stage giant-stage giant-operation-zone">
        <div class="stage-card giant-card" id="speech-test-card">
          <span class="stage-factors giant-factors" id="speech-test-factors"></span>
          <span class="stage-equals giant-equals">=</span>
          <span class="stage-answer giant-answer" id="speech-test-answer">_</span>
        </div>
        <div class="feedback-cue speech-test-heard" id="speech-test-cue" aria-live="polite"></div>
      </div>

      <div class="action-bar-secondary">
        <button type="button" class="btn-help-inline" id="btn-speech-test-next">Autre calcul →</button>
        <button type="button" class="btn-repeat-audio" id="btn-speech-test-repeat" aria-label="Répéter la question">🔊</button>
      </div>

      <div class="keypad-mount-point giant-keypad-mount giant-keypad-zone" id="speech-test-keypad"></div>
    </div>
  `;

  const factorsEl = modal.querySelector("#speech-test-factors") as HTMLElement;
  const answerEl = modal.querySelector("#speech-test-answer") as HTMLElement;
  const cueEl = modal.querySelector("#speech-test-cue") as HTMLElement;

  // Pour le parent, sous le calcul : la phrase entendue, et l'heuristique qui en a tiré la réponse.
  // Le verdict prend la même ligne après Valider
  function showHeard(heard: HeardSpeech) {
    const rules = heard.rulesUsed.map((rule) => RULE_TEXTS[rule]).join(", ");
    cueEl.textContent = heard.transcript ? `Entendu : « ${heard.transcript} »${rules ? ` · Deviné : ${rules}` : ""}` : "";
  }

  function showVerdict(text: string, then: () => void) {
    input.setEnabled(false);
    cueEl.textContent = text;
    if (nextTimer) clearTimeout(nextTimer);
    nextTimer = setTimeout(() => {
      nextTimer = null;
      then();
    }, VERDICT_MS);
  }

  const input: KeypadComponent = createAnswerInput({
    audio,
    preferences: withSpeechOn(options.preferences),
    answerSlot: () => answerEl,
    onHeard: showHeard,
    onInput: (_digit, value) => {
      answerEl.textContent = value;
    },
    onDelete: (value) => {
      answerEl.textContent = value || "_";
    },
    onSubmit(value) {
      if (!value) return;
      const result = a * b;
      if (Number(value) === result) {
        showVerdict(`✅ Juste : ${a} × ${b} = ${result}`, newQuestion);
      } else {
        showVerdict(`❌ ${value} : ce n'est pas ça, on réessaie`, () => {
          input.clear();
          answerEl.textContent = "_";
          cueEl.textContent = "";
          input.setEnabled(true);
        });
      }
    },
    onDontKnow() {
      showVerdict(`🤷 « Je passe » compris : c'était ${a * b}`, newQuestion);
    }
  });
  input.mount(modal.querySelector("#speech-test-keypad") as HTMLElement);

  function newQuestion() {
    if (nextTimer) clearTimeout(nextTimer);
    nextTimer = null;
    a = 1 + Math.floor(Math.random() * 10);
    b = 1 + Math.floor(Math.random() * 10);
    factorsEl.textContent = `${a} × ${b}`;
    input.clear();
    answerEl.textContent = "_";
    cueEl.textContent = "";
    input.setEnabled(true);
    audio.playQuestion(a, b);
  }

  modal.querySelector("#btn-speech-test-next")?.addEventListener("click", newQuestion);
  modal.querySelector("#btn-speech-test-repeat")?.addEventListener("click", () => audio.playQuestion(a, b));
  modal.querySelector("#btn-speech-test-close")?.addEventListener("click", () => {
    if (nextTimer) clearTimeout(nextTimer);
    input.destroy();
    modal.remove();
  });

  document.body.appendChild(modal);
  newQuestion();
}

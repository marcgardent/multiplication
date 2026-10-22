import { AnswerPreferencesStore, AnswerPreset, PRESETS, presetOf } from "../services/answerPreferences";
import { speechBlocker as blockerOf } from "./answerToggles";

const CHOICES: { preset: AnswerPreset; icon: string; title: string; detail: string }[] = [
  { preset: "quiet", icon: "🤫", title: "En silence", detail: "Pas de son. Je tape au clavier." },
  { preset: "sound", icon: "🔊", title: "Avec le son", detail: "J'écoute la question. Je tape au clavier." },
  { preset: "speech", icon: "🎤", title: "Je parle", detail: "J'écoute la question. Je dis la réponse à voix haute." }
];

// Juste avant une séance : comment l'enfant veut jouer. Le dernier choix est déjà coché
export function openAnswerModeModal(options: { preferences: AnswerPreferencesStore; onConfirm(): void }): void {
  // Le choix « Je parle » reste visible : grisé, il dit pourquoi ; lent d'après le calibrage, il prévient
  const speechBlocker = blockerOf(options.preferences);
  const canSpeak = speechBlocker === null;
  const isSlow = options.preferences.speechCalibration()?.verdict === "slow";
  let selected = presetOf(options.preferences.get());
  if (selected === "speech" && !canSpeak) selected = "sound";

  const modal = document.createElement("div");
  modal.className = "session-modal-overlay";
  modal.innerHTML = `
    <div class="session-modal-container prompt-choice-modal answer-mode-modal">
      <div class="prompt-header">
        <h3>Comment veux-tu jouer ?</h3>
        <button type="button" class="btn-modal-close" id="btn-close-answer-mode" aria-label="Fermer">✕</button>
      </div>

      <div class="answer-mode-list" role="radiogroup">
        ${CHOICES.map(
          (c) => `
            <button type="button" role="radio" class="answer-mode-choice" data-preset="${c.preset}"
              ${c.preset === "speech" && !canSpeak ? "disabled" : ""}>
              <span class="answer-mode-icon" aria-hidden="true">${c.icon}</span>
              <span class="answer-mode-text">
                <span class="answer-mode-title">${c.title}</span>
                <span class="answer-mode-detail">${
                  c.preset === "speech" && speechBlocker
                    ? speechBlocker
                    : c.preset === "speech" && isSlow
                      ? `${c.detail} 🐢 Un peu lent sur ce téléphone : attends le nombre avant de valider.`
                      : c.detail
                }</span>
              </span>
            </button>
          `
        ).join("")}
      </div>

      <p class="answer-mode-hint">Tu peux changer pendant le jeu avec 🔊 et 🎤 en haut de l'écran.</p>

      <button type="button" class="btn-confirm-launch" id="btn-answer-mode-go">C'est parti ! 🚀</button>
    </div>
  `;

  function render() {
    modal.querySelectorAll<HTMLElement>(".answer-mode-choice").forEach((btn) => {
      const isSelected = btn.dataset.preset === selected;
      btn.classList.toggle("is-selected", isSelected);
      btn.setAttribute("aria-checked", String(isSelected));
    });
  }

  modal.querySelectorAll<HTMLButtonElement>(".answer-mode-choice").forEach((btn) =>
    btn.addEventListener("click", () => {
      selected = btn.dataset.preset as AnswerPreset;
      render();
    })
  );
  modal.querySelector("#btn-close-answer-mode")?.addEventListener("click", () => modal.remove());
  modal.querySelector("#btn-answer-mode-go")?.addEventListener("click", () => {
    options.preferences.set(PRESETS[selected]);
    modal.remove();
    options.onConfirm();
  });

  render();
  document.body.appendChild(modal);
}

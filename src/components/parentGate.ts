import { createKeypad, KeypadComponent } from "./keypad";
import { createParentChallenge, PARENT_CODE_LENGTH, ParentChallenge, ParentCodeService } from "../services/parentCodeService";

// Porte de l'espace parent : un code à 4 chiffres, choisi à la première entrée.
// Code oublié : un calcul hors de portée d'un enfant permet d'en choisir un nouveau.

type GateStep = "enter" | "choose" | "confirm" | "challenge";

export interface ParentGateOptions {
  parentCode: ParentCodeService;
  // Vrai pour changer de code depuis l'espace parent, sans redemander l'ancien
  isChangingCode?: boolean;
  onGranted(): void;
}

const MAX_WRONG_CODES = 3;
const LOCK_SECONDS = 30;

export function openParentGate(options: ParentGateOptions): void {
  const { parentCode } = options;
  let step: GateStep = options.isChangingCode || !parentCode.hasCode() ? "choose" : "enter";
  let firstEntry = "";
  let wrongCodes = 0;
  let message = "";
  let challenge: ParentChallenge = createParentChallenge();
  let keypad: KeypadComponent | null = null;
  let lockTimer: ReturnType<typeof setInterval> | null = null;

  const modal = document.createElement("div");
  modal.className = "session-modal-overlay";
  modal.innerHTML = `
    <div class="session-modal-container prompt-choice-modal parent-gate">
      <div class="prompt-header">
        <h3>🔒 Espace parent</h3>
        <button type="button" class="btn-modal-close" id="btn-close-gate" aria-label="Fermer">✕</button>
      </div>
      <p class="parent-gate-prompt" id="gate-prompt"></p>
      <div class="parent-gate-entry" id="gate-entry" aria-live="polite"></div>
      <p class="parent-gate-message" id="gate-message"></p>
      <div id="gate-keypad"></div>
      <button type="button" class="btn-choice-helper" id="btn-forgot-code">Code oublié ?</button>
    </div>
  `;

  const promptEl = modal.querySelector("#gate-prompt") as HTMLElement;
  const entryEl = modal.querySelector("#gate-entry") as HTMLElement;
  const messageEl = modal.querySelector("#gate-message") as HTMLElement;
  const forgotBtn = modal.querySelector("#btn-forgot-code") as HTMLElement;

  const PROMPTS: Record<GateStep, () => string> = {
    enter: () => "Tapez votre code.",
    choose: () => "Choisissez un code à 4 chiffres. Il vous sera demandé à chaque entrée.",
    confirm: () => "Tapez-le une seconde fois.",
    challenge: () => `Pour choisir un nouveau code, combien font ${challenge.question} ?`
  };

  function expectedLength(): number {
    return step === "challenge" ? challenge.answer.length : PARENT_CODE_LENGTH;
  }

  function render(value: string) {
    promptEl.textContent = PROMPTS[step]();
    messageEl.textContent = message;
    forgotBtn.hidden = step !== "enter";
    // Le code s'affiche en points, la réponse au calcul en chiffres
    entryEl.innerHTML = Array.from({ length: expectedLength() }, (_, i) => {
      const filled = i < value.length;
      const content = step === "challenge" && filled ? value[i] : "";
      return `<span class="parent-gate-slot ${filled ? "is-filled" : ""} ${step === "challenge" ? "is-digit" : ""}">${content}</span>`;
    }).join("");
  }

  function mountKeypad() {
    keypad?.destroy();
    keypad = createKeypad({
      maxLength: expectedLength(),
      onInput: (_digit, value) => {
        message = "";
        render(value);
        if (value.length === expectedLength()) submit(value);
      },
      onDelete: (value) => render(value)
    });
    keypad.mount(modal.querySelector("#gate-keypad") as HTMLElement);
  }

  function goTo(next: GateStep, nextMessage = "") {
    if (lockTimer) clearInterval(lockTimer);
    lockTimer = null;
    step = next;
    message = nextMessage;
    mountKeypad();
    render("");
  }

  function close() {
    if (lockTimer) clearInterval(lockTimer);
    keypad?.destroy();
    modal.remove();
  }

  // Trois codes faux de suite : le clavier se bloque 30 secondes
  function lockKeypad() {
    let remaining = LOCK_SECONDS;
    wrongCodes = 0;
    keypad?.setEnabled(false);
    const tick = () => {
      messageEl.textContent = `Trop d'essais. Réessayez dans ${remaining} secondes.`;
      if (remaining-- > 0) return;
      goTo("enter");
    };
    tick();
    lockTimer = setInterval(tick, 1000);
  }

  async function submit(value: string) {
    if (step === "enter") {
      if (await parentCode.isCorrect(value)) {
        close();
        options.onGranted();
      } else if (++wrongCodes >= MAX_WRONG_CODES) {
        goTo("enter");
        lockKeypad();
      } else {
        goTo("enter", "Code incorrect.");
      }
    } else if (step === "choose") {
      firstEntry = value;
      goTo("confirm");
    } else if (step === "confirm") {
      if (value !== firstEntry) {
        goTo("choose", "Les deux codes sont différents. Recommencez.");
        return;
      }
      await parentCode.setCode(value);
      close();
      options.onGranted();
    } else if (value === challenge.answer) {
      goTo("choose");
    } else {
      challenge = createParentChallenge();
      goTo("challenge", "Ce n'est pas ça. Voici un autre calcul.");
    }
  }

  modal.querySelector("#btn-close-gate")?.addEventListener("click", close);
  forgotBtn.addEventListener("click", () => {
    challenge = createParentChallenge();
    goTo("challenge");
  });

  document.body.appendChild(modal);
  goTo(step);
}

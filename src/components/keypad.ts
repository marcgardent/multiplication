// Temps accordé pour appuyer sur Valider : il n'est pas compté dans le temps de réponse
export const SUBMIT_ALLOWANCE_MS = 500;

// Temps de réponse d'une question posée à questionStartTime et validée maintenant
export function answerTimeMs(questionStartTime: number, now = performance.now()): number {
  return Math.max(1, Math.round(now - questionStartTime) - SUBMIT_ALLOWANCE_MS);
}

// Réponse dite à voix haute : jusqu'au dernier mot prononcé. Ni le temps de calcul de la reconnaissance,
// ni de délai pour un appui : il n'y a pas de bouton à toucher
export function spokenAnswerTimeMs(questionStartTime: number, spokenAt: number): number {
  return Math.max(1, Math.round(spokenAt - questionStartTime));
}

export interface KeypadComponent {
  mount(parent: HTMLElement): void;
  destroy(): void;
  clear(): void;
  // Réponse remplie autrement qu'au clavier (à voix haute) : Valider l'enverra, l'effacement la corrige
  setValue?(value: string): void;
  getCurrentValue(): string;
  setEnabled(enabled: boolean): void;
}

export interface KeypadOptions {
  onInput?: (digit: string, currentValue: string) => void;
  onDelete?: (currentValue: string) => void;
  // Touche « Valider » ou Entrée, seulement quand une réponse est tapée ; spokenAt quand elle a été dite à voix haute
  onSubmit?: (value: string, spokenAt?: number) => void;
  // Nombre de chiffres acceptés : 3 par défaut, le plus grand résultat étant 100
  maxLength?: number;
}

export function createKeypad(options: KeypadOptions = {}): KeypadComponent {
  const maxLength = options.maxLength ?? 3;
  let currentValue = "";
  let isEnabled = true;
  let element: HTMLElement | null = null;

  function render(): HTMLElement {
    const container = document.createElement("div");
    container.className = "keypad-container";

    const keys = [
      ["1", "2", "3"],
      ["4", "5", "6"],
      ["7", "8", "9"],
      ["delete", "0", "submit"]
    ];

    keys.forEach((row) => {
      const rowDiv = document.createElement("div");
      rowDiv.className = "keypad-row";

      row.forEach((k) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "keypad-btn";

        if (k === "delete") {
          btn.innerHTML = `<span class="icon">⌫</span>`;
          btn.classList.add("keypad-btn-delete");
          btn.setAttribute("aria-label", "Effacer");
          btn.addEventListener("click", () => {
            if (!isEnabled || currentValue.length === 0) return;
            currentValue = currentValue.slice(0, -1);
            options.onDelete?.(currentValue);
          });
        } else if (k === "submit") {
          btn.textContent = "Valider";
          btn.classList.add("keypad-btn-submit");
          btn.addEventListener("click", submit);
        } else {
          btn.textContent = k;
          btn.addEventListener("click", () => {
            if (!isEnabled) return;
            if (currentValue.length >= maxLength) return;
            currentValue += k;
            options.onInput?.(k, currentValue);
          });
        }

        rowDiv.appendChild(btn);
      });

      container.appendChild(rowDiv);
    });

    return container;
  }

  function submit() {
    if (!isEnabled || currentValue.length === 0) return;
    options.onSubmit?.(currentValue);
  }

  // Support du clavier physique si disponible
  function handleKeyDown(e: KeyboardEvent) {
    if (!isEnabled) return;
    if (e.key >= "0" && e.key <= "9") {
      if (currentValue.length >= maxLength) return;
      currentValue += e.key;
      options.onInput?.(e.key, currentValue);
    } else if (e.key === "Backspace") {
      if (currentValue.length === 0) return;
      currentValue = currentValue.slice(0, -1);
      options.onDelete?.(currentValue);
    } else if (e.key === "Enter") {
      submit();
    }
  }

  window.addEventListener("keydown", handleKeyDown);

  return {
    mount(parent: HTMLElement) {
      element = render();
      parent.appendChild(element);
    },

    destroy() {
      window.removeEventListener("keydown", handleKeyDown);
      element?.remove();
      element = null;
    },

    clear() {
      currentValue = "";
    },

    setValue(value: string) {
      currentValue = value.slice(0, maxLength);
    },

    getCurrentValue(): string {
      return currentValue;
    },

    setEnabled(enabled: boolean) {
      isEnabled = enabled;
      if (element) {
        element.querySelectorAll("button").forEach((btn) => {
          btn.disabled = !enabled;
        });
      }
    }
  };
}

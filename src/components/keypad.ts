export interface KeypadComponent {
  mount(parent: HTMLElement): void;
  destroy(): void;
  clear(): void;
  getCurrentValue(): string;
  setEnabled(enabled: boolean): void;
}

export interface KeypadOptions {
  onInput?: (digit: string, currentValue: string) => void;
  onDelete?: (currentValue: string) => void;
  onSubmit?: (value: string) => void;
  onHelp?: () => void;
  showHelpButton?: boolean;
  helpIcon?: string;
  helpLabel?: string;
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
      [options.showHelpButton ? "help" : "", "0", "delete"]
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
        } else if (k === "help") {
          const helpIcon = options.helpIcon ?? "?";
          const helpLabel = options.helpLabel ?? "Je ne sais pas";
          btn.innerHTML = `<span class="keypad-help-icon">${helpIcon}</span><span class="keypad-help-label">${helpLabel}</span>`;
          btn.classList.add("keypad-btn-help");
          btn.setAttribute("aria-label", helpLabel);
          btn.setAttribute("title", helpLabel);
          btn.addEventListener("click", () => {
            if (!isEnabled) return;
            currentValue = "";
            options.onHelp?.();
          });
        } else if (k === "") {
          btn.classList.add("keypad-btn-empty");
          btn.disabled = true;
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
      options.onSubmit?.(currentValue);
    } else if (
      options.showHelpButton &&
      options.onHelp &&
      (e.key === "?" || e.key === "h" || e.key === "H" || e.key === "p" || e.key === "P")
    ) {
      currentValue = "";
      options.onHelp();
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

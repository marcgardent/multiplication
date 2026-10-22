import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { answerTimeMs, createKeypad, spokenAnswerTimeMs, SUBMIT_ALLOWANCE_MS } from "./keypad";

class MockElement {
  tagName: string;
  className = "";
  classList = {
    add: (c: string) => {
      this.classListSet.add(c);
      this.className = Array.from(this.classListSet).join(" ");
    },
    contains: (c: string) => this.classListSet.has(c)
  };
  private classListSet = new Set<string>();
  attributes = new Map<string, string>();
  children: MockElement[] = [];
  type = "";
  disabled = false;
  innerHTML = "";
  textContent = "";
  listeners = new Map<string, Array<() => void>>();

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  appendChild(child: MockElement) {
    this.children.push(child);
  }

  remove() {
    this.children = [];
  }

  setAttribute(k: string, v: string) {
    this.attributes.set(k, v);
  }

  getAttribute(k: string) {
    return this.attributes.get(k) ?? null;
  }

  addEventListener(event: string, cb: () => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(cb);
  }

  click() {
    if (this.disabled) return;
    this.listeners.get("click")?.forEach((cb) => cb());
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const walk = (el: MockElement) => {
      if (selector === "button" && el.tagName === "BUTTON") results.push(el);
      else if (selector.startsWith(".") && el.classList.contains(selector.slice(1))) results.push(el);
      el.children.forEach(walk);
    };
    walk(this);
    return results;
  }

  querySelector(selector: string): MockElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

describe("KeypadComponent", () => {
  let keydownListeners: Array<(e: KeyboardEvent) => void> = [];

  beforeEach(() => {
    keydownListeners = [];
    vi.stubGlobal("document", {
      createElement: (tag: string) => new MockElement(tag.toUpperCase())
    });
    vi.stubGlobal("window", {
      addEventListener: (evt: string, cb: (e: KeyboardEvent) => void) => {
        if (evt === "keydown") keydownListeners.push(cb);
      },
      removeEventListener: (evt: string, cb: (e: KeyboardEvent) => void) => {
        if (evt === "keydown") keydownListeners = keydownListeners.filter((l) => l !== cb);
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("met Effacer à gauche du 0 et Valider à droite, sans touche pour passer", () => {
    const parent = new MockElement("DIV");
    const keypad = createKeypad();
    keypad.mount(parent as unknown as HTMLElement);

    expect(parent.querySelectorAll("button").length).toBe(12);
    const lastRow = parent.children[0].children[3].children;
    expect(lastRow[0].classList.contains("keypad-btn-delete")).toBe(true);
    expect(lastRow[2].classList.contains("keypad-btn-submit")).toBe(true);
    expect(lastRow[1].textContent).toBe("0");
    expect(lastRow[2].textContent).toBe("Valider");

    keypad.destroy();
  });

  it("valide la réponse tapée, avec la touche Valider ou Entrée", () => {
    const parent = new MockElement("DIV");
    const onSubmit = vi.fn();
    const keypad = createKeypad({ onSubmit });
    keypad.mount(parent as unknown as HTMLElement);

    parent.querySelectorAll("button").find((b) => b.textContent === "5")?.click();
    parent.querySelectorAll("button").find((b) => b.textContent === "6")?.click();
    parent.querySelector(".keypad-btn-submit")?.click();
    expect(onSubmit).toHaveBeenCalledWith("56");

    keydownListeners.forEach((l) => l({ key: "Enter" } as KeyboardEvent));
    expect(onSubmit).toHaveBeenCalledTimes(2);

    keypad.destroy();
  });

  it("ne valide rien tant qu'aucun chiffre n'est tapé", () => {
    const parent = new MockElement("DIV");
    const onSubmit = vi.fn();
    const keypad = createKeypad({ onSubmit });
    keypad.mount(parent as unknown as HTMLElement);

    parent.querySelector(".keypad-btn-submit")?.click();
    keydownListeners.forEach((l) => l({ key: "Enter" } as KeyboardEvent));
    expect(onSubmit).not.toHaveBeenCalled();

    keypad.destroy();
  });

  it("ne valide rien quand le clavier est désactivé", () => {
    const parent = new MockElement("DIV");
    const onSubmit = vi.fn();
    const keypad = createKeypad({ onSubmit });
    keypad.mount(parent as unknown as HTMLElement);

    parent.querySelectorAll("button").find((b) => b.textContent === "7")?.click();
    keypad.setEnabled(false);
    keydownListeners.forEach((l) => l({ key: "Enter" } as KeyboardEvent));
    expect(onSubmit).not.toHaveBeenCalled();

    keypad.destroy();
  });

  it("handles digits and backspace", () => {
    const parent = new MockElement("DIV");
    const onInput = vi.fn();
    const onDelete = vi.fn();
    const keypad = createKeypad({ onInput, onDelete });
    keypad.mount(parent as unknown as HTMLElement);

    const btn5 = parent.querySelectorAll("button").find((b) => b.textContent === "5");
    expect(btn5).toBeDefined();
    btn5?.click();
    expect(onInput).toHaveBeenCalledWith("5", "5");
    expect(keypad.getCurrentValue()).toBe("5");

    const deleteBtn = parent.querySelector(".keypad-btn-delete");
    deleteBtn?.click();
    expect(onDelete).toHaveBeenCalledWith("");
    expect(keypad.getCurrentValue()).toBe("");

    keypad.destroy();
  });

  it("ne compte pas les 500 ms accordées pour appuyer sur Valider dans le temps de réponse", () => {
    expect(SUBMIT_ALLOWANCE_MS).toBe(500);
    expect(answerTimeMs(1000, 3800)).toBe(2300);
    // Une réponse plus rapide que l'appui lui-même garde un temps positif : elle reste enregistrée
    expect(answerTimeMs(1000, 1300)).toBe(1);
  });
});

describe("Temps d'une réponse dite à voix haute", () => {
  it("va de la question au dernier mot prononcé, sans délai d'appui", () => {
    expect(spokenAnswerTimeMs(1000, 3200)).toBe(2200);
    expect(spokenAnswerTimeMs(1000, 900)).toBe(1);
  });
});

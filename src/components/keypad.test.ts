import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createKeypad } from "./keypad";

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

  it("renders keypad with digits and delete button without help button by default", () => {
    const parent = new MockElement("DIV");
    const keypad = createKeypad({ showHelpButton: false });
    keypad.mount(parent as unknown as HTMLElement);

    const buttons = parent.querySelectorAll("button");
    expect(buttons.length).toBe(12);

    const emptyBtn = parent.querySelector(".keypad-btn-empty");
    expect(emptyBtn).not.toBeNull();
    expect(emptyBtn?.disabled).toBe(true);

    keypad.destroy();
  });

  it("renders '?' button with label 'Je ne sais pas' when showHelpButton is true", () => {
    const parent = new MockElement("DIV");
    const onHelp = vi.fn();
    const keypad = createKeypad({
      showHelpButton: true,
      onHelp
    });
    keypad.mount(parent as unknown as HTMLElement);

    const helpBtn = parent.querySelector(".keypad-btn-help");
    expect(helpBtn).not.toBeNull();
    expect(helpBtn?.getAttribute("aria-label")).toBe("Je ne sais pas");
    expect(helpBtn?.innerHTML).toContain("?");
    expect(helpBtn?.innerHTML).toContain("Je ne sais pas");

    helpBtn?.click();
    expect(onHelp).toHaveBeenCalledTimes(1);

    keypad.destroy();
  });

  it("triggers onHelp when '?' keyboard key is pressed", () => {
    const parent = new MockElement("DIV");
    const onHelp = vi.fn();
    const keypad = createKeypad({
      showHelpButton: true,
      onHelp
    });
    keypad.mount(parent as unknown as HTMLElement);

    keydownListeners.forEach((l) => l({ key: "?" } as KeyboardEvent));
    expect(onHelp).toHaveBeenCalledTimes(1);

    keydownListeners.forEach((l) => l({ key: "p" } as KeyboardEvent));
    expect(onHelp).toHaveBeenCalledTimes(2);

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
});

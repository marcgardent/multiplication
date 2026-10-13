import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLearningOrderCard } from "./learningOrderCard";
import { createMatrixStore, MatrixStore } from "../core/matrixStore";
import { createMemoryStorage } from "../services/storageService";

class MockDOMElement {
  tagName: string;
  className = "";
  innerHTMLValue = "";
  parentElement: MockDOMElement | null = null;
  children: MockDOMElement[] = [];
  attributes = new Map<string, string>();
  listeners = new Map<string, Array<(evt?: any) => void>>();
  disabled = false;
  style: Record<string, string> = {};

  setPointerCapture(_id: number) {}
  releasePointerCapture(_id: number) {}

  getBoundingClientRect() {
    return { top: 0, bottom: 50, left: 0, right: 100, width: 100, height: 50 };
  }

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  get classList() {
    return {
      add: (c: string) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.add(c);
        this.className = Array.from(classes).join(" ");
      },
      remove: (c: string) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        classes.delete(c);
        this.className = Array.from(classes).join(" ");
      },
      contains: (c: string) => {
        const classes = new Set(this.className.split(/\s+/).filter(Boolean));
        return classes.has(c);
      }
    };
  }

  get innerHTML(): string {
    return this.innerHTMLValue;
  }

  set innerHTML(html: string) {
    this.innerHTMLValue = html;
    this.children = [];
    this.parseHtml(html);
  }

  setAttribute(k: string, v: string) {
    this.attributes.set(k, v);
    if (k === "class") this.className = v;
    if (k === "disabled") this.disabled = true;
  }

  getAttribute(k: string): string | null {
    if (k === "class") return this.className || null;
    return this.attributes.get(k) ?? null;
  }

  hasAttribute(k: string): boolean {
    return this.attributes.has(k);
  }

  removeAttribute(k: string) {
    this.attributes.delete(k);
    if (k === "disabled") this.disabled = false;
  }

  appendChild(child: MockDOMElement) {
    child.parentElement = this;
    this.children.push(child);
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
      this.parentElement = null;
    }
  }

  replaceWith(newEl: MockDOMElement) {
    if (this.parentElement) {
      const idx = this.parentElement.children.indexOf(this);
      if (idx !== -1) {
        this.parentElement.children[idx] = newEl;
        newEl.parentElement = this.parentElement;
        this.parentElement = null;
      }
    }
  }

  addEventListener(event: string, cb: (evt?: any) => void) {
    if (!this.listeners.has(event)) this.listeners.set(event, []);
    this.listeners.get(event)!.push(cb);
  }

  dispatchEvent(event: { type: string; [key: string]: any }) {
    this.listeners.get(event.type)?.forEach((cb) => cb(event));
  }

  click() {
    if (this.disabled) return;
    this.dispatchEvent({ type: "click" });
  }

  contains(other: MockDOMElement | null): boolean {
    let curr = other;
    while (curr) {
      if (curr === this) return true;
      curr = curr.parentElement;
    }
    return false;
  }

  closest(selector: string): MockDOMElement | null {
    let curr: MockDOMElement | null = this;
    while (curr) {
      if (selector.startsWith(".") && curr.classList.contains(selector.slice(1))) return curr;
      if (selector.startsWith("#") && curr.getAttribute("id") === selector.slice(1)) return curr;
      if (curr.tagName.toLowerCase() === selector.toLowerCase()) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector: string): MockDOMElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): MockDOMElement[] {
    const results: MockDOMElement[] = [];

    const matches = (el: MockDOMElement): boolean => {
      if (selector.startsWith("#")) {
        return el.getAttribute("id") === selector.slice(1);
      }
      if (selector.startsWith(".")) {
        return el.classList.contains(selector.slice(1));
      }
      if (selector.startsWith("[") && selector.endsWith("]")) {
        const attrName = selector.slice(1, -1);
        return el.hasAttribute(attrName);
      }
      return el.tagName.toLowerCase() === selector.toLowerCase();
    };

    const walk = (el: MockDOMElement) => {
      for (const child of el.children) {
        if (matches(child)) {
          results.push(child);
        }
        walk(child);
      }
    };

    walk(this);
    return results;
  }

  private parseHtml(html: string) {
    // Parser récursif simplifié pour les balises générées par learningOrderCard
    const tagRegex = /<([a-zA-Z0-9]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9]+)([^>]*)\/>/g;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(html)) !== null) {
      const tagName = match[1] || match[4];
      const attrStr = match[2] || match[5] || "";
      const innerContent = match[3] || "";

      const child = new MockDOMElement(tagName);

      // Parse attributes
      const attrRegex = /([a-zA-Z0-9\-_]+)(?:="([^"]*)")?/g;
      let attrMatch: RegExpExecArray | null;
      while ((attrMatch = attrRegex.exec(attrStr)) !== null) {
        const attrName = attrMatch[1];
        const attrVal = attrMatch[2] !== undefined ? attrMatch[2] : "";
        child.setAttribute(attrName, attrVal);
      }

      if (innerContent) {
        child.innerHTML = innerContent;
      }

      this.appendChild(child);
    }
  }
}

describe("LearningOrderCardComponent", () => {
  let matrixStore: MatrixStore;

  beforeEach(() => {
    matrixStore = createMatrixStore(createMemoryStorage(), "test");

    vi.stubGlobal("document", {
      createElement: (tag: string) => new MockDOMElement(tag)
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("crée et rend le composant avec les 10 tables actives par défaut", () => {
    const card = createLearningOrderCard(matrixStore);
    const element = card.render() as unknown as MockDOMElement;

    expect(element).not.toBeNull();
    const rows = element.querySelectorAll(".learning-table-row");
    expect(rows.length).toBe(10);

    // Ordre par défaut attendu : 1, 10, 2, 5, 3, 4, 6, 7, 8, 9
    const tables = rows.map((r) => Number(r.getAttribute("data-table")));
    expect(tables).toEqual([1, 10, 2, 5, 3, 4, 6, 7, 8, 9]);

    // La première ligne doit être la table de 1 et ne peut pas monter (disabled)
    const firstUpBtn = rows[0].querySelectorAll(".btn-move-up")[0];
    expect(firstUpBtn?.hasAttribute("disabled")).toBe(true);

    // La dernière ligne (table de 9) ne peut pas descendre (disabled)
    const lastDownBtn = rows[9].querySelectorAll(".btn-move-down")[0];
    expect(lastDownBtn?.hasAttribute("disabled")).toBe(true);

    // Vérifie les bulles distinctes d'information
    const firstRowBadges = rows[0].querySelectorAll(".badge-stat");
    expect(firstRowBadges.length).toBe(2);
    expect(firstRowBadges[0].classList.contains("badge-discovery")).toBe(true);
    expect(firstRowBadges[1].classList.contains("badge-mastered")).toBe(true);
  });

  it("monte le composant dans un parent et s'abonne aux mises à jour du store", () => {
    const parent = new MockDOMElement("DIV");
    const card = createLearningOrderCard(matrixStore);

    card.mount(parent as unknown as HTMLElement);
    expect(parent.children.length).toBe(1);

    // Modifier le store doit déclencher updateDOM via le subscribe
    matrixStore.setLearningTables([5, 2, 3]);

    const activeRows = parent.querySelectorAll(".learning-table-row");
    expect(activeRows.length).toBe(3);
    const tables = activeRows.map((r) => Number(r.getAttribute("data-table")));
    expect(tables).toEqual([5, 2, 3]);

    // Les tables restantes sont en réserve
    const reserveChips = parent.querySelectorAll(".btn-add-table-chip");
    expect(reserveChips.length).toBe(7);
  });

  it("permet de descendre et monter une table avec les boutons d'action", () => {
    const parent = new MockDOMElement("DIV");
    const card = createLearningOrderCard(matrixStore);
    card.mount(parent as unknown as HTMLElement);

    // Ordre initial : [1, 10, 2, 5, ...]
    // Descendons la table de 1
    const rowsInitial = parent.querySelectorAll(".learning-table-row");
    const downBtnTable1 = rowsInitial[0].querySelectorAll(".btn-move-down")[0];
    downBtnTable1.click();

    expect(matrixStore.getLearningTables()).toEqual([10, 1, 2, 5, 3, 4, 6, 7, 8, 9]);

    // Maintenant table 1 est à l'index 1. Remontons-la
    const rowsUpdated = parent.querySelectorAll(".learning-table-row");
    const upBtnTable1 = rowsUpdated[1].querySelectorAll(".btn-move-up")[0];
    upBtnTable1.click();

    expect(matrixStore.getLearningTables()).toEqual([1, 10, 2, 5, 3, 4, 6, 7, 8, 9]);
  });

  it("permet de mettre une table en réserve et de la réactiver via sa puce", () => {
    const parent = new MockDOMElement("DIV");
    const card = createLearningOrderCard(matrixStore);
    card.mount(parent as unknown as HTMLElement);

    // Retirer la table de 9 (✕)
    const removeBtns = parent.querySelectorAll(".btn-remove-table");
    const removeBtnTable9 = removeBtns.find((b) => b.getAttribute("data-table") === "9");
    expect(removeBtnTable9).toBeDefined();
    removeBtnTable9!.click();

    expect(matrixStore.getLearningTables()).toEqual([1, 10, 2, 5, 3, 4, 6, 7, 8]);

    // La puce pour réactiver la table de 9 doit être présente dans la réserve
    const reserveChips = parent.querySelectorAll(".btn-add-table-chip");
    const chipTable9 = reserveChips.find((c) => c.getAttribute("data-table") === "9");
    expect(chipTable9).toBeDefined();

    chipTable9!.click();

    // Elle est réajoutée à la fin
    expect(matrixStore.getLearningTables()).toEqual([1, 10, 2, 5, 3, 4, 6, 7, 8, 9]);
  });

  it("applique les boutons de raccourcis (presets)", () => {
    const parent = new MockDOMElement("DIV");
    const card = createLearningOrderCard(matrixStore);
    card.mount(parent as unknown as HTMLElement);

    // 1. Preset ordre 1 à 10
    const btnAsc = parent.querySelector("#preset-asc");
    expect(btnAsc).not.toBeNull();
    btnAsc!.click();
    expect(matrixStore.getLearningTables()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // 2. Réduire la liste puis utiliser le preset "Toutes"
    matrixStore.setLearningTables([3, 7]);
    const btnAll = parent.querySelector("#preset-all");
    expect(btnAll).not.toBeNull();
    btnAll!.click();
    expect(matrixStore.getLearningTables().length).toBe(10);
    expect(matrixStore.getLearningTables().slice(0, 2)).toEqual([3, 7]);

    // 3. Preset ordre par défaut
    const btnDefault = parent.querySelector("#preset-school");
    expect(btnDefault).not.toBeNull();
    btnDefault!.click();
    expect(matrixStore.getLearningTables()).toEqual([1, 10, 2, 5, 3, 4, 6, 7, 8, 9]);
  });

  it("gère le drag & drop via Pointer Events pour réordonner les tables", () => {
    const parent = new MockDOMElement("DIV");
    const card = createLearningOrderCard(matrixStore);
    card.mount(parent as unknown as HTMLElement);

    const listEl = parent.querySelector("#learning-tables-list");
    expect(listEl).not.toBeNull();

    const rows = parent.querySelectorAll(".learning-table-row");
    const rowTable1 = rows[0]; // Table 1
    const rowTable10 = rows[1]; // Table 10

    // Définir des positions distinctes pour chaque ligne
    rowTable1.getBoundingClientRect = () => ({ top: 0, bottom: 50, left: 0, right: 100, width: 100, height: 50 });
    rowTable10.getBoundingClientRect = () => ({ top: 51, bottom: 100, left: 0, right: 100, width: 100, height: 50 });

    // 1. Début du drag (pointerdown) sur la table 1
    rowTable1.dispatchEvent({
      type: "pointerdown",
      pointerId: 1,
      clientY: 20,
      button: 0,
      target: rowTable1
    });

    expect(rowTable1.classList.contains("dragging")).toBe(true);
    expect(listEl!.classList.contains("is-dragging")).toBe(true);

    // 2. Déplacement (pointermove) vers la position de la table 10 (Y = 70)
    rowTable1.dispatchEvent({
      type: "pointermove",
      pointerId: 1,
      clientY: 70
    });

    expect(rowTable10.classList.contains("drag-over")).toBe(true);

    // 3. Relâchement (pointerup)
    rowTable1.dispatchEvent({
      type: "pointerup",
      pointerId: 1
    });

    // L'ordre a été mis à jour : table 10 passe en #1 et table 1 en #2
    expect(matrixStore.getLearningTables()).toEqual([10, 1, 2, 5, 3, 4, 6, 7, 8, 9]);

    // Fin du drag : styles réinitialisés
    expect(rowTable1.classList.contains("dragging")).toBe(false);
    expect(listEl!.classList.contains("is-dragging")).toBe(false);
    expect(rowTable10.classList.contains("drag-over")).toBe(false);
  });

  it("nettoie les écouteurs et le DOM lors de destroy()", () => {
    const parent = new MockDOMElement("DIV");
    const card = createLearningOrderCard(matrixStore);
    card.mount(parent as unknown as HTMLElement);

    expect(parent.children.length).toBe(1);

    card.destroy();

    expect(parent.children.length).toBe(0);

    // Une modification du store après destroy ne doit rien faire ni lever d'erreur
    expect(() => {
      matrixStore.setLearningTables([2, 4]);
    }).not.toThrow();
  });
});

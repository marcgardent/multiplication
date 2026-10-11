import { describe, expect, it } from "vitest";
import { startBackGuard } from "./backGuardService";

// Faux téléphone : un historique d'étapes, un bouton retour qui ferme l'application quand il n'y a plus rien derrière
function createFakePhone() {
  const entries: unknown[] = [null];
  let index = 0;
  let isClosed = false;
  const listeners: Record<string, Array<() => void>> = {};
  const emit = (type: string) => (listeners[type] ?? []).forEach((listener) => listener());

  const win = {
    history: {
      get state() {
        return entries[index];
      },
      pushState(state: unknown) {
        entries.splice(index + 1, entries.length, state);
        index++;
      },
      forward() {
        if (index === entries.length - 1) return;
        index++;
        emit("popstate");
      }
    },
    addEventListener(type: string, listener: () => void) {
      (listeners[type] ??= []).push(listener);
    }
  };

  return {
    win: win as unknown as Pick<Window, "history" | "addEventListener">,
    touch: () => emit("pointerup"),
    pressBack() {
      if (index === 0) {
        isClosed = true;
        return;
      }
      index--;
      emit("popstate");
    },
    isClosed: () => isClosed,
    entryCount: () => entries.length
  };
}

describe("Bouton retour du téléphone", () => {
  it("ferme l'application quand rien ne le retient", () => {
    const phone = createFakePhone();
    phone.touch();
    phone.pressBack();

    expect(phone.isClosed()).toBe(true);
  });

  it("ne ferme plus l'application dès que l'écran a été touché", () => {
    const phone = createFakePhone();
    startBackGuard(phone.win);
    phone.touch();
    phone.pressBack();

    expect(phone.isClosed()).toBe(false);
  });

  it("résiste à des appuis répétés, sans allonger l'historique", () => {
    const phone = createFakePhone();
    startBackGuard(phone.win);
    phone.touch();
    for (let i = 0; i < 20; i++) {
      phone.pressBack();
      phone.touch();
    }
    for (let i = 0; i < 20; i++) phone.pressBack();

    expect(phone.isClosed()).toBe(false);
    expect(phone.entryCount()).toBe(2);
  });
});

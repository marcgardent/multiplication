import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWakeLockService } from "./wakeLockService";

// Faux téléphone : compte les verrous d'écran accordés et encore tenus
function installFakePhone(options: { refuses?: boolean } = {}) {
  const held = new Set<object>();
  let requestCount = 0;
  let onVisibilityChange: () => void = () => undefined;
  const fakeDocument = {
    visibilityState: "visible",
    addEventListener: (_type: string, listener: () => void) => {
      onVisibilityChange = listener;
    }
  };

  vi.stubGlobal("document", fakeDocument);
  vi.stubGlobal("navigator", {
    wakeLock: {
      async request() {
        requestCount++;
        if (options.refuses) throw new Error("NotAllowedError");
        let onRelease: () => void = () => undefined;
        const sentinel = {
          addEventListener: (_type: string, listener: () => void) => {
            onRelease = listener;
          },
          async release() {
            held.delete(sentinel);
            onRelease();
          }
        };
        held.add(sentinel);
        return sentinel;
      }
    }
  });

  return {
    heldCount: () => held.size,
    requestCount: () => requestCount,
    // Le système retire tous les verrous quand l'application passe en arrière-plan
    goToBackground() {
      fakeDocument.visibilityState = "hidden";
      [...held].forEach((sentinel) => (sentinel as { release(): Promise<void> }).release());
      onVisibilityChange();
    },
    comeBack() {
      fakeDocument.visibilityState = "visible";
      onVisibilityChange();
    }
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Verrou d'écran", () => {
  beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => undefined));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("tient l'écran allumé pendant une activité et le rend à la fin", async () => {
    const phone = installFakePhone();
    const wakeLock = createWakeLockService();

    const release = wakeLock.keepAwake();
    await settle();
    expect(phone.heldCount()).toBe(1);
    expect(wakeLock.isActive()).toBe(true);

    release();
    await settle();
    expect(phone.heldCount()).toBe(0);
    expect(wakeLock.isActive()).toBe(false);
  });

  it("garde un seul verrou tant qu'il reste une activité en cours", async () => {
    const phone = installFakePhone();
    const wakeLock = createWakeLockService();

    const releaseFirst = wakeLock.keepAwake();
    const releaseSecond = wakeLock.keepAwake();
    await settle();
    expect(phone.requestCount()).toBe(1);

    releaseFirst();
    releaseFirst();
    await settle();
    expect(phone.heldCount()).toBe(1);

    releaseSecond();
    await settle();
    expect(phone.heldCount()).toBe(0);
  });

  it("reprend le verrou quand l'application revient au premier plan", async () => {
    const phone = installFakePhone();
    const wakeLock = createWakeLockService();
    wakeLock.keepAwake();
    await settle();

    phone.goToBackground();
    await settle();
    expect(phone.heldCount()).toBe(0);
    expect(wakeLock.isActive()).toBe(false);

    phone.comeBack();
    await settle();
    expect(phone.heldCount()).toBe(1);
  });

  it("ne reprend rien au retour si aucune activité n'est en cours", async () => {
    const phone = installFakePhone();
    const wakeLock = createWakeLockService();
    wakeLock.keepAwake()();
    await settle();

    phone.goToBackground();
    phone.comeBack();
    await settle();
    expect(phone.heldCount()).toBe(0);
  });

  it("rend le verrou quand l'activité finit avant que le téléphone l'ait accordé", async () => {
    const phone = installFakePhone();
    const wakeLock = createWakeLockService();

    wakeLock.keepAwake()();
    await settle();
    expect(phone.heldCount()).toBe(0);
  });

  it("continue sans verrou quand le téléphone le refuse", async () => {
    installFakePhone({ refuses: true });
    const wakeLock = createWakeLockService();

    const release = wakeLock.keepAwake();
    await settle();
    expect(wakeLock.isSupported()).toBe(true);
    expect(wakeLock.isActive()).toBe(false);
    release();
  });

  it("ne fait rien sur un téléphone qui ne connaît pas le verrou d'écran", () => {
    vi.stubGlobal("navigator", {});
    const wakeLock = createWakeLockService();

    expect(wakeLock.isSupported()).toBe(false);
    wakeLock.keepAwake()();
    expect(wakeLock.isActive()).toBe(false);
  });
});

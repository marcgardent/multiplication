export interface WakeLockService {
  // Faux sur les téléphones qui ne savent pas garder l'écran allumé à la demande d'une page
  isSupported(): boolean;
  // Vrai tant que le téléphone a accordé le verrou ; il peut le refuser, en économie d'énergie par exemple
  isActive(): boolean;
  // Garde l'écran allumé jusqu'à l'appel de la fonction renvoyée
  keepAwake(): () => void;
}

// Sans toucher l'écran, le téléphone croit l'application inactive et se met en veille.
// Tant qu'une activité le demande, on tient un verrou d'écran. Le système le retire dès que
// l'application passe en arrière-plan : on le reprend à son retour.
export function createWakeLockService(): WakeLockService {
  const isSupported = typeof navigator !== "undefined" && "wakeLock" in navigator;
  let holders = 0;
  let sentinel: WakeLockSentinel | null = null;
  let isRequesting = false;

  async function sync() {
    if (!isSupported || isRequesting) return;

    if (holders === 0) {
      const held = sentinel;
      sentinel = null;
      await held?.release().catch(() => undefined);
      return;
    }
    if (sentinel || document.visibilityState !== "visible") return;

    isRequesting = true;
    try {
      const requested = await navigator.wakeLock.request("screen");
      requested.addEventListener("release", () => {
        if (sentinel === requested) sentinel = null;
      });
      sentinel = requested;
    } catch (err) {
      // Refusé par le téléphone, en économie d'énergie par exemple : l'activité continue sans verrou
      console.warn("Verrou d'écran refusé", err);
    } finally {
      isRequesting = false;
    }
    // L'activité a pu se terminer pendant la demande
    if (holders === 0) sync();
  }

  if (isSupported) {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") sync();
    });
  }

  return {
    isSupported: () => isSupported,
    isActive: () => sentinel !== null,

    keepAwake(): () => void {
      holders++;
      sync();

      let isReleased = false;
      return () => {
        if (isReleased) return;
        isReleased = true;
        holders--;
        sync();
      };
    }
  };
}

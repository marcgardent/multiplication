import type { HeardSpeech, SpeechListener } from "./speechListener";

// Le bouton à maintenir pour parler, le même partout : séance, test du téléphone, essai de l'espace parent.
// Un appui, une réponse ; seul le dernier appui compte. Un résultat d'un appui précédent, arrivé en retard
// (l'enfant a réappuyé avant la fin), un appui trop bref ou interrompu n'aboutissent jamais à une réponse

// Un appui plus bref ne contient pas une réponse
export const MIN_HOLD_MS = 250;

// « holding » : le doigt est posé ; « thinking » : relâché, la reconnaissance finit la phrase
export type HoldPhase = "idle" | "holding" | "thinking";

export type HoldOutcome =
  | { kind: "heard"; heard: HeardSpeech; releasedAt: number }
  | { kind: "too-short" }
  // Rien n'est revenu de la reconnaissance à temps
  | { kind: "nothing" };

export interface HoldToTalkOptions {
  listener: Pick<SpeechListener, "holdStart" | "holdEnd">;
  onPhase(phase: HoldPhase): void;
  // Ce qui est entendu pendant l'appui en cours, avant la fin de la phrase
  onPartial?(heard: HeardSpeech): void;
  onOutcome(outcome: HoldOutcome): void;
  thinkingMaxMs: number;
  now?: () => number;
}

export interface HoldToTalk {
  // Faux si l'écoute n'est pas prête : rien ne commence
  press(): boolean;
  release(): void;
  // Écoute coupée, fenêtre fermée : l'appui en cours ne donnera rien
  cancel(): void;
  // À brancher sur onHeard de l'écoute
  heard(heard: HeardSpeech): void;
  phase(): HoldPhase;
  // Au doigt comme à la souris ; le relâchement compte même hors du bouton. Renvoie de quoi débrancher
  bind(button: HTMLElement): () => void;
}

export function createHoldToTalk(options: HoldToTalkOptions): HoldToTalk {
  const now = options.now ?? (() => performance.now());
  let phase: HoldPhase = "idle";
  // Phrase de l'appui en cours, seule écoutée
  let phrase: number | null = null;
  let pressedAt = 0;
  let releasedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function setPhase(next: HoldPhase) {
    phase = next;
    options.onPhase(next);
  }

  function settle(outcome: HoldOutcome) {
    clearTimer();
    phrase = null;
    setPhase("idle");
    options.onOutcome(outcome);
  }

  function press(): boolean {
    if (phase === "holding") return true;
    const opened = options.listener.holdStart();
    if (opened === null) return false;
    // Un appui pendant la réflexion remplace le précédent : son résultat ne comptera pas
    clearTimer();
    phrase = opened;
    pressedAt = now();
    setPhase("holding");
    return true;
  }

  function release() {
    if (phase !== "holding") return;
    options.listener.holdEnd();
    if (now() - pressedAt < MIN_HOLD_MS) {
      settle({ kind: "too-short" });
      return;
    }
    releasedAt = now();
    setPhase("thinking");
    timer = setTimeout(() => settle({ kind: "nothing" }), options.thinkingMaxMs);
  }

  function cancel() {
    if (phase === "holding") options.listener.holdEnd();
    clearTimer();
    phrase = null;
    if (phase !== "idle") setPhase("idle");
  }

  function heard(heard: HeardSpeech) {
    if (phrase === null || heard.phrase !== phrase) return;
    if (!heard.isFinal) {
      options.onPartial?.(heard);
      return;
    }
    settle({ kind: "heard", heard, releasedAt });
  }

  function bind(button: HTMLElement): () => void {
    let pointer: number | null = null;
    const down = (e: PointerEvent) => {
      if (e.button > 0) return;
      e.preventDefault();
      if ((button as HTMLButtonElement).disabled || pointer !== null || !press()) return;
      pointer = e.pointerId;
      try {
        button.setPointerCapture(e.pointerId);
      } catch {
        // Pointeur déjà relâché : l'appui s'arrêtera sur pointerup
      }
      navigator.vibrate?.(20);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      release();
    };
    // Écran éteint ou application quittée le doigt posé : l'appui s'arrête là
    const hidden = () => {
      if (document.visibilityState !== "hidden" || pointer === null) return;
      pointer = null;
      release();
    };
    // Un appui long ouvrirait sinon le menu du navigateur
    const menu = (e: Event) => e.preventDefault();
    button.addEventListener("pointerdown", down);
    button.addEventListener("pointerup", up);
    button.addEventListener("pointercancel", up);
    button.addEventListener("lostpointercapture", up);
    button.addEventListener("contextmenu", menu);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      button.removeEventListener("pointerdown", down);
      button.removeEventListener("pointerup", up);
      button.removeEventListener("pointercancel", up);
      button.removeEventListener("lostpointercapture", up);
      button.removeEventListener("contextmenu", menu);
      document.removeEventListener("visibilitychange", hidden);
    };
  }

  return { press, release, cancel, heard, phase: () => phase, bind };
}

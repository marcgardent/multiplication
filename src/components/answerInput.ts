import { AnswerPreferencesStore } from "../services/answerPreferences";
import { AudioService } from "../services/audioService";
import { createHoldToTalk, HoldOutcome } from "../voices/holdToTalk";
import { createSpeechListener, HeardSpeech, SpeechProblem } from "../voices/speechListener";
import { createKeypad, KeypadComponent, KeypadOptions } from "./keypad";

export interface AnswerInputOptions extends KeypadOptions {
  audio: AudioService;
  preferences: AnswerPreferencesStore;
  // Dit à voix haute : « je passe », « réponse », « je ne sais pas »
  onDontKnow(): void;
  // Case de la réponse dans le grand calcul : à la voix, le micro s'y affiche tant que rien n'est entendu
  answerSlot?(): HTMLElement | null;
}

// Bandeau au-dessus du clavier quand l'enfant répond à la voix : où il en est, en une phrase
type SpeechState = "loading" | "wait" | "question" | "listen" | "hearing" | "thinking" | "heard" | "unclear";

// Avec le bouton à maintenir, ce qu'il faut faire se dit autrement
const HOLD_CUES: Partial<Record<SpeechState, string>> = {
  listen: "Maintiens le bouton et dis la réponse.",
  hearing: "Je t'écoute… Relâche quand tu as fini.",
  unclear: "Je n'ai pas compris. Maintiens le bouton et redis."
};
const HOLD_LABELS: Partial<Record<SpeechState, string>> = {
  hearing: "Relâche quand tu as fini",
  thinking: "Je réfléchis…"
};
const HOLD_LABEL = "Maintiens et parle";

const CUES: Record<SpeechState, { icon: string; text: string }> = {
  loading: { icon: "⏳", text: "Je prépare mes oreilles…" },
  wait: { icon: "✋", text: "Attends…" },
  question: { icon: "👂", text: "Écoute la question…" },
  listen: { icon: "🎤", text: "Dis la réponse, puis appuie sur Valider." },
  hearing: { icon: "👂", text: "Je t'entends…" },
  thinking: { icon: "⏳", text: "Je réfléchis…" },
  heard: { icon: "✅", text: "Appuie sur Valider, ou redis la réponse." },
  unclear: { icon: "🤔", text: "Je n'ai pas compris. Redis la réponse." }
};

const PROBLEM_NOTICES: Record<SpeechProblem, string> = {
  "no-mic": "🎤 Le micro ne marche pas : réponds avec le clavier.",
  download: "🎤 La première fois, il faut internet pour préparer la voix : réponds avec le clavier.",
  unavailable: "🎤 La voix ne marche pas sur ce téléphone : réponds avec le clavier."
};

// Le micro se coupe quand l'enfant n'a rien à dire depuis un moment : pause, longue correction
const MIC_IDLE_MS = 4000;
// Après une commande dite, la même phrase ne compte pas deux fois
const AFTER_COMMAND_MS = 800;
// Sans résultat après ce temps de réflexion, l'enfant est invité à redire
const THINKING_MAX_MS = 8000;

// Saisie d'une réponse : le clavier, toujours là, et la voix quand l'enfant l'a choisie.
// Un nombre dit remplit la réponse comme s'il avait été tapé ; c'est Valider qui l'envoie.
// Le temps de réponse s'arrête pourtant au dernier mot prononcé, pas à l'appui sur Valider
export function createAnswerInput(options: AnswerInputOptions): KeypadComponent {
  const { audio, preferences } = options;
  // Dernière réponse dite, tant qu'elle n'a pas été corrigée au clavier
  let spoken: { value: string; at: number } | null = null;
  const keypad = createKeypad({
    ...options,
    // Une touche du clavier remplace aussi ce qui a été dit, et le message de l'essai d'avant
    onInput(digit, value) {
      spoken = null;
      isUnclear = false;
      isTooShort = false;
      options.onInput?.(digit, value);
      render();
    },
    onDelete(value) {
      spoken = null;
      isUnclear = false;
      isTooShort = false;
      options.onDelete?.(value);
      render();
    },
    onSubmit(value) {
      options.onSubmit?.(value, spoken?.value === value ? spoken.at : undefined);
    }
  });
  let isEnabled = true;
  let isSpeechMode = preferences.get().speech;
  let ignoreUntil = 0;
  let isUnclear = false;
  let isLoading = false;
  // L'enfant parle (une phrase est ouverte), puis Vosk la traite : sur un téléphone lent, ça se voit
  let isHearing = false;
  let isThinking = false;
  let thinkingTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let root: HTMLElement | null = null;

  // Au-dessus du clavier : le bouton à maintenir (mode par défaut), et une ligne qui dit quoi faire
  const strip = document.createElement("div");
  strip.className = "speech-strip";
  strip.innerHTML = `
    <button type="button" class="speech-hold"><span class="speech-hold-icon" aria-hidden="true">🎤</span><span class="speech-hold-label"></span></button>
    <span class="speech-cue" aria-live="polite"></span>
    <span class="speech-tips">Tu peux aussi dire « je passe » ou « je ne sais pas ».</span>
  `;
  const cueEl = strip.querySelector(".speech-cue") as HTMLElement;
  const holdBtn = strip.querySelector(".speech-hold") as HTMLButtonElement;
  const holdLabelEl = strip.querySelector(".speech-hold-label") as HTMLElement;
  let isTooShort = false;
  const isHoldMode = () => preferences.listenMode() === "hold";
  // Le micro, à la place de la réponse dans le grand calcul : il respire quand c'est à l'enfant, grossit avec sa voix
  const mic = document.createElement("span");
  mic.className = "answer-mic";
  mic.setAttribute("aria-hidden", "true");
  mic.innerHTML = `<svg viewBox="0 0 24 24"><rect x="9" y="2.5" width="6" height="11.5" rx="3"></rect><path d="M5.5 11a6.5 6.5 0 0 0 13 0"></path><path d="M12 17.5v4M8.5 21.5h7"></path></svg>`;
  const notice = document.createElement("p");
  notice.className = "answer-notice";
  notice.hidden = true;

  const listener = createSpeechListener({
    onHeard: (heard) => (isHoldMode() ? hold.heard(heard) : handleHeard(heard)),
    onProblem(problem) {
      isLoading = false;
      showNotice(PROBLEM_NOTICES[problem]);
      preferences.set({ speech: false });
    },
    onState(listenerState) {
      isLoading = listenerState === "loading";
      render();
    },
    // Le micro de la case grossit avec la voix : l'enfant voit tout de suite qu'il est entendu
    onLevel(level) {
      mic.style.setProperty("--level", level.toFixed(2));
      render();
    },
    // Repérage automatique seulement : avec le bouton, c'est l'appui qui dit où en est l'enfant
    onSpeech(event) {
      if (isHoldMode() || !isListening()) return;
      if (event === "start") {
        isHearing = true;
        isUnclear = false;
      } else {
        isHearing = false;
        setThinking(true);
      }
      render();
    },
    floor: () => preferences.speechCalibration()?.floor,
    mode: () => preferences.listenMode()
  });

  // Maintenir pour parler : un appui, une nouvelle réponse. Elle remplace celle d'avant, dite ou tapée
  const hold = createHoldToTalk({
    listener,
    thinkingMaxMs: THINKING_MAX_MS,
    onPhase(phase) {
      if (phase === "holding") {
        isUnclear = false;
        isTooShort = false;
        if (keypad.getCurrentValue() !== "") {
          keypad.setValue?.("");
          spoken = null;
          options.onDelete?.("");
        }
      }
      render();
    },
    // Le nombre s'affiche dès qu'il est entendu, doigt encore posé
    onPartial: handleHeard,
    onOutcome(outcome: HoldOutcome) {
      if (outcome.kind === "heard") {
        handleHeard(outcome.heard);
        return;
      }
      isTooShort = outcome.kind === "too-short";
      isUnclear = true;
      render();
    }
  });
  const unbindHold = hold.bind(holdBtn);

  function setThinking(thinking: boolean) {
    isThinking = thinking;
    if (thinkingTimer) clearTimeout(thinkingTimer);
    thinkingTimer = null;
    if (!thinking) return;
    thinkingTimer = setTimeout(() => {
      thinkingTimer = null;
      if (!isThinking) return;
      isThinking = false;
      isUnclear = !spoken;
      render();
    }, THINKING_MAX_MS);
  }

  function isListening() {
    return isSpeechMode && isEnabled && !audio.isSpeaking();
  }

  // Le nouvel essai passe avant la réponse d'avant : l'enfant voit qu'on l'écoute, puis s'il a été compris
  function state(): SpeechState {
    if (isLoading) return "loading";
    if (!isEnabled) return "wait";
    if (audio.isSpeaking()) return "question";
    const phase = isHoldMode() ? hold.phase() : isHearing ? "holding" : isThinking ? "thinking" : "idle";
    if (phase === "holding") return "hearing";
    if (phase === "thinking" && !spoken) return "thinking";
    if (isUnclear) return "unclear";
    return spoken ? "heard" : "listen";
  }

  function render() {
    if (!root) return;
    root.classList.toggle("is-speech-mode", isSpeechMode);
    const current = state();
    strip.dataset.state = current;
    mic.dataset.state = current;
    const isHold = isHoldMode();
    const holdText = isTooShort && current === "unclear" ? "Trop court : garde le doigt appuyé pendant que tu parles." : HOLD_CUES[current];
    const text =
      current === "heard" && spoken ? `J'ai compris ${spoken.value} : appuie sur Valider.` : (isHold && holdText) || CUES[current].text;
    cueEl.textContent = `${CUES[current].icon} ${text}`;
    strip.classList.toggle("is-hold-mode", isHold);
    holdBtn.dataset.state = current;
    holdLabelEl.textContent = HOLD_LABELS[current] ?? HOLD_LABEL;
    // Le bouton ne sert que quand une réponse est attendue et que la reconnaissance est prête ; enfoncé, il le reste
    holdBtn.disabled = hold.phase() !== "holding" && (!isListening() || current === "loading" || !listener.isReady());
    if (!isListening()) mic.style.setProperty("--level", "0");
    renderSlot();
  }

  // Le micro occupe la case de la réponse tant qu'une réponse est attendue et que rien n'y est écrit.
  // Hors de ces moments, la case appartient à la séance (réponse donnée, correction)
  function renderSlot() {
    const slot = options.answerSlot?.();
    if (!slot) return;
    const isShown = isSpeechMode && isEnabled && keypad.getCurrentValue() === "";
    if (isShown && !slot.contains(mic)) {
      slot.textContent = "";
      slot.appendChild(mic);
    } else if (!isShown && slot.contains(mic)) {
      mic.remove();
      slot.textContent = keypad.getCurrentValue() || "_";
    }
  }

  // Vosk n'entend que pendant qu'une réponse est attendue : ni la question lue, ni la correction.
  // Le micro reste ouvert entre deux questions, et se coupe après un long moment sans rien à répondre (pause)
  function updateMic() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    if (!isSpeechMode) {
      listener.release();
    } else if (isListening()) {
      listener.start();
    } else {
      isHearing = false;
      setThinking(false);
      hold.cancel();
      listener.stop();
      if (!isEnabled) idleTimer = setTimeout(() => listener.release(), MIC_IDLE_MS);
    }
  }

  function handleHeard(heard: HeardSpeech) {
    if (!isListening() || performance.now() < ignoreUntil) return;
    const { guess, isFinal } = heard;
    if (isFinal) setThinking(false);

    if (guess?.kind === "number") {
      // Comme tapé au clavier, dès que le nombre est entendu, sans attendre la fin de la phrase : la réponse s'affiche,
      // Valider l'enverra. La phrase finie confirme le nombre et donne l'heure exacte du dernier mot
      isUnclear = false;
      const value = String(guess.value);
      keypad.setValue?.(value);
      options.onInput?.("", value);
      spoken = { value, at: heard.spokenAt ?? performance.now() };
    } else if (!isFinal) {
      // Phrase en cours sans nombre : « Je t'entends » suffit
      return;
    } else if (guess) {
      // « Je passe », « je ne sais pas » : aussi clair que le bouton, envoyé tout de suite
      isUnclear = false;
      ignoreUntil = performance.now() + AFTER_COMMAND_MS;
      options.onDontKnow();
    } else if (!/\bfois\b/i.test(heard.transcript)) {
      // Phrase finie sans réponse ; la question répétée par l'enfant, elle, n'est pas une erreur
      isUnclear = true;
    }
    render();
  }

  function showNotice(text: string) {
    notice.textContent = text;
    notice.hidden = false;
    setTimeout(() => {
      notice.hidden = true;
    }, 5000);
  }

  const unsubscribePreferences = preferences.subscribe((p) => {
    render();
    if (p.speech === isSpeechMode) return;
    isSpeechMode = p.speech;
    isUnclear = false;
    updateMic();
    render();
  });
  const unsubscribeSpeaking = audio.onSpeakingChange(() => {
    updateMic();
    render();
  });

  return {
    mount(parent: HTMLElement) {
      root = parent;
      parent.classList.add("answer-input");
      parent.appendChild(notice);
      parent.appendChild(strip);
      keypad.mount(parent);
      updateMic();
      render();
    },

    destroy() {
      unbindHold();
      hold.cancel();
      unsubscribePreferences();
      unsubscribeSpeaking();
      if (idleTimer) clearTimeout(idleTimer);
      setThinking(false);
      listener.release();
      keypad.destroy();
      strip.remove();
      mic.remove();
      notice.remove();
      root?.classList.remove("answer-input", "is-speech-mode");
      root = null;
    },

    // Nouvelle question, ou réponse fausse effacée : un essai en cours ne doit pas y écrire après coup
    clear() {
      hold.cancel();
      keypad.clear();
      spoken = null;
      isUnclear = false;
      isTooShort = false;
      render();
    },

    getCurrentValue: () => keypad.getCurrentValue(),

    setEnabled(enabled: boolean) {
      keypad.setEnabled(enabled);
      if (enabled === isEnabled) return;
      isEnabled = enabled;
      updateMic();
      render();
    }
  };
}

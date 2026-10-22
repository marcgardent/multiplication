import { AnswerPreferencesStore } from "../services/answerPreferences";
import { AudioService } from "../services/audioService";
import { createSpeechListener, HeardSpeech, SpeechProblem } from "../voices/speechListener";
import { createKeypad, KeypadComponent, KeypadOptions } from "./keypad";

export interface AnswerInputOptions extends KeypadOptions {
  audio: AudioService;
  preferences: AnswerPreferencesStore;
  // Dit à voix haute : « je passe », « réponse », « je ne sais pas »
  onDontKnow(): void;
}

// Bandeau au-dessus du clavier quand l'enfant répond à la voix : où il en est, en une phrase
type SpeechState = "loading" | "wait" | "question" | "listen" | "heard" | "unclear";

const CUES: Record<SpeechState, { icon: string; text: string }> = {
  loading: { icon: "⏳", text: "Je prépare mes oreilles…" },
  wait: { icon: "✋", text: "Attends…" },
  question: { icon: "👂", text: "Écoute la question…" },
  listen: { icon: "🎤", text: "Dis la réponse, puis appuie sur Valider." },
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

// Saisie d'une réponse : le clavier, toujours là, et la voix quand l'enfant l'a choisie.
// Un nombre dit remplit la réponse comme s'il avait été tapé ; c'est Valider qui l'envoie.
// Le temps de réponse s'arrête pourtant au dernier mot prononcé, pas à l'appui sur Valider
export function createAnswerInput(options: AnswerInputOptions): KeypadComponent {
  const { audio, preferences } = options;
  // Dernière réponse dite, tant qu'elle n'a pas été corrigée au clavier
  let spoken: { value: string; at: number } | null = null;
  const keypad = createKeypad({
    ...options,
    onInput(digit, value) {
      spoken = null;
      options.onInput?.(digit, value);
    },
    onDelete(value) {
      spoken = null;
      options.onDelete?.(value);
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
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let root: HTMLElement | null = null;

  const strip = document.createElement("div");
  strip.className = "speech-strip";
  strip.innerHTML = `
    <span class="speech-mic" aria-hidden="true"></span>
    <span class="speech-texts">
      <span class="speech-cue" aria-live="polite"></span>
      <span class="speech-tips">Tu peux aussi dire « je passe » ou « je ne sais pas ».</span>
    </span>
  `;
  const micEl = strip.querySelector(".speech-mic") as HTMLElement;
  const cueEl = strip.querySelector(".speech-cue") as HTMLElement;
  const notice = document.createElement("p");
  notice.className = "answer-notice";
  notice.hidden = true;

  const listener = createSpeechListener({
    onHeard: handleHeard,
    onProblem(problem) {
      isLoading = false;
      showNotice(PROBLEM_NOTICES[problem]);
      preferences.set({ speech: false });
    },
    onState(listenerState) {
      isLoading = listenerState === "loading";
      render();
    }
  });

  function isListening() {
    return isSpeechMode && isEnabled && !audio.isSpeaking();
  }

  function state(): SpeechState {
    if (isLoading) return "loading";
    if (!isEnabled) return "wait";
    if (audio.isSpeaking()) return "question";
    if (isUnclear) return "unclear";
    return spoken ? "heard" : "listen";
  }

  function render() {
    if (!root) return;
    root.classList.toggle("is-speech-mode", isSpeechMode);
    const current = state();
    strip.dataset.state = current;
    micEl.textContent = CUES[current].icon;
    cueEl.textContent = CUES[current].text;
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
      listener.stop();
      if (!isEnabled) idleTimer = setTimeout(() => listener.release(), MIC_IDLE_MS);
    }
  }

  function handleHeard(heard: HeardSpeech) {
    if (!isListening() || performance.now() < ignoreUntil || !heard.isFinal) return;
    const { guess } = heard;

    if (guess?.kind === "number") {
      // Comme tapé au clavier : la réponse s'affiche, Valider l'enverra
      isUnclear = false;
      const value = String(guess.value);
      keypad.setValue?.(value);
      options.onInput?.("", value);
      spoken = { value, at: heard.spokenAt ?? performance.now() };
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
      unsubscribePreferences();
      unsubscribeSpeaking();
      if (idleTimer) clearTimeout(idleTimer);
      listener.release();
      keypad.destroy();
      strip.remove();
      notice.remove();
      root?.classList.remove("answer-input", "is-speech-mode");
      root = null;
    },

    clear() {
      keypad.clear();
      spoken = null;
      isUnclear = false;
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

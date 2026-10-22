import { AnswerPreferencesStore, CalibrationVerdict, SpeechCalibration } from "../services/answerPreferences";
import {
  CALIBRATION_TARGETS,
  calibrationLevel,
  calibrationVerdict,
  LEVEL_COUNT,
  measureSpeed,
  medianOf,
  speechFloor
} from "../voices/speechCalibration";
import { createSpeechListener, HeardSpeech } from "../voices/speechListener";
import { downloadVoiceModel, isVoiceModelDownloaded } from "../voices/voiceModel";

// « Test du téléphone » : pensé pour n'importe quel adulte, sans chiffres ni jargon.
// 1. performance, tout seul ; 2. silence ; 3. trois nombres, en appuyant longtemps dessus ; puis un bilan en une jauge

const SILENCE_MS = 3000;
const THINKING_MAX_MS = 20000;
const MIN_HOLD_MS = 250;

const LABELS: Record<CalibrationVerdict, string> = {
  fast: "Conseillé",
  slow: "Praticable",
  unusable: "Non conseillé"
};

const SENTENCES: Record<CalibrationVerdict, string> = {
  fast: "La réponse à voix haute marche bien sur ce téléphone.",
  slow: "Elle marche, avec un petit temps d'attente après chaque réponse.",
  unusable: "Elle marche mal sur ce téléphone : mieux vaut le clavier."
};

const BADGES: Record<CalibrationVerdict, string> = {
  fast: "✅ Conseillé sur ce téléphone.",
  slow: "🟡 Praticable sur ce téléphone : un peu d'attente après chaque réponse.",
  unusable: "❌ Non conseillé sur ce téléphone : mieux vaut le clavier."
};

// Résultat du dernier test, en une ligne, pour l'espace parent
export function calibrationSummary(calibration: SpeechCalibration): string {
  return BADGES[calibration.verdict];
}

interface Attempt {
  isRight: boolean;
  latencyMs: number | null;
}

export function openCalibrationModal(options: { preferences: AnswerPreferencesStore; onDone(): void }): void {
  const modal = document.createElement("div");
  modal.className = "session-modal-overlay";
  const box = document.createElement("div");
  box.className = "session-modal-container prompt-choice-modal calibration-modal";
  modal.appendChild(box);

  let realTimeFactor = 0;
  let noise = 0;
  let voice: number | null = null;
  const attempts = new Map<number, Attempt>();

  let onLevel: ((level: number, rms: number) => void) | null = null;
  let onFinal: ((heard: HeardSpeech) => void) | null = null;
  let isSpeaking = false;
  let speechPeak = 0;
  const listener = createSpeechListener({
    mode: () => "hold",
    onHeard(heard) {
      if (heard.isFinal) onFinal?.(heard);
    },
    onProblem() {
      showVerdict(null);
    },
    onLevel(level, rms) {
      if (isSpeaking) speechPeak = Math.max(speechPeak, rms);
      onLevel?.(level, rms);
    },
    onSpeech(event) {
      isSpeaking = event === "start";
    }
  });

  function close() {
    listener.release();
    modal.remove();
  }

  function screen(title: string, body: string, actions = "") {
    box.innerHTML = `
      <div class="prompt-header">
        <h3>${title}</h3>
        <button type="button" class="btn-modal-close" data-action="close" aria-label="Fermer">✕</button>
      </div>
      ${body}
      <div class="calibration-actions">${actions}</div>
    `;
    box.querySelector('[data-action="close"]')?.addEventListener("click", close);
  }
  const on = (action: string, handler: () => void) => box.querySelector(`[data-action="${action}"]`)?.addEventListener("click", handler);

  const loader = (text: string) =>
    screen("Test du téléphone", `<div class="calibration-loader" role="status"><span class="calibration-spinner" aria-hidden="true"></span><span>${text}</span></div>`);

  // 1. Performance : tout seul, rien à faire. La première fois, la reconnaissance s'installe d'abord
  async function runSpeed() {
    try {
      if (!(await isVoiceModelDownloaded())) {
        loader("Installation");
        await downloadVoiceModel();
        if (!modal.isConnected) return;
      }
      loader("Test de performance");
      const speed = await measureSpeed();
      if (!modal.isConnected) return;
      if (speed.realTimeFactor === null) {
        showVerdict(null);
        return;
      }
      realTimeFactor = speed.realTimeFactor;
      listener.start();
      showSilence();
    } catch (err) {
      console.warn("Test du téléphone : performance", err);
      showVerdict(null);
    }
  }

  // 2. Silence : le bruit de la pièce
  function showSilence() {
    screen(
      "Silence",
      `<div class="calibration-big" aria-hidden="true">🤫</div>
       <div class="calibration-progress" aria-hidden="true"><span id="progress"></span></div>`,
      `<button type="button" class="btn-confirm-launch" data-action="start">C'est parti</button>`
    );
    on("start", async () => {
      const button = box.querySelector('[data-action="start"]') as HTMLButtonElement;
      button.hidden = true;
      const progress = box.querySelector("#progress") as HTMLElement;
      // La barre se remplit pendant les trois secondes d'écoute
      progress.style.transitionDuration = `${SILENCE_MS}ms`;
      requestAnimationFrame(() => (progress.style.width = "100%"));
      const levels: number[] = [];
      onLevel = (_level, rms) => levels.push(rms);
      await new Promise((resolve) => setTimeout(resolve, SILENCE_MS));
      onLevel = null;
      if (!modal.isConnected) return;
      if (levels.length === 0) {
        showVerdict(null);
        return;
      }
      noise = medianOf(levels);
      showNumber(0);
    });
  }

  // 3. Trois nombres : on appuie longtemps sur le nombre et on le dit. Il devient 🎤, puis ⏳, puis vert ou rouge
  function showNumber(index: number) {
    const target = CALIBRATION_TARGETS[index];
    const dots = CALIBRATION_TARGETS.map((_, i) => `<span class="${i <= index ? "is-on" : ""}"></span>`).join("");
    screen(
      "Appuie longtemps sur le nombre et dis-le",
      `<div class="calibration-dots" aria-hidden="true">${dots}</div>
       <button type="button" class="calibration-number" id="number" aria-label="Maintenir et dire ${target}">${target}</button>`,
      `<button type="button" class="btn-confirm-launch" data-action="next" hidden>${index + 1 < CALIBRATION_TARGETS.length ? "Suivant" : "Voir le résultat"}</button>`
    );
    const tile = box.querySelector("#number") as HTMLButtonElement;
    const next = box.querySelector('[data-action="next"]') as HTMLButtonElement;
    let pressedAt = 0;
    let releasedAt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const show = (state: "idle" | "listening" | "thinking" | "right" | "wrong") => {
      tile.dataset.state = state;
      tile.textContent = state === "listening" ? "🎤" : state === "thinking" ? "⏳" : String(target);
    };
    const record = (attempt: Attempt) => {
      if (timer) clearTimeout(timer);
      timer = null;
      onFinal = null;
      attempts.set(target, attempt);
      show(attempt.isRight ? "right" : "wrong");
      next.hidden = false;
    };

    tile.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (tile.dataset.state === "thinking") return;
      try {
        tile.setPointerCapture(e.pointerId);
      } catch {
        // Pointeur déjà relâché : l'appui s'arrêtera sur pointerup
      }
      pressedAt = performance.now();
      speechPeak = 0;
      show("listening");
      navigator.vibrate?.(20);
      listener.holdStart();
    });
    const release = () => {
      if (pressedAt === 0) return;
      const heldMs = performance.now() - pressedAt;
      pressedAt = 0;
      releasedAt = performance.now();
      listener.holdEnd();
      // Un appui trop bref : le nombre revient, on peut réessayer
      if (heldMs < MIN_HOLD_MS) {
        show(attempts.has(target) ? (attempts.get(target)?.isRight ? "right" : "wrong") : "idle");
        return;
      }
      if (speechPeak > 0) voice = Math.max(voice ?? 0, speechPeak);
      show("thinking");
      onFinal = (heard) => {
        const isRight = heard.guess?.kind === "number" && heard.guess.value === target;
        record({ isRight, latencyMs: Math.round(performance.now() - releasedAt) });
      };
      timer = setTimeout(() => record({ isRight: false, latencyMs: null }), THINKING_MAX_MS);
    };
    tile.addEventListener("pointerup", release);
    tile.addEventListener("pointercancel", release);
    tile.addEventListener("contextmenu", (e) => e.preventDefault());
    show("idle");

    on("next", () => (index + 1 < CALIBRATION_TARGETS.length ? showNumber(index + 1) : showVerdict(finish())));
  }

  // Le résultat, retenu pour ce téléphone
  function finish(): SpeechCalibration {
    const all = [...attempts.values()];
    const correct = all.filter((a) => a.isRight).length;
    const latencies = all.filter((a) => a.latencyMs !== null).map((a) => a.latencyMs as number);
    const latencyMs = latencies.length > 0 ? Math.round(medianOf(latencies)) : null;
    const total = CALIBRATION_TARGETS.length;
    const calibration: SpeechCalibration = {
      at: Date.now(),
      realTimeFactor,
      latencyMs,
      noise,
      voice,
      floor: speechFloor(noise, voice),
      correct,
      total,
      verdict: calibrationVerdict({ latencyMs, correct, total })
    };
    options.preferences.setSpeechCalibration(calibration);
    options.onDone();
    return calibration;
  }

  // Bilan : une jauge, un mot, une phrase. Sans résultat (micro refusé, téléphone qui n'y arrive pas) : non conseillé
  function showVerdict(calibration: SpeechCalibration | null) {
    listener.release();
    onLevel = null;
    onFinal = null;
    const verdict: CalibrationVerdict = calibration?.verdict ?? "unusable";
    const level = calibration ? calibrationLevel(calibration) : 1;
    const segments = Array.from({ length: LEVEL_COUNT }, (_, i) => `<span class="${i < level ? "is-on" : ""}"></span>`).join("");
    screen(
      "Résultat",
      `<div class="calibration-gauge" data-verdict="${verdict}" role="img" aria-label="${LABELS[verdict]}, niveau ${level} sur ${LEVEL_COUNT}">${segments}</div>
       <p class="calibration-label" data-verdict="${verdict}">${LABELS[verdict]}</p>
       <p class="calibration-sentence">${calibration ? SENTENCES[verdict] : "Le micro ou la reconnaissance ne marche pas sur ce téléphone."}</p>`,
      `<button type="button" class="btn-choice-helper" data-action="again">Refaire le test</button><button type="button" class="btn-confirm-launch" data-action="done">Terminer</button>`
    );
    on("again", () => {
      attempts.clear();
      voice = null;
      runSpeed();
    });
    on("done", close);
  }

  document.body.appendChild(modal);
  runSpeed();
}

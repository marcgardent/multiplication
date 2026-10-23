import { AnswerPreferencesStore, CalibrationVerdict, SpeechCalibration } from "../services/answerPreferences";
import {
  CALIBRATION_TARGETS,
  calibrationLevel,
  calibrationVerdict,
  LEVEL_COUNT,
  medianOf,
  speechFloor
} from "../voices/speechCalibration";
import { createHoldToTalk, HoldOutcome, HoldPhase } from "../voices/holdToTalk";
import { createSpeechListener } from "../voices/speechListener";
import { downloadVoiceModel, isVoiceModelDownloaded, loadVoiceModel } from "../voices/voiceModel";

// « Test du téléphone » : pensé pour n'importe quel adulte, sans chiffres ni jargon.
// 1. préparation, toute seule ; 2. silence ; 3. trois nombres, en maintenant le bouton ; puis un bilan en une jauge.
// Le verdict ne tient qu'à l'attente réelle après chaque nombre dit : pas de mesure de vitesse à part

const SILENCE_MS = 10000;
const THINKING_MAX_MS = 20000;

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

  let noise = 0;
  let voice: number | null = null;
  const attempts = new Map<number, Attempt>();

  let onLevel: ((level: number, rms: number) => void) | null = null;
  let onReady: (() => void) | null = null;
  let speechPeak = 0;
  const listener = createSpeechListener({
    mode: () => "hold",
    onHeard: (heard) => hold.heard(heard),
    onProblem() {
      showVerdict(null);
    },
    onState(state) {
      if (state === "ready") onReady?.();
    },
    onLevel(level, rms) {
      if (hold.phase() === "holding") speechPeak = Math.max(speechPeak, rms);
      onLevel?.(level, rms);
    }
  });
  // Le même bouton à maintenir que pour les enfants ; chaque écran de nombre y branche sa tuile
  let onPhase: ((phase: HoldPhase) => void) | null = null;
  let onOutcome: ((outcome: HoldOutcome) => void) | null = null;
  let unbindTile: (() => void) | null = null;
  const hold = createHoldToTalk({
    listener,
    thinkingMaxMs: THINKING_MAX_MS,
    onPhase: (phase) => onPhase?.(phase),
    onOutcome: (outcome) => onOutcome?.(outcome)
  });

  function close() {
    leaveScreen();
    listener.release();
    modal.remove();
  }

  // En quittant un écran, l'appui en cours ne donne plus rien
  function leaveScreen() {
    unbindTile?.();
    unbindTile = null;
    onPhase = null;
    onOutcome = null;
    hold.cancel();
  }

  function screen(title: string, body: string, actions = "") {
    leaveScreen();
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

  // Le micro ouvert et la reconnaissance prête à écouter
  const listenerReady = () =>
    new Promise<void>((resolve) => {
      onReady = () => {
        onReady = null;
        resolve();
      };
      listener.start();
      if (listener.isReady()) onReady();
    });

  // 1. Préparation : rien à faire. La première fois, la reconnaissance s'installe d'abord ; elle est chargée,
  // et le micro ouvert, avant le silence et le premier nombre, pour que ça ne compte pas dans la mesure
  async function runPreparation() {
    try {
      if (!(await isVoiceModelDownloaded())) {
        loader("Installation");
        await downloadVoiceModel();
        if (!modal.isConnected) return;
      }
      loader("Préparation");
      await loadVoiceModel();
      if (!modal.isConnected) return;
      await listenerReady();
      if (!modal.isConnected) return;
      showSilence();
    } catch (err) {
      console.warn("Test du téléphone : préparation", err);
      showVerdict(null);
    }
  }

  // 2. Silence : le bruit de la pièce
  function showSilence() {
    screen(
      "Faites silence 10 secondes",
      `<div class="calibration-big" aria-hidden="true">🤫</div>
       <div class="calibration-progress" aria-hidden="true"><span id="progress"></span></div>`,
      `<button type="button" class="btn-confirm-launch" data-action="start">C'est parti</button>`
    );
    on("start", async () => {
      const button = box.querySelector('[data-action="start"]') as HTMLButtonElement;
      button.hidden = true;
      const progress = box.querySelector("#progress") as HTMLElement;
      // La barre se remplit pendant l'écoute
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

  // 3. Trois nombres : on maintient le bouton du nombre et on le dit. Il devient 🎤, puis ⏳, puis vert ou rouge
  function showNumber(index: number) {
    const target = CALIBRATION_TARGETS[index];
    const dots = CALIBRATION_TARGETS.map((_, i) => `<span class="${i <= index ? "is-on" : ""}"></span>`).join("");
    screen(
      `Maintenez le bouton et prononcez ${target}`,
      `<div class="calibration-dots" aria-hidden="true">${dots}</div>
       <button type="button" class="calibration-number" id="number" aria-label="Maintenir et dire ${target}">${target}</button>`,
      `<button type="button" class="btn-confirm-launch" data-action="next" hidden>${index + 1 < CALIBRATION_TARGETS.length ? "Suivant" : "Voir le résultat"}</button>`
    );
    const tile = box.querySelector("#number") as HTMLButtonElement;
    const next = box.querySelector('[data-action="next"]') as HTMLButtonElement;

    const show = (state: "idle" | "listening" | "thinking" | "right" | "wrong") => {
      tile.dataset.state = state;
      tile.textContent = state === "listening" ? "🎤" : state === "thinking" ? "⏳" : String(target);
    };
    // Le dernier essai de ce nombre, s'il y en a un
    const shown = () => {
      const attempt = attempts.get(target);
      return attempt ? (attempt.isRight ? "right" : "wrong") : "idle";
    };

    // Réappuyer, même pendant ⏳, recommence ce nombre : seul le dernier essai compte
    onPhase = (phase) => {
      if (phase === "holding") {
        speechPeak = 0;
        show("listening");
      } else if (phase === "thinking") {
        if (speechPeak > 0) voice = Math.max(voice ?? 0, speechPeak);
        show("thinking");
      }
    };
    onOutcome = (outcome) => {
      // Un appui trop bref : le nombre revient, on peut réessayer
      if (outcome.kind === "too-short") {
        show(shown());
        return;
      }
      const isRight = outcome.kind === "heard" && outcome.heard.guess?.kind === "number" && outcome.heard.guess.value === target;
      const latencyMs = outcome.kind === "heard" ? Math.round(performance.now() - outcome.releasedAt) : null;
      attempts.set(target, { isRight, latencyMs });
      show(isRight ? "right" : "wrong");
      next.hidden = false;
    };
    unbindTile = hold.bind(tile);
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
    onReady = null;
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
      runPreparation();
    });
    on("done", close);
  }

  document.body.appendChild(modal);
  runPreparation();
}

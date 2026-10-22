import { AnswerPreferencesStore, SpeechCalibration } from "../services/answerPreferences";
import { CALIBRATION_TARGETS, calibrationVerdict, measureSpeed, medianOf, speechFloor } from "../voices/speechCalibration";
import { createSpeechListener, HeardSpeech } from "../voices/speechListener";
import { MODEL_SIZE_MB } from "../voices/voiceModel";

// Temps de silence mesuré, et temps laissé pour dire chaque nombre
const SILENCE_MS = 3000;
const TARGET_TIMEOUT_MS = 12000;

type StepState = "todo" | "running" | "done" | "failed";

const STEP_ICONS: Record<StepState, string> = { todo: "○", running: "⏳", done: "✓", failed: "✗" };

const seconds = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} s`;

// Phrase du verdict, aussi affichée dans l'espace parent
export function calibrationSummary(calibration: SpeechCalibration): string {
  const wait = calibration.latencyMs === null ? "" : seconds(calibration.latencyMs);
  if (calibration.verdict === "fast") return `✅ Rapide : réponse comprise ${wait} après le dernier mot.`;
  if (calibration.verdict === "slow") return `🟡 Lent mais utilisable : environ ${wait} d'attente après chaque réponse.`;
  return calibration.correct < 2
    ? "❌ La voix n'est pas assez bien comprise sur ce téléphone : mieux vaut le clavier."
    : `❌ Trop lent : ${wait} d'attente après chaque réponse. Sur ce téléphone, mieux vaut le clavier.`;
}

// Espace parent : mesure si la réponse à voix haute est utilisable sur ce téléphone, et règle le seuil de la parole
export function openCalibrationModal(options: { preferences: AnswerPreferencesStore; onDone(): void }): void {
  const modal = document.createElement("div");
  modal.className = "session-modal-overlay";
  modal.innerHTML = `
    <div class="session-modal-container prompt-choice-modal calibration-modal">
      <div class="prompt-header">
        <h3>📏 Calibrage de ce téléphone</h3>
        <button type="button" class="btn-modal-close" id="btn-calibration-close" aria-label="Fermer">✕</button>
      </div>
      <p class="calibration-help">Trois étapes, une minute environ. Le résultat est retenu pour ce téléphone.</p>

      <ol class="calibration-steps">
        <li data-step="speed"><span class="calibration-step-icon"></span><span><strong>Vitesse</strong><small id="calibration-speed">Le téléphone reconnaît 10 secondes de voix enregistrée. Rien à dire.</small></span></li>
        <li data-step="silence"><span class="calibration-step-icon"></span><span><strong>Silence</strong><small id="calibration-silence">Trois secondes sans parler, pour écouter le bruit de la pièce.</small></span></li>
        <li data-step="voice"><span class="calibration-step-icon"></span><span><strong>Voix</strong><small id="calibration-voice">Dire trois nombres, normalement, à la distance habituelle.</small></span></li>
      </ol>

      <div class="calibration-prompt" id="calibration-prompt" hidden>
        <span class="calibration-prompt-label" id="calibration-prompt-label"></span>
        <span class="calibration-prompt-text" id="calibration-prompt-text"></span>
        <div class="speech-test-level" aria-hidden="true"><span id="calibration-level"></span></div>
      </div>

      <p class="calibration-verdict" id="calibration-verdict" hidden></p>

      <button type="button" class="btn-confirm-launch" id="btn-calibration-start">Commencer</button>
    </div>
  `;

  const promptEl = modal.querySelector("#calibration-prompt") as HTMLElement;
  const promptLabelEl = modal.querySelector("#calibration-prompt-label") as HTMLElement;
  const promptTextEl = modal.querySelector("#calibration-prompt-text") as HTMLElement;
  const levelEl = modal.querySelector("#calibration-level") as HTMLElement;
  const verdictEl = modal.querySelector("#calibration-verdict") as HTMLElement;
  const startBtn = modal.querySelector("#btn-calibration-start") as HTMLButtonElement;
  const detail = (id: string) => modal.querySelector(`#calibration-${id}`) as HTMLElement;

  function setStep(step: "speed" | "silence" | "voice", state: StepState, text?: string) {
    const item = modal.querySelector(`[data-step="${step}"]`) as HTMLElement;
    item.dataset.state = state;
    (item.querySelector(".calibration-step-icon") as HTMLElement).textContent = STEP_ICONS[state];
    if (text) detail(step).textContent = text;
  }
  (["speed", "silence", "voice"] as const).forEach((step) => setStep(step, "todo"));

  // Écoute partagée par les étapes Silence et Voix : volumes bruts, phrases, nombres compris
  let levels: number[] = [];
  let speechPeak = 0;
  let isInSpeech = false;
  let onFinal: ((heard: HeardSpeech, at: number) => void) | null = null;
  let isClosed = false;
  const listener = createSpeechListener({
    onHeard(heard) {
      if (heard.isFinal) onFinal?.(heard, performance.now());
    },
    onProblem() {
      fail("Le micro ou la reconnaissance ne marche pas sur ce téléphone.");
    },
    onLevel(level, rms) {
      levelEl.style.width = `${Math.round(level * 100)}%`;
      levels.push(rms);
      if (isInSpeech) speechPeak = Math.max(speechPeak, rms);
    },
    onSpeech(event) {
      isInSpeech = event === "start";
    }
  });

  function fail(text: string) {
    verdictEl.hidden = false;
    verdictEl.textContent = `❌ ${text}`;
    startBtn.disabled = false;
    startBtn.textContent = "Recommencer";
    listener.release();
  }

  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // Attend le prochain nombre compris, ou rien après le délai
  function nextFinal(): Promise<{ heard: HeardSpeech; at: number } | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        onFinal = null;
        resolve(null);
      }, TARGET_TIMEOUT_MS);
      onFinal = (heard, at) => {
        if (!heard.transcript) return;
        clearTimeout(timer);
        onFinal = null;
        resolve({ heard, at });
      };
    });
  }

  async function run() {
    startBtn.disabled = true;
    startBtn.textContent = "Calibrage en cours…";
    verdictEl.hidden = true;
    (["speed", "silence", "voice"] as const).forEach((step) => setStep(step, "todo"));

    // 1. Vitesse : sans micro, sur les voix de l'application
    setStep("speed", "running", `Préparation du modèle vocal (${MODEL_SIZE_MB} Mo la première fois), puis mesure…`);
    let speed;
    try {
      speed = await measureSpeed();
    } catch (err) {
      console.warn("Calibrage : vitesse", err);
      setStep("speed", "failed", "La reconnaissance n'a pas pu se charger.");
      fail("Le modèle vocal n'a pas pu se charger : il faut internet la première fois.");
      return;
    }
    if (isClosed) return;
    const rtf = speed.realTimeFactor;
    setStep(
      "speed",
      rtf === null ? "failed" : "done",
      rtf === null
        ? "Aucun résultat : ce téléphone n'arrive pas à faire tourner la reconnaissance."
        : `${seconds(rtf * 1000)} de calcul pour 1 seconde de parole.${speed.loadMs > 1500 ? ` Chargement : ${seconds(speed.loadMs)}.` : ""}`
    );
    if (rtf === null) {
      fail("Ce téléphone n'arrive pas à faire tourner la reconnaissance.");
      return;
    }

    // 2. Silence : le bruit de la pièce
    setStep("silence", "running", "Ne parlez pas…");
    promptEl.hidden = false;
    promptLabelEl.textContent = "Silence";
    promptTextEl.textContent = "🤫";
    levels = [];
    listener.start();
    await wait(SILENCE_MS);
    if (isClosed) return;
    const noise = medianOf(levels);
    setStep("silence", "done", levels.length === 0 ? "Le micro n'a rien envoyé." : "Bruit de la pièce mesuré.");
    if (levels.length === 0) {
      fail("Le micro n'envoie rien : vérifiez qu'il est autorisé pour l'application.");
      return;
    }

    // 3. Voix : trois nombres
    setStep("voice", "running", "Dites le nombre affiché.");
    const latencies: number[] = [];
    let correct = 0;
    let voice: number | null = null;
    for (const [index, target] of CALIBRATION_TARGETS.entries()) {
      promptLabelEl.textContent = `Dites (${index + 1}/${CALIBRATION_TARGETS.length})`;
      promptTextEl.textContent = String(target);
      speechPeak = 0;
      const result = await nextFinal();
      if (isClosed) return;
      if (speechPeak > 0) voice = Math.max(voice ?? 0, speechPeak);
      if (!result) {
        detail("voice").textContent = `${target} : rien de compris.`;
        continue;
      }
      const isRight = result.heard.guess?.kind === "number" && result.heard.guess.value === target;
      if (isRight) correct++;
      if (result.heard.spokenAt !== undefined) latencies.push(result.at - result.heard.spokenAt);
      detail("voice").textContent = `${target} : ${isRight ? "✓" : "✗"} « ${result.heard.transcript} »`;
      await wait(600);
    }
    listener.release();
    promptEl.hidden = true;
    setStep("voice", correct > 0 ? "done" : "failed", `${correct} nombre${correct > 1 ? "s" : ""} sur ${CALIBRATION_TARGETS.length} compris.`);

    // Verdict, retenu pour ce téléphone ; le seuil de la parole s'applique dès la prochaine séance
    const latencyMs = latencies.length > 0 ? Math.round(medianOf(latencies)) : null;
    const calibration: SpeechCalibration = {
      at: Date.now(),
      realTimeFactor: rtf,
      latencyMs,
      noise,
      voice,
      floor: speechFloor(noise, voice),
      correct,
      total: CALIBRATION_TARGETS.length,
      verdict: calibrationVerdict({ latencyMs, correct, total: CALIBRATION_TARGETS.length })
    };
    options.preferences.setSpeechCalibration(calibration);
    const isQuiet = voice !== null && voice < noise * 3;
    verdictEl.hidden = false;
    verdictEl.textContent = `${calibrationSummary(calibration)}${isQuiet ? " La voix est faible par rapport au bruit de la pièce : parlez plus près du téléphone." : ""}`;
    verdictEl.dataset.verdict = calibration.verdict;
    startBtn.disabled = false;
    startBtn.textContent = "Recommencer";
    options.onDone();
  }

  startBtn.addEventListener("click", () => {
    run().catch((err) => {
      console.warn("Calibrage", err);
      fail("Le calibrage s'est interrompu.");
    });
  });
  modal.querySelector("#btn-calibration-close")?.addEventListener("click", () => {
    isClosed = true;
    onFinal = null;
    listener.release();
    modal.remove();
  });

  document.body.appendChild(modal);
}

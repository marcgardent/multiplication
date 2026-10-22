import { cleanRecording, MicRecorder, openMicRecorder } from "../voices/micRecorder";
import { KIND_TITLES, nextToRecord, VoiceClip } from "../voices/voiceCatalog";
import { VoiceStore } from "../voices/voiceStore";

export interface VoiceRecordOptions {
  clip: VoiceClip;
  // File d'enregistrement, dans l'ordre proposé par l'application
  order: VoiceClip[];
  // Voix déjà enregistrées ; mise à jour au fil des enregistrements
  recorded: Set<string>;
  store: VoiceStore;
  onChange(): void;
}

type Phase = "idle" | "recording" | "processing" | "done";

// Un appui plus bref ne peut pas contenir une phrase
const MIN_HOLD_MS = 300;

const LEGENDS = {
  idle: "Garde le doigt appuyé sur le bouton, dis la phrase, puis relâche.",
  recording: "Parle maintenant, puis relâche le bouton.",
  processing: "Préparation du son…",
  done: "Écoute le résultat. Pas satisfait ? Garde le doigt sur « Recommencer » et redis la phrase.",
  tooShort: "Trop court : garde le doigt appuyé pendant toute la phrase.",
  silent: "Aucune voix entendue : garde le doigt appuyé pendant que tu parles.",
  noMic: "Le micro n'est pas autorisé. Autorise-le pour cette application dans les réglages du téléphone, puis rouvre cette fenêtre.",
  failed: "L'enregistrement n'a pas pu être lu. Réessaie."
};

// Fenêtre d'enregistrement d'une voix : maintenir pour enregistrer, réécouter, passer au suivant
export function openVoiceRecordModal(options: VoiceRecordOptions): void {
  const { order, recorded, store } = options;
  let clip = options.clip;
  let phase: Phase = "idle";
  let legend: string = LEGENDS.idle;
  let mic: MicRecorder | null = null;
  let isMicRefused = false;
  let pressedAt = 0;
  let player: HTMLAudioElement | null = null;
  let playerUrl: string | null = null;

  const modal = document.createElement("div");
  modal.className = "session-modal-overlay";
  modal.innerHTML = `
    <div class="session-modal-container prompt-choice-modal voice-record-modal">
      <div class="prompt-header">
        <h3>🎙️ <span id="voice-kind"></span></h3>
        <button type="button" class="btn-modal-close" id="btn-voice-close" aria-label="Fermer">✕</button>
      </div>
      <p class="voice-remaining" id="voice-remaining"></p>

      <div class="voice-say-card">
        <span class="voice-say-label">Dis :</span>
        <span class="voice-say-text" id="voice-say-text"></span>
      </div>

      <button type="button" class="voice-hold-btn" id="btn-voice-hold"></button>
      <p class="voice-legend" id="voice-legend" aria-live="polite"></p>

      <div class="voice-actions">
        <button type="button" class="btn-choice-helper" id="btn-voice-replay">▶️ Réécouter</button>
        <button type="button" class="btn-confirm-launch" id="btn-voice-next"></button>
      </div>
      <button type="button" class="voice-delete" id="btn-voice-delete">Revenir à la voix de synthèse</button>
    </div>
  `;

  const kindEl = modal.querySelector("#voice-kind") as HTMLElement;
  const remainingEl = modal.querySelector("#voice-remaining") as HTMLElement;
  const sayEl = modal.querySelector("#voice-say-text") as HTMLElement;
  const holdBtn = modal.querySelector("#btn-voice-hold") as HTMLButtonElement;
  const legendEl = modal.querySelector("#voice-legend") as HTMLElement;
  const replayBtn = modal.querySelector("#btn-voice-replay") as HTMLButtonElement;
  const nextBtn = modal.querySelector("#btn-voice-next") as HTMLButtonElement;
  const deleteBtn = modal.querySelector("#btn-voice-delete") as HTMLButtonElement;

  function render() {
    const isRecorded = recorded.has(clip.file);
    const remaining = order.filter((c) => !recorded.has(c.file)).length;
    const next = nextToRecord(order, recorded, clip.file);

    kindEl.textContent = `${KIND_TITLES[clip.kind]} · ${clip.label}`;
    remainingEl.textContent = remaining === 0 ? "Toutes les voix sont enregistrées 🎉" : `Encore ${remaining} à enregistrer`;
    sayEl.textContent = `« ${clip.text} »`;

    holdBtn.textContent =
      phase === "recording" ? "● J'enregistre… relâche pour finir" : isRecorded ? "🎙️ Recommencer" : "🎙️ Maintenir pour enregistrer";
    holdBtn.classList.toggle("is-recording", phase === "recording");
    holdBtn.disabled = isMicRefused || phase === "processing";
    legendEl.textContent = legend;
    legendEl.classList.toggle("is-warning", [LEGENDS.tooShort, LEGENDS.silent, LEGENDS.noMic, LEGENDS.failed].includes(legend));

    replayBtn.hidden = !isRecorded;
    deleteBtn.hidden = !isRecorded || phase === "recording";
    nextBtn.textContent = next ? "Enregistrement suivant →" : "Terminer";
    // Tant que rien n'est enregistré, l'action principale reste le bouton à maintenir
    nextBtn.className = isRecorded ? "btn-confirm-launch" : "btn-choice-helper";
    nextBtn.disabled = phase === "recording" || phase === "processing";
  }

  function stopPlayback() {
    player?.pause();
    player = null;
    if (playerUrl) URL.revokeObjectURL(playerUrl);
    playerUrl = null;
  }

  async function replay() {
    stopPlayback();
    const wav = await store.get(clip.file);
    if (!wav) return;
    playerUrl = URL.createObjectURL(wav);
    player = new Audio(playerUrl);
    player.play().catch((err) => console.warn("Réécoute impossible", err));
  }

  function startRecording() {
    if (!mic || phase === "recording" || phase === "processing") return;
    stopPlayback();
    pressedAt = performance.now();
    mic.start();
    phase = "recording";
    legend = LEGENDS.recording;
    render();
  }

  async function stopRecording() {
    if (!mic || phase !== "recording") return;
    const heldMs = performance.now() - pressedAt;
    phase = "processing";
    legend = LEGENDS.processing;
    render();

    const target = clip;
    try {
      const raw = await mic.stop();
      const wav = heldMs < MIN_HOLD_MS ? null : await cleanRecording(raw);
      if (!wav) {
        legend = heldMs < MIN_HOLD_MS ? LEGENDS.tooShort : LEGENDS.silent;
        phase = recorded.has(target.file) ? "done" : "idle";
      } else {
        await store.put(target.file, wav);
        recorded.add(target.file);
        options.onChange();
        phase = "done";
        legend = LEGENDS.done;
        if (clip === target) replay();
      }
    } catch (err) {
      console.warn("Enregistrement illisible", err);
      phase = "idle";
      legend = LEGENDS.failed;
    }
    render();
  }

  function showClip(next: VoiceClip) {
    stopPlayback();
    clip = next;
    phase = recorded.has(clip.file) ? "done" : "idle";
    legend = isMicRefused ? LEGENDS.noMic : LEGENDS.idle;
    render();
  }

  function close() {
    stopPlayback();
    mic?.close();
    mic = null;
    modal.remove();
  }

  // Maintenir pour enregistrer, au doigt comme à la souris ; le relâchement arrête, même hors du bouton
  holdBtn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    try {
      holdBtn.setPointerCapture(e.pointerId);
    } catch {
      // Pointeur déjà relâché : l'appui s'arrêtera sur pointerup
    }
    startRecording();
  });
  holdBtn.addEventListener("pointerup", () => stopRecording());
  holdBtn.addEventListener("pointercancel", () => stopRecording());
  // Un appui long ouvre sinon le menu du navigateur
  holdBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  // Au clavier : maintenir Espace ou Entrée
  holdBtn.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      startRecording();
    }
  });
  holdBtn.addEventListener("keyup", (e) => {
    if (e.key === " " || e.key === "Enter") stopRecording();
  });

  replayBtn.addEventListener("click", () => replay());
  nextBtn.addEventListener("click", () => {
    const next = nextToRecord(order, recorded, clip.file);
    if (next) showClip(next);
    else close();
  });
  deleteBtn.addEventListener("click", async () => {
    stopPlayback();
    await store.remove(clip.file);
    recorded.delete(clip.file);
    options.onChange();
    showClip(clip);
  });
  modal.querySelector("#btn-voice-close")?.addEventListener("click", close);

  showClip(clip);
  document.body.appendChild(modal);

  // Le téléphone demande l'accès au micro à l'ouverture, pas au premier appui : l'appui enregistre tout de suite
  openMicRecorder()
    .then((recorder) => {
      if (!modal.isConnected) recorder.close();
      else mic = recorder;
    })
    .catch((err) => {
      console.warn("Micro indisponible", err);
      isMicRefused = true;
      legend = LEGENDS.noMic;
      render();
    });
}

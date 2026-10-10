import { ListeningMode, startListeningPlayer } from "../radio/listeningPlayer";
import { WakeLockService } from "../services/wakeLockService";

const MODE_TEXTS: Record<ListeningMode, { tag: string; emoji: string }> = {
  radio: { tag: "📻 Radio des tables", emoji: "📻" },
  brushing: { tag: "🪥 Brossage de dents", emoji: "🪥" }
};

function formatCountdown(seconds: number): string {
  const whole = Math.ceil(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

// Écran d'écoute de la radio et du brossage de dents. Sans joueur : ni points, ni boîtes.
// À appeler pendant le clic qui lance l'écoute, pour que le téléphone autorise le son.
export function startListeningModal(mode: ListeningMode, tables: number[], wakeLock: WakeLockService): void {
  const texts = MODE_TEXTS[mode];
  const isBrushing = mode === "brushing";
  let isOpen = true;
  let isPlaying = true;
  let isFinished = false;
  let errorMessage = "";

  const RADIO_HINT = "Tu peux éteindre l'écran : la radio continue.";
  const AWAKE_HINT = "L'écran reste allumé pendant le brossage.";

  const modalEl = document.createElement("div");
  modalEl.className = "session-modal-overlay";
  modalEl.innerHTML = `
    <div class="session-modal-container workshop-active-modal mode-screen listening-modal">
      <div class="session-modal-header">
        <div class="workshop-title">
          <span class="workshop-tag">${texts.tag}</span>
          <span class="workshop-name">Tables : ${tables.join(", ")}</span>
        </div>
        <div class="header-controls-group">
          <button type="button" class="btn-session-pause" id="btn-listen-pause" aria-label="Pause ou Reprendre">⏸️</button>
          <button type="button" class="btn-modal-close" id="btn-listen-close" aria-label="Arrêter">✕</button>
        </div>
      </div>

      ${
        isBrushing
          ? `
            <div class="listening-countdown" id="listen-countdown" aria-label="Temps de brossage restant">3:00</div>
            <div class="progress-bar-container">
              <div class="progress-bar-fill" id="listen-progress" style="width: 0%;"></div>
            </div>
          `
          : ""
      }

      <div class="question-stage giant-stage">
        <div class="stage-card giant-card is-message" id="listen-card">
          <span class="stage-factors" id="listen-factors">${texts.emoji}</span>
          <span class="stage-equals">=</span>
          <span class="stage-answer" id="listen-answer">?</span>
        </div>
        <div class="status-cue" id="listen-cue">Préparation des voix...</div>
      </div>

      <p class="listening-hint" id="listen-hint">${isBrushing ? AWAKE_HINT : RADIO_HINT}</p>
      <button type="button" class="btn-confirm-launch" id="btn-listen-done" hidden>Terminer</button>
    </div>
  `;

  const cardEl = modalEl.querySelector("#listen-card") as HTMLElement;
  const factorsEl = modalEl.querySelector("#listen-factors") as HTMLElement;
  const answerEl = modalEl.querySelector("#listen-answer") as HTMLElement;
  const cueEl = modalEl.querySelector("#listen-cue") as HTMLElement;
  const hintEl = modalEl.querySelector("#listen-hint") as HTMLElement;
  const pauseBtn = modalEl.querySelector("#btn-listen-pause") as HTMLElement;
  const doneBtn = modalEl.querySelector("#btn-listen-done") as HTMLElement;
  const countdownEl = modalEl.querySelector("#listen-countdown") as HTMLElement | null;
  const progressEl = modalEl.querySelector("#listen-progress") as HTMLElement | null;

  // Pendant le brossage personne ne touche l'écran : on empêche la veille. La radio, elle, laisse l'écran s'éteindre
  let releaseScreen = isBrushing ? wakeLock.keepAwake() : () => undefined;

  const player = startListeningPlayer(mode, tables, {
    onPlayingChange(playing) {
      isPlaying = playing;
    },
    onStopRequested() {
      close();
    },
    onFinished() {
      isFinished = true;
      releaseScreen();
    },
    onError(error) {
      console.warn("Écoute interrompue", error);
      errorMessage = "Impossible de lire les voix. Ferme et réessaie.";
      releaseScreen();
    }
  });

  function setText(el: HTMLElement | null, text: string) {
    if (el && el.textContent !== text) el.textContent = text;
  }

  function render() {
    if (!isOpen) return;
    const position = player.getPosition();
    const cue = position?.cue ?? null;

    cardEl.classList.toggle("is-message", cue === null);
    if (cue) {
      setText(factorsEl, `${cue.a} × ${cue.b}`);
      setText(answerEl, position?.isAnswerRevealed ? String(cue.result) : "?");
      answerEl.classList.toggle("revealed", position?.isAnswerRevealed === true);
    } else {
      setText(factorsEl, isFinished ? "✨" : texts.emoji);
    }

    if (errorMessage) setText(cueEl, errorMessage);
    else if (isFinished) setText(cueEl, "Bravo, le brossage est fini !");
    else if (!position) setText(cueEl, "Préparation des voix...");
    else if (!isPlaying) setText(cueEl, "En pause");
    else if (!cue) setText(cueEl, isBrushing ? "Brosse bien partout..." : "Écoute...");
    else setText(cueEl, position.isAnswerRevealed ? `${cue.a} fois ${cue.b}, ${cue.result}` : "Tu connais la réponse ?");

    if (position?.brushing) {
      setText(countdownEl, formatCountdown(position.brushing.remainingS));
      if (progressEl) progressEl.style.width = `${position.brushing.progress * 100}%`;
    }

    // Brossage : la mention n'apparaît que si le téléphone a bien accepté de garder l'écran allumé
    hintEl.hidden = isBrushing && (isFinished || !wakeLock.isActive());

    setText(pauseBtn, isPlaying ? "⏸️" : "▶️");
    pauseBtn.classList.toggle("is-paused", !isPlaying);
    pauseBtn.hidden = isFinished || errorMessage !== "";
    doneBtn.hidden = !isFinished;

    requestAnimationFrame(render);
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    player.stop();
    releaseScreen();
    releaseScreen = () => undefined;
    modalEl.remove();
  }

  pauseBtn.addEventListener("click", () => player.toggle());
  modalEl.querySelector("#btn-listen-close")?.addEventListener("click", close);
  doneBtn.addEventListener("click", close);

  document.body.appendChild(modalEl);
  render();
}

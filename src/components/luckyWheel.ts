import { MatrixStore } from "../core/matrixStore";
import { AudioService } from "../services/audioService";
import { getRewardForIndex } from "./rewardsBoard";
import { runCelebration } from "./celebration";

const SPIN_DURATION_MS = 4500;
// Deux cliquetis ne peuvent pas être plus rapprochés : au démarrage la roue va trop vite pour l'oreille
const MIN_TICK_GAP_MS = 45;

export interface WheelItem {
  a: number;
  b: number;
  result: number;
  emoji: string;
  pointsReward: number;
}

export function openLuckyWheelModal(
  matrixStore: MatrixStore,
  audioService: AudioService,
  onClose: () => void
): void {
  // 100 formules possibles avec leur emoji
  const allCalculations: WheelItem[] = [];
  for (let a = 1; a <= 10; a++) {
    for (let b = 1; b <= 10; b++) {
      allCalculations.push({
        a,
        b,
        result: a * b,
        emoji: getRewardForIndex(a, b),
        pointsReward: a * b // Le résultat de la multiplication, de 1 à 100 points
      });
    }
  }

  const modalEl = document.createElement("div");
  modalEl.className = "session-modal-overlay wheel-modal-overlay";

  let spinsLeft = matrixStore.getDailyWheelSpinsLeft();
  let isSpinning = false;

  function renderModalLayout() {
    modalEl.innerHTML = `
      <div class="session-modal-container wheel-modal-card">
        <div class="wheel-modal-header">
          <div class="wheel-title-wrap">
            <h3>🎡 La Roue Magique</h3>
            <span class="wheel-spins-badge">${spinsLeft} lancer${spinsLeft > 1 ? "s" : ""} disponible${spinsLeft > 1 ? "s" : ""} aujourd'hui</span>
          </div>
          <button type="button" class="btn-modal-close" id="btn-close-wheel" aria-label="Fermer">✕</button>
        </div>

        <!-- Fenêtre de défilement horizontal de la roue -->
        <div class="wheel-stage-container">
          <div class="wheel-pointer-arrow">▼</div>
          <div class="wheel-viewport" id="wheel-viewport">
            <div class="wheel-track" id="wheel-track"></div>
          </div>
        </div>

        <div class="wheel-footer">
          <button type="button" class="btn-confirm-launch btn-spin-action ${spinsLeft === 0 ? "disabled" : ""}" id="btn-launch-spin">
            ${spinsLeft > 0 ? "Tourner la roue ! 🚀" : "Reviens demain pour 3 nouveaux lancers ! 🌙"}
          </button>
        </div>
      </div>
    `;

    modalEl.querySelector("#btn-close-wheel")?.addEventListener("click", () => {
      if (isSpinning) return;
      modalEl.remove();
      onClose();
    });

    modalEl.querySelector("#btn-launch-spin")?.addEventListener("click", () => {
      if (isSpinning || spinsLeft <= 0) return;
      launchWheelSpin();
    });

    populateInitialWheelTrack();
  }

  function populateInitialWheelTrack() {
    const track = modalEl.querySelector("#wheel-track");
    if (!track) return;
    track.innerHTML = "";

    // Afficher quelques items par défaut
    for (let i = 0; i < 15; i++) {
      const item = allCalculations[i % allCalculations.length];
      const slot = document.createElement("div");
      slot.className = "wheel-slot-card";
      slot.innerHTML = `
        <span class="slot-emoji">${item.emoji}</span>
        <span class="slot-formula">${item.a} × ${item.b} = ${item.result}</span>
        <span class="slot-bonus">+${item.pointsReward} 🥇</span>
      `;
      track.appendChild(slot);
    }
  }

  function launchWheelSpin() {
    if (!matrixStore.useWheelSpin()) return;
    isSpinning = true;
    spinsLeft = matrixStore.getDailyWheelSpinsLeft();

    const track = modalEl.querySelector("#wheel-track") as HTMLElement;
    const launchBtn = modalEl.querySelector("#btn-launch-spin") as HTMLButtonElement;
    if (launchBtn) launchBtn.disabled = true;

    // Choisir un item gagnant aléatoire parmi les 100
    const winningItem = allCalculations[Math.floor(Math.random() * allCalculations.length)];

    // Générer une longue bande de 50 items avec le gagnant vers la fin
    const spinItems: WheelItem[] = [];
    for (let i = 0; i < 45; i++) {
      spinItems.push(allCalculations[Math.floor(Math.random() * allCalculations.length)]);
    }
    spinItems.push(winningItem); // Le gagnant à l'index 45
    // Ajouter encore 5 items après pour l'inertie
    for (let i = 0; i < 5; i++) {
      spinItems.push(allCalculations[Math.floor(Math.random() * allCalculations.length)]);
    }

    track.innerHTML = "";
    spinItems.forEach((item) => {
      const slot = document.createElement("div");
      slot.className = "wheel-slot-card";
      slot.innerHTML = `
        <span class="slot-emoji">${item.emoji}</span>
        <span class="slot-formula">${item.a} × ${item.b} = ${item.result}</span>
        <span class="slot-bonus">+${item.pointsReward} 🥇</span>
      `;
      track.appendChild(slot);
    });

    // Chaque carte fait environ 120px + 8px gap = 128px, après 12px de marge à gauche de la bande
    const cardWidth = 128;
    const trackPadding = 12;
    const viewport = modalEl.querySelector("#wheel-viewport") as HTMLElement;
    const viewportHalf = (viewport?.clientWidth || 320) / 2;
    const targetOffset = -(45 * cardWidth + cardWidth / 2 - viewportHalf);

    // Cliquetis calés sur le mouvement réel : un par carte qui passe sous la flèche
    let isTracking = true;
    let lastSlotIndex = -1;
    let lastTickAt = 0;

    function followTrack(now: number) {
      if (!isTracking) return;
      const x = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41;
      const slotIndex = Math.floor((viewportHalf - x - trackPadding) / cardWidth);
      if (slotIndex !== lastSlotIndex) {
        if (lastSlotIndex !== -1 && now - lastTickAt >= MIN_TICK_GAP_MS) {
          audioService.playWheelTick();
          lastTickAt = now;
        }
        lastSlotIndex = slotIndex;
      }
      requestAnimationFrame(followTrack);
    }

    // La carte gagnée ne s'ouvre qu'une fois la roue arrêtée et silencieuse
    let hasStopped = false;
    const onStop = () => {
      if (hasStopped) return;
      hasStopped = true;
      isTracking = false;
      track.removeEventListener("transitionend", onStop);
      setTimeout(() => {
        isSpinning = false;
        showWinningCardSplash(winningItem);
      }, 350);
    };
    track.addEventListener("transitionend", onStop);
    setTimeout(onStop, SPIN_DURATION_MS + 400);

    // Animation CSS d'inertie fluide
    track.style.transition = `transform ${SPIN_DURATION_MS}ms cubic-bezier(0.12, 0.8, 0.15, 1)`;
    track.style.transform = `translateX(${targetOffset}px)`;
    requestAnimationFrame(followTrack);
  }

  // Affiche la carte gagnante sous forme de carte avec animation de points incrémentés
  function showWinningCardSplash(item: WheelItem) {
    const splashEl = document.createElement("div");
    splashEl.className = "session-modal-overlay win-card-overlay";

    const oldPoints = matrixStore.getPoints();
    const newPoints = matrixStore.addPoints(item.pointsReward);

    splashEl.innerHTML = `
      <div class="session-modal-container win-card-modal">
        <div class="card-close-bar">
          <button type="button" class="btn-modal-close" id="btn-close-win" aria-label="Fermer">✕</button>
        </div>
        <div class="win-card-ribbon">⭐ GAGNÉ ! ⭐</div>

        <div class="win-item-card">
          <div class="win-card-emoji">${item.emoji}</div>
          <div class="win-card-formula">${item.a} × ${item.b} = ${item.result}</div>
        </div>

        <div class="win-points-counter-box">
          <span class="points-label">Tes Points Récompenses :</span>
          <div class="points-animated-display">
            <span class="points-coin-icon">🥇</span>
            <span class="points-value" id="win-points-val">${oldPoints}</span>
            <span class="points-added-badge">+${item.pointsReward}</span>
          </div>
        </div>

        <button type="button" class="btn-confirm-launch btn-collect-win" id="btn-collect-win">
          Super ! 🎉
        </button>
      </div>
    `;

    document.body.appendChild(splashEl);

    const closeWinSplash = () => {
      audioService.stop();
      splashEl.remove();
      renderModalLayout();
    };
    splashEl.querySelector("#btn-close-win")?.addEventListener("click", closeWinSplash);
    splashEl.querySelector("#btn-collect-win")?.addEventListener("click", closeWinSplash);

    // L'opération est dite, puis la félicitation, puis le décompte ; les boutons viennent à la fin
    runCelebration({
      root: splashEl,
      audioService,
      operation: { a: item.a, b: item.b, result: item.result },
      cheer: true,
      points: { element: splashEl.querySelector("#win-points-val") as HTMLElement | null, from: oldPoints, to: newPoints }
    });
  }

  renderModalLayout();
  document.body.appendChild(modalEl);
}

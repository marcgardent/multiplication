import { MatrixStore } from "../core/matrixStore";
import { AudioService } from "../services/audioService";
import { getRewardForIndex } from "./rewardsBoard";

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
        pointsReward: 20 + ((a * b) % 30) // Entre 20 et 50 points
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

    // Chaque carte fait environ 120px + 8px gap = 128px
    const cardWidth = 128;
    const viewport = modalEl.querySelector("#wheel-viewport") as HTMLElement;
    const viewportHalf = (viewport?.clientWidth || 320) / 2;
    const targetOffset = -(45 * cardWidth + cardWidth / 2 - viewportHalf);

    // Bruitages de cliquets pendant le défilement
    let tickCount = 0;
    const totalTicks = 35;
    let tickInterval = 60; // Commence très vite

    function triggerNextTick() {
      if (tickCount >= totalTicks) return;
      audioService.playWheelTick();
      tickCount++;
      // Décélération progressive
      tickInterval = Math.round(tickInterval * 1.09);
      setTimeout(triggerNextTick, tickInterval);
    }
    triggerNextTick();

    // Animation CSS d'inertie fluide
    track.style.transition = "transform 4.5s cubic-bezier(0.12, 0.8, 0.15, 1)";
    track.style.transform = `translateX(${targetOffset}px)`;

    setTimeout(() => {
      isSpinning = false;
      showWinningCardSplash(winningItem);
    }, 4700);
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
    audioService.playCheer();

    splashEl.querySelector("#btn-close-win")?.addEventListener("click", () => {
      splashEl.remove();
      renderModalLayout();
    });

    // Animation visuelle d'incrémentation du compteur de points
    const pointsValEl = splashEl.querySelector("#win-points-val") as HTMLElement | null;
    if (pointsValEl) {
      animateCounter(
        pointsValEl,
        oldPoints,
        newPoints,
        1200,
        () => audioService.playCoinSound(),
        () => audioService.playWheelTick()
      );
    }

    splashEl.querySelector("#btn-collect-win")?.addEventListener("click", () => {
      splashEl.remove();
      renderModalLayout();
    });
  }

  renderModalLayout();
  document.body.appendChild(modalEl);
}

// Fonction utilitaire pour animer le compteur de points
export function animateCounter(
  element: HTMLElement,
  start: number,
  end: number,
  durationMs = 1000,
  onFinish?: () => void,
  onTick?: () => void
): void {
  const range = end - start;
  if (range <= 0) {
    element.textContent = end.toString();
    onFinish?.();
    return;
  }
  const startTime = performance.now();
  let lastVal = start;

  function update(currentTime: number) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    // Easing out cubic
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(start + range * ease);

    if (current !== lastVal) {
      lastVal = current;
      element.textContent = current.toString();
      onTick?.();
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = end.toString();
      onFinish?.();
    }
  }

  requestAnimationFrame(update);
}

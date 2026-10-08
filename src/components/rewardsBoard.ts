import { MatrixStore } from "../core/matrixStore";
import { AudioService } from "../services/audioService";
import { UserProfile } from "../types";
import { animateCounter } from "./luckyWheel";

// Pool de 100 récompenses amusantes et variées (animaux, objets, trésors, sports, nourritures)
export const REWARD_EMOJIS = [
  "🚀", "💎", "⭐", "🏆", "👑", "🦄", "🦁", "🐼", "🦊", "🐯",
  "🦖", "🐉", "🐬", "🐙", "🦋", "🎸", "🎮", "⚽", "🏀", "🛹",
  "🏎️", "🚁", "⛵", "🛰️", "🛸", "🍦", "🍕", "🍔", "🍓", "🍉",
  "🍭", "🍫", "🍩", "🧁", "🎨", "🎪", "🎯", "🎲", "🧩", "🤖",
  "🦸", "🧙", "🥷", "🏄", "🧗", "🌋", "🏖️", "🏝️", "🌈", "🪐",
  "🏰", "🗼", "🗿", "🎁", "🎈", "🎉", "🔮", "🧿", "🥇", "🎖️",
  "🐅", "🐆", "🦓", "🦍", "🦧", "🦣", "🐘", "🦏", "🦛", "🐪",
  "🦘", "🦥", "🦦", "🦨", "🦩", "🦜", "🦅", "🦆", "🦉", "🦇",
  "🐺", "🐗", "🐴", "🦄", "🐝", "🐞", "🦗", "🕷️", "🦂", "🐢",
  "🐍", "🦎", "🦖", "🦕", "🦈", "🐳", "🐋", "🦭", "🐊", "🎆"
];

export function getRewardForIndex(a: number, b: number): string {
  const index = ((a - 1) * 10 + (b - 1)) % REWARD_EMOJIS.length;
  return REWARD_EMOJIS[index];
}

export interface RewardsFlowOptions {
  profile: UserProfile;
  discoveredCount: number;
  learnedCount: number;
  pointsGained?: number;
  oldPoints?: number;
  matrixStore: MatrixStore;
  audioService: AudioService;
  onDone: () => void;
}

export function showRewardsFlow(options: RewardsFlowOptions): void {
  const { profile, discoveredCount, learnedCount, pointsGained = 0, oldPoints, matrixStore, audioService, onDone } = options;

  const currentPoints = matrixStore.getPoints();
  const startPoints = oldPoints !== undefined && oldPoints < currentPoints
    ? oldPoints
    : Math.max(0, currentPoints - pointsGained);

  const allItems = matrixStore.getAll();
  const openedGifts = new Set(matrixStore.getOpenedGifts());
  // Seules les opérations maîtrisées débloquent des cadeaux prêts à être ouverts
  const pendingGifts = allItems.filter((i) => i.status === "mastered" && !openedGifts.has(i.id));
  const hasGiftsToDiscover = pendingGifts.length > 0;

  // 1. ÉCRAN 1 : SPLASHSCREEN DE FÉLICITATIONS
  const splashEl = document.createElement("div");
  splashEl.className = "session-modal-overlay congrats-splash-overlay";

  splashEl.innerHTML = `
    <div class="session-modal-container congrats-card">
      <div class="card-close-bar">
        <button type="button" class="btn-modal-close" id="btn-close-congrats" aria-label="Fermer">✕</button>
      </div>
      <div class="congrats-fireworks">🎉 🌟 ✨</div>
      <div class="congrats-avatar-bubble">${profile.avatar}</div>
      <h2 class="congrats-title">Bravo ${profile.name} !</h2>
      <p class="congrats-subtitle">${
        hasGiftsToDiscover
          ? "Tu as de nouveaux cadeaux prêts à être ouverts !"
          : "Super entraînement terminé ! Continue pour débloquer des cadeaux !"
      }</p>

      <div class="congrats-stats-row">
        <div class="congrats-stat-box box-disc">
          <span class="stat-big-num">+${discoveredCount}</span>
          <span class="stat-lbl">Découvert</span>
        </div>
        <div class="congrats-stat-box box-master">
          <span class="stat-big-num">+${learnedCount}</span>
          <span class="stat-lbl">Appris</span>
        </div>
      </div>

      <!-- Compteur de points total avec animation -->
      <div class="win-points-counter-box congrats-points-box">
        <span class="points-label">Points Récompenses :</span>
        <div class="points-animated-display">
          <span class="points-coin-icon">🥇</span>
          <span class="points-value" id="congrats-pts-counter">${startPoints}</span>
          ${pointsGained > 0 ? `<span class="points-added-badge">+${pointsGained}</span>` : ""}
        </div>
      </div>

      ${
        hasGiftsToDiscover
          ? `
            <button type="button" class="btn-confirm-launch btn-open-rewards" id="btn-show-rewards-grid">
              🎁 Récompenses — ${pendingGifts.length} cadeau${pendingGifts.length > 1 ? "x" : ""} à ouvrir !
            </button>
          `
          : `
            <button type="button" class="btn-confirm-launch btn-rewards-finish" id="btn-finish-congrats">
              Terminer 🌟
            </button>
          `
      }
    </div>
  `;

  document.body.appendChild(splashEl);
  audioService.playFeedback("finish");

  // Fermeture directe du splashscreen
  splashEl.querySelector("#btn-close-congrats")?.addEventListener("click", () => {
    splashEl.remove();
    onDone();
  });

  // Animation des points gagnés après 3 secondes d'attente et ralentie
  if (pointsGained > 0 && currentPoints > startPoints) {
    setTimeout(() => {
      const ptsCounterEl = splashEl.querySelector("#congrats-pts-counter") as HTMLElement | null;
      if (ptsCounterEl) {
        animateCounter(
          ptsCounterEl,
          startPoints,
          currentPoints,
          2500,
          () => audioService.playCoinSound(),
          () => audioService.playWheelTick()
        );
      }
    }, 3000);
  }

  if (hasGiftsToDiscover) {
    splashEl.querySelector("#btn-show-rewards-grid")?.addEventListener("click", () => {
      splashEl.remove();
      openRewardsBoardModal(matrixStore, audioService, onDone);
    });
  } else {
    splashEl.querySelector("#btn-finish-congrats")?.addEventListener("click", () => {
      splashEl.remove();
      onDone();
    });
  }
}

// 2. ÉCRAN 2 : TABLEAU DES RÉCOMPENSES (STYLE CALENDRIER DE L'AVENT)
export function openRewardsBoardModal(
  matrixStore: MatrixStore,
  audioService: AudioService,
  onDone: () => void
): void {
  const boardEl = document.createElement("div");
  boardEl.className = "session-modal-overlay rewards-board-overlay";

  function renderBoardHTML() {
    const allItems = matrixStore.getAll();
    const openedGifts = new Set(matrixStore.getOpenedGifts());

    // UNIQUEMENT les opérations maîtrisées débloquent les cadeaux !
    const unlockedCount = allItems.filter((i) => i.status === "mastered").length;

    let gridCellsHtml = "";
    for (let a = 1; a <= 10; a++) {
      for (let b = 1; b <= 10; b++) {
        const item = matrixStore.getByFactors(a, b);
        const isAcquired = item && item.status === "mastered";
        const isOpened = isAcquired && openedGifts.has(item.id);
        const rewardEmoji = getRewardForIndex(a, b);

        let cellClass = "reward-cell";
        let contentHtml = "";

        if (isOpened) {
          // Cadeau déjà déballé : affiche l'emoji gagné et le résultat
          cellClass += " cell-opened";
          contentHtml = `
            <span class="cell-gift-emoji">${rewardEmoji}</span>
            <span class="cell-calc-result">${a * b}</span>
          `;
        } else if (isAcquired) {
          // Nouveau cadeau à déballer ! Clignote et attire l'œil
          cellClass += " cell-ready-to-open";
          contentHtml = `
            <span class="cell-gift-box pulse-gift">🎁</span>
            <span class="cell-calc-result">${a * b}</span>
          `;
        } else {
          // Case mystère non encore maîtrisée
          cellClass += " cell-mystery";
          contentHtml = `
            <span class="cell-mystery-icon">❓</span>
            <span class="cell-calc-preview">${a}×${b}</span>
          `;
        }

        gridCellsHtml += `
          <div class="${cellClass}" data-id="${a}x${b}" data-a="${a}" data-b="${b}" data-acquired="${isAcquired ? "1" : "0"}" data-opened="${isOpened ? "1" : "0"}">
            ${contentHtml}
          </div>
        `;
      }
    }

    boardEl.innerHTML = `
      <div class="session-modal-container rewards-board-card">
        <div class="rewards-board-header">
          <div class="rewards-title-wrap">
            <h3>🎁 Tableau des Récompenses</h3>
            <span class="rewards-count-badge">${unlockedCount} sur 100 maîtrisés</span>
          </div>
          <button type="button" class="btn-modal-close" id="btn-close-rewards-board" aria-label="Fermer">✕</button>
        </div>

        <p class="rewards-hint">Touche les paquets cadeaux 🎁 qui clignotent pour ouvrir tes tables maîtrisées !</p>

        <div class="rewards-grid-wrapper">
          <div class="rewards-grid-100">
            ${gridCellsHtml}
          </div>
        </div>

        <div class="rewards-footer">
          <button type="button" class="btn-confirm-launch btn-rewards-finish" id="btn-rewards-finish">
            Terminer et retourner au jeu 🌟
          </button>
        </div>
      </div>
    `;

    // Bouton fermeture
    boardEl.querySelector("#btn-close-rewards-board")?.addEventListener("click", () => {
      boardEl.remove();
      onDone();
    });

    boardEl.querySelector("#btn-rewards-finish")?.addEventListener("click", () => {
      boardEl.remove();
      onDone();
    });

    // Clic sur les cases cadeaux
    boardEl.querySelectorAll(".reward-cell").forEach((cell) => {
      cell.addEventListener("click", (e) => {
        const el = e.currentTarget as HTMLElement;
        const a = parseInt(el.getAttribute("data-a") || "1", 10);
        const b = parseInt(el.getAttribute("data-b") || "1", 10);
        const isAcquired = el.getAttribute("data-acquired") === "1";
        const isOpened = el.getAttribute("data-opened") === "1";
        const itemId = `${a}x${b}`;
        const rewardEmoji = getRewardForIndex(a, b);

        if (isAcquired && !isOpened) {
          // Déballer le nouveau cadeau avec son et splash
          matrixStore.openGift(itemId);
          showGiftCelebration(a, b, rewardEmoji, true, () => {
            renderBoardHTML();
          });
        } else if (isOpened) {
          // Re-montrer la récompense déjà acquise
          showGiftCelebration(a, b, rewardEmoji, false, null);
        }
      });
    });
  }

  // 3. ÉCRAN 3 : SPLASH DÉBALLAGE DU CADEAU AVEC AUDIO ENCOURAGEMENT ET POINTS GAGNÉS
  function showGiftCelebration(a: number, b: number, emoji: string, isFirstTime: boolean, onClose: (() => void) | null) {
    const giftSplash = document.createElement("div");
    giftSplash.className = "session-modal-overlay gift-celebration-overlay";

    const oldPoints = matrixStore.getPoints();
    const pointsGained = isFirstTime ? 25 : 0;
    const newPoints = isFirstTime ? matrixStore.addPoints(pointsGained) : oldPoints;

    giftSplash.innerHTML = `
      <div class="session-modal-container gift-celebration-card">
        <div class="card-close-bar">
          <button type="button" class="btn-modal-close" id="btn-close-gift-splash" aria-label="Fermer">✕</button>
        </div>
        <div class="celebration-burst">✨ 🌟 ✨</div>
        <div class="reward-huge-emoji pop-in-emoji">${emoji}</div>
        <h2 class="reward-item-title">${a} × ${b} = ${a * b}</h2>
        <p class="reward-item-msg">${isFirstTime ? "Nouvelle surprise débloquée !" : "Déjà dans ta collection !"}</p>

        <div class="win-points-counter-box">
          <span class="points-label">Points Récompenses :</span>
          <div class="points-animated-display">
            <span class="points-coin-icon">🥇</span>
            <span class="points-value" id="gift-points-val">${oldPoints}</span>
            ${isFirstTime ? `<span class="points-added-badge">+${pointsGained}</span>` : ""}
          </div>
        </div>

        <button type="button" class="btn-confirm-launch btn-collect-gift" id="btn-collect-gift">
          Génial ! 🎉
        </button>
      </div>
    `;

    document.body.appendChild(giftSplash);

    audioService.playCheer();

    giftSplash.querySelector("#btn-close-gift-splash")?.addEventListener("click", () => {
      giftSplash.remove();
      if (onClose) onClose();
    });

    if (isFirstTime) {
      setTimeout(() => {
        const valEl = giftSplash.querySelector("#gift-points-val") as HTMLElement | null;
        if (valEl) {
          animateCounter(
            valEl,
            oldPoints,
            newPoints,
            2500,
            () => audioService.playCoinSound(),
            () => audioService.playWheelTick()
          );
        }
      }, 3000);
    }

    giftSplash.querySelector("#btn-collect-gift")?.addEventListener("click", () => {
      giftSplash.remove();
      if (onClose) onClose();
    });
  }

  renderBoardHTML();
  document.body.appendChild(boardEl);
}

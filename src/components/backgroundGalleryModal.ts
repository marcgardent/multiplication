import { BACKGROUNDS, BackgroundItem, getActiveBackground, setActiveBackground } from "../core/backgrounds";
import { MatrixStore } from "../core/matrixStore";
import { UserProfile } from "../types";
import { AudioService } from "../services/audioService";

export interface BackgroundGalleryOptions {
  profile: UserProfile;
  matrixStore: MatrixStore;
  audioService: AudioService;
  onSelect?: (bg: BackgroundItem) => void;
  onClose?: () => void;
}

export function openBackgroundGalleryModal(options: BackgroundGalleryOptions): void {
  const { profile, matrixStore, audioService, onSelect, onClose } = options;
  const currentPoints = matrixStore.getPoints();
  let activeBg = getActiveBackground(profile.id);

  const modalOverlay = document.createElement("div");
  modalOverlay.className = "session-modal-overlay bg-gallery-overlay";

  function renderGallery() {
    activeBg = getActiveBackground(profile.id);
    const unlockedCount = BACKGROUNDS.filter((b) => currentPoints >= b.pointsRequired).length;

    let cardsHtml = "";
    BACKGROUNDS.forEach((bg) => {
      const isUnlocked = currentPoints >= bg.pointsRequired;
      const isActive = bg.id === activeBg.id;
      const progressPct = Math.min(100, Math.round((currentPoints / bg.pointsRequired) * 100));
      const pointsLeft = Math.max(0, bg.pointsRequired - currentPoints);

      let statusFooter = "";
      if (isActive) {
        statusFooter = `
          <div class="bg-card-active-badge">🌟 Fond Actuel</div>
        `;
      } else if (isUnlocked) {
        statusFooter = `
          <button type="button" class="btn-confirm-launch btn-select-bg" data-bg-id="${bg.id}">
            Choisir ce fond ✨
          </button>
        `;
      } else {
        statusFooter = `
          <div class="bg-card-locked-box">
            <div class="bg-lock-progress-bar">
              <div class="bg-lock-progress-fill" style="width: ${progressPct}%;"></div>
            </div>
            <span class="bg-lock-hint">Encore ${pointsLeft} points nécessaires</span>
          </div>
        `;
      }

      cardsHtml += `
        <div class="bg-gallery-card ${isUnlocked ? "unlocked" : "locked"} ${isActive ? "active-choice" : ""}">
          <div class="bg-preview-wrap">
            <img src="${import.meta.env.BASE_URL}backgrounds/${bg.filename}" alt="${bg.name}" class="bg-preview-img" loading="lazy" />
            ${!isUnlocked ? '<div class="bg-lock-overlay"><span class="lock-big-icon">🔒</span></div>' : ""}
            <span class="bg-pts-badge">${bg.pointsRequired === 0 ? "Gratuit" : `${bg.pointsRequired} pts`}</span>
          </div>
          <div class="bg-card-info">
            <h4 class="bg-card-name">${bg.name}</h4>
            ${statusFooter}
          </div>
        </div>
      `;
    });

    modalOverlay.innerHTML = `
      <div class="session-modal-container bg-gallery-container">
        <div class="rewards-board-header">
          <div class="rewards-title-wrap">
            <h3>🖼️ Fonds d'Écran Magiques</h3>
            <span class="rewards-count-badge">${unlockedCount} sur 10 débloqués</span>
          </div>
          <button type="button" class="btn-modal-close" id="btn-close-bg-gallery" aria-label="Fermer">✕</button>
        </div>

        <p class="rewards-hint">
          Entraîne-toi et fais tourner la Roue Magique pour débloquer ces décors féeriques !
        </p>

        <div class="bg-gallery-grid-scroll">
          <div class="bg-gallery-grid">
            ${cardsHtml}
          </div>
        </div>

        <div class="rewards-footer">
          <button type="button" class="btn-confirm-launch btn-rewards-finish" id="btn-finish-bg-gallery">
            Retourner au jeu 🌟
          </button>
        </div>
      </div>
    `;

    // Écouteurs de fermeture
    modalOverlay.querySelector("#btn-close-bg-gallery")?.addEventListener("click", () => {
      modalOverlay.remove();
      if (onClose) onClose();
    });

    modalOverlay.querySelector("#btn-finish-bg-gallery")?.addEventListener("click", () => {
      modalOverlay.remove();
      if (onClose) onClose();
    });

    // Écouteurs de sélection de fond
    modalOverlay.querySelectorAll(".btn-select-bg").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const target = e.currentTarget as HTMLElement;
        const bgId = target.getAttribute("data-bg-id");
        if (bgId) {
          setActiveBackground(profile.id, bgId);
          audioService.playCoinSound();
          const selected = BACKGROUNDS.find((b) => b.id === bgId);
          if (selected && onSelect) onSelect(selected);
          renderGallery();
        }
      });
    });
  }

  renderGallery();
  document.body.appendChild(modalOverlay);
}

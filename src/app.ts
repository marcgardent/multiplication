import { createStorageService, STORAGE_NAMESPACE } from "./services/storageService";
import { createAudioService } from "./services/audioService";
import { createProfileService, ANIMAL_AVATARS, ProfileService } from "./services/profileService";
import { createMatrixStore, isGiftUnlocked, MatrixStore } from "./core/matrixStore";
import { createRepetitionEngine } from "./core/repetitionEngine";
import { createMatrixView } from "./components/matrixView";
import { startSessionModal } from "./components/sessionModal";
import { startEvaluationModal } from "./components/evaluationModal";
import { showRewardsFlow, openRewardsBoardModal } from "./components/rewardsBoard";
import { openLuckyWheelModal } from "./components/luckyWheel";
import { initAppBackground, applyAppBackground, BACKGROUNDS, countUnlockedBackgrounds, keepUnlockedBackgrounds } from "./core/backgrounds";
import { openBackgroundGalleryModal } from "./components/backgroundGalleryModal";
import { openGoogleDriveModal } from "./components/googleDriveModal";
import { renderSnapshotLoader } from "./components/snapshotLoaderScreen";
import { importProfileData } from "./core/profileData";
import { isTestProfile } from "./testing/snapshots";
import { SessionConfig, UserProfile } from "./types";

export interface AppInstance {
  mount(rootSelector: string): void;
}

export function createApp(): AppInstance {
  const storage = createStorageService(STORAGE_NAMESPACE);
  const audio = createAudioService();
  const profileService: ProfileService = createProfileService(storage);

  // Les décors déjà débloqués avec d'anciens seuils restent acquis
  profileService.getProfiles().forEach((p) => keepUnlockedBackgrounds(p.id));

  let activeProfile: UserProfile | null = profileService.getActiveProfile();
  let matrixStore: MatrixStore = createMatrixStore(storage, activeProfile ? activeProfile.id : "guest");

  if (activeProfile) {
    initAppBackground(activeProfile.id);
  } else {
    applyAppBackground(BACKGROUNDS[0].filename);
  }

  const sessionConfig: SessionConfig = {
    durationMinutes: storage.get<number>("config_duration", 3),
    pauseBetweenAudioMs: 1800
  };

  let repetitionEngine = createRepetitionEngine(matrixStore, sessionConfig);

  let currentTab: "home" | "carnet" | "snapshots" = "home";
  let rootElement: HTMLElement | null = null;
  let selectedRevisionTables: Set<number> = new Set([2, 3]);
  // Titre du dernier snapshot chargé par le joueur de test, rappelé sur l'accueil
  const LAST_SNAPSHOT_KEY = "test_last_snapshot";

  // Synchronisation si le profil actif change
  profileService.subscribe((newActive: UserProfile | null) => {
    activeProfile = newActive;
    if (newActive) {
      keepUnlockedBackgrounds(newActive.id);
      matrixStore.setProfile(newActive.id);
      repetitionEngine = createRepetitionEngine(matrixStore, sessionConfig);
      initAppBackground(newActive.id);
    } else {
      applyAppBackground(BACKGROUNDS[0].filename);
    }
    renderApp();
  });

  // Initialisation PWA prompt d'installation
  let deferredInstallPrompt: any = null;
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const installBtn = document.getElementById("btn-pwa-install");
    if (installBtn) installBtn.style.display = "inline-flex";
  });

  function renderShell(): HTMLElement {
    const shell = document.createElement("div");
    shell.className = "app-shell";

    shell.innerHTML = `
      <header class="app-header">
        <div class="app-branding" id="header-branding">
          ${
            activeProfile
              ? `
                <button type="button" class="profile-badge-btn" id="btn-switch-user" aria-label="Changer de joueur">
                  <span class="profile-avatar">${activeProfile.avatar}</span>
                  <span class="profile-name">${activeProfile.name}</span>
                  <span class="profile-switch-icon">⇄</span>
                </button>
                <button type="button" class="header-points-badge" id="btn-header-rewards" aria-label="Voir mes récompenses">
                  <span class="header-coin-icon">🥇</span>
                  <span class="header-points-val">${matrixStore.getPoints()}</span>
                </button>
              `
              : `
                <div class="app-title-plain">
                  <img src="${import.meta.env.BASE_URL}icons/icon-192.svg" alt="Logo" class="app-logo-mini" />
                  <h1>Multiplications</h1>
                </div>
              `
          }
        </div>
        <div class="header-actions">
          <button type="button" class="icon-btn" id="btn-header-cloud" aria-label="Sauvegarde Google Drive" title="Sauvegarde Google Drive">☁️</button>
          <button type="button" class="icon-btn" id="btn-audio-mute" aria-label="Couper ou activer le son">🔊</button>
          <button type="button" class="icon-btn" id="btn-pwa-install" aria-label="Installer l'application" style="display: none;">📲</button>
        </div>
      </header>

      <main class="main-content" id="main-content"></main>
    `;

    return shell;
  }

  // --- 1. ÉCRAN DE LOGIN AVEC BOUTON AJOUT ---
  function renderLoginScreen(container: HTMLElement) {
    container.innerHTML = "";
    const profiles = profileService.getProfiles();

    const loginEl = document.createElement("div");
    loginEl.className = "login-screen";

    loginEl.innerHTML = `
      <div class="login-container">
        <div class="login-greeting">
          <div class="login-icon">👋</div>
          <h2>Qui va s'entraîner ?</h2>
          <p>Choisis ton joueur ou ajoute-en un nouveau</p>
        </div>

        <div class="players-selection-grid">
          ${profiles
            .map(
              (p) => `
                <button type="button" class="player-tile-btn" data-id="${p.id}">
                  <span class="player-tile-avatar">${p.avatar}</span>
                  <span class="player-tile-name">${p.name}</span>
                </button>
              `
            )
            .join("")}

          <!-- Bouton (+) Ajouter un profil -->
          <button type="button" class="player-tile-btn btn-tile-add" id="btn-login-add-player">
            <span class="player-tile-add-icon">＋</span>
            <span class="player-tile-name">Nouveau</span>
          </button>
        </div>
      </div>
    `;

    // Clic sur un profil existant -> Connexion directe
    loginEl.querySelectorAll(".player-tile-btn:not(.btn-tile-add)").forEach((tile) => {
      tile.addEventListener("click", (e) => {
        const pid = (e.currentTarget as HTMLElement).getAttribute("data-id") || "";
        profileService.selectProfile(pid);
      });
    });

    // Clic sur le bouton (+) -> Ouvre la modale de création avec choix d'animal
    loginEl.querySelector("#btn-login-add-player")?.addEventListener("click", () => {
      openCreatePlayerModal();
    });

    container.appendChild(loginEl);
  }

  // Modale de création d'un joueur avec prénom et emoji animal
  function openCreatePlayerModal() {
    const modal = document.createElement("div");
    modal.className = "session-modal-overlay";
    let chosenAvatar = "🦁";

    modal.innerHTML = `
      <div class="session-modal-container prompt-choice-modal">
        <div class="prompt-header">
          <h3>Nouveau joueur</h3>
          <button type="button" class="btn-modal-close" id="btn-close-create">✕</button>
        </div>

        <div class="new-profile-form">
          <label class="form-lbl">Ton prénom :</label>
          <input type="text" class="input-profile-name" id="input-new-name" placeholder="Ex: Lucas, Emma..." maxlength="14" autofocus />

          <label class="form-lbl">Choisis ton animal :</label>
          <div class="animal-avatars-grid">
            ${ANIMAL_AVATARS.map(
              (emoji) => `
                <button type="button" class="btn-animal-option ${emoji === chosenAvatar ? "active" : ""}" data-emoji="${emoji}">
                  ${emoji}
                </button>
              `
            ).join("")}
          </div>
        </div>

        <button type="button" class="btn-confirm-launch" id="btn-save-player">
          C'est parti ! 🌟
        </button>
      </div>
    `;

    modal.querySelector("#btn-close-create")?.addEventListener("click", () => modal.remove());

    modal.querySelectorAll(".btn-animal-option").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        chosenAvatar = (e.currentTarget as HTMLElement).getAttribute("data-emoji") || "🦁";
        modal.querySelectorAll(".btn-animal-option").forEach((b) => b.classList.remove("active"));
        (e.currentTarget as HTMLElement).classList.add("active");
      });
    });

    modal.querySelector("#btn-save-player")?.addEventListener("click", () => {
      const input = modal.querySelector("#input-new-name") as HTMLInputElement;
      const name = input ? input.value : "";
      profileService.createProfile(name, chosenAvatar);
      modal.remove();
    });

    document.body.appendChild(modal);
  }

  // --- 2. ÉCRAN PRINCIPAL ENFANT (3 BOUTONS ÉPURÉS) ---
  function renderKidsHome(container: HTMLElement) {
    container.innerHTML = "";

    const homeEl = document.createElement("div");
    homeEl.className = "home-screen-kids";

    const spinsLeft = matrixStore.getDailyWheelSpinsLeft();
    const unlockedCount = matrixStore.getAll().filter(isGiftUnlocked).length;
    const currentPoints = matrixStore.getPoints();
    const unlockedBgsCount = activeProfile ? countUnlockedBackgrounds(activeProfile.id, currentPoints) : 1;
    const lastSnapshotTitle = storage.get<string>(LAST_SNAPSHOT_KEY, "");

    homeEl.innerHTML = `
      <div class="kids-menu-container">
        <!-- Bouton 1 : Révision guidée -->
        <button type="button" class="kids-main-btn btn-guided" id="btn-launch-guided">
          <div class="btn-bubble">🚀</div>
          <div class="btn-text-block">
            <span class="btn-title">Révision guidée</span>
            <span class="btn-subtitle">Écoute, quiz et défis chrono</span>
          </div>
        </button>

        <!-- Bouton 2 : Révision tables -->
        <button type="button" class="kids-main-btn btn-tables" id="btn-launch-tables">
          <div class="btn-bubble">🎯</div>
          <div class="btn-text-block">
            <span class="btn-title">Révision tables</span>
            <span class="btn-subtitle">Choisis les tables que tu veux travailler</span>
          </div>
        </button>

        <!-- Bouton 3 : Carnet de suivi -->
        <button type="button" class="kids-main-btn btn-carnet" id="btn-open-carnet">
          <div class="btn-bubble">📊</div>
          <div class="btn-text-block">
            <span class="btn-title">Carnet de suivi</span>
            <span class="btn-subtitle">Scores, temps et progression</span>
          </div>
        </button>
        ${
          isTestProfile(activeProfile)
            ? `
              <!-- Joueur de test uniquement : charger un état enregistré -->
              <button type="button" class="kids-main-btn" id="btn-open-snapshots">
                <div class="btn-bubble">🧪</div>
                <div class="btn-text-block">
                  <span class="btn-title">Scénarios de test</span>
                  <span class="btn-subtitle">${lastSnapshotTitle ? `Chargé : ${lastSnapshotTitle}` : "Charger un état enregistré"}</span>
                </div>
              </button>
            `
            : ""
        }
      </div>

      <!-- Bandeau Gamification : Roue, Récompenses et Décors -->
      <div class="kids-rewards-banner">
        <button type="button" class="kids-reward-card-btn btn-action-wheel" id="btn-home-wheel">
          <div class="card-icon-spin ${spinsLeft > 0 ? "has-spins" : ""}">🎡</div>
          <div class="card-text">
            <span class="card-heading">Roue Magique</span>
            <span class="card-detail ${spinsLeft > 0 ? "is-available" : ""}">${spinsLeft > 0 ? `${spinsLeft} dispo` : "Demain"}</span>
          </div>
        </button>

        <button type="button" class="kids-reward-card-btn btn-action-gifts" id="btn-home-gifts">
          <div class="card-icon-gift">🎁</div>
          <div class="card-text">
            <span class="card-heading">Mes Cadeaux</span>
            <span class="card-detail">${unlockedCount} sur 100</span>
          </div>
        </button>

        <button type="button" class="kids-reward-card-btn btn-action-bgs" id="btn-home-bgs">
          <div class="card-icon-bg">🖼️</div>
          <div class="card-text">
            <span class="card-heading">Décors</span>
            <span class="card-detail">${unlockedBgsCount} sur ${BACKGROUNDS.length}</span>
          </div>
        </button>
      </div>
    `;

    // Clics Gamification
    homeEl.querySelector("#btn-home-wheel")?.addEventListener("click", () => {
      openLuckyWheelModal(matrixStore, audio, () => renderApp());
    });

    homeEl.querySelector("#btn-home-gifts")?.addEventListener("click", () => {
      openRewardsBoardModal(matrixStore, audio, () => renderApp());
    });

    homeEl.querySelector("#btn-home-bgs")?.addEventListener("click", () => {
      if (activeProfile) {
        openBackgroundGalleryModal({
          profile: activeProfile,
          matrixStore,
          audioService: audio,
          onSelect: () => renderApp()
        });
      }
    });

    // Bouton 1 : Révision guidée
    homeEl.querySelector("#btn-launch-guided")?.addEventListener("click", () => {
      openDurationModal();
    });

    // Bouton 2 : Révision tables
    homeEl.querySelector("#btn-launch-tables")?.addEventListener("click", () => {
      openTableSelectionModal();
    });

    // Bouton 3 : Carnet de suivi
    homeEl.querySelector("#btn-open-carnet")?.addEventListener("click", () => {
      currentTab = "carnet";
      renderApp();
    });

    homeEl.querySelector("#btn-open-snapshots")?.addEventListener("click", () => {
      currentTab = "snapshots";
      renderApp();
    });

    container.appendChild(homeEl);
  }

  // Photographie de la progression avant une séance, pour le bilan de fin
  function snapshotProgress() {
    return {
      points: matrixStore.getPoints(),
      items: new Map(matrixStore.getAll().map((i) => [i.id, { seenCount: i.seenCount, boxLevel: i.boxLevel }]))
    };
  }

  // Bilan commun à la révision guidée et à la révision des tables
  function showSessionBilan(before: ReturnType<typeof snapshotProgress>, practiceTimeMs: number, wasCancelled: boolean) {
    matrixStore.addPracticeTimeMs(practiceTimeMs);

    const after = matrixStore.getAll();
    const discoveredCount = after.filter((i) => i.seenCount > 0 && before.items.get(i.id)?.seenCount === 0).length;
    const consolidatedCount = after.filter((i) => i.boxLevel > (before.items.get(i.id)?.boxLevel ?? 0)).length;
    const pointsGained = Math.max(0, matrixStore.getPoints() - before.points);
    const hasSomethingToShow = pointsGained > 0 || discoveredCount > 0 || consolidatedCount > 0 || practiceTimeMs >= 3000;

    if (activeProfile && (!wasCancelled || hasSomethingToShow)) {
      showRewardsFlow({
        profile: activeProfile,
        discoveredCount,
        consolidatedCount,
        pointsGained,
        oldPoints: before.points,
        matrixStore,
        audioService: audio,
        onDone: () => renderApp()
      });
    } else {
      renderApp();
    }
  }

  // Modale Choix Durée (Révision guidée)
  function openDurationModal() {
    const modal = document.createElement("div");
    modal.className = "session-modal-overlay";

    modal.innerHTML = `
      <div class="session-modal-container prompt-choice-modal">
        <div class="prompt-header">
          <h3>Combien de temps ?</h3>
          <button type="button" class="btn-modal-close" id="btn-close-duration">✕</button>
        </div>

        <div class="choice-durations-grid">
          ${[3, 6, 9, 15]
            .map(
              (m) => `
                <button type="button" class="btn-choice-duration ${sessionConfig.durationMinutes === m ? "active" : ""}" data-m="${m}">
                  <span class="choice-val">${m}</span>
                  <span class="choice-unit">minutes</span>
                </button>
              `
            )
            .join("")}
        </div>

        <button type="button" class="btn-confirm-launch" id="btn-start-guided-now">
          C'est parti ! 🚀
        </button>
      </div>
    `;

    modal.querySelector("#btn-close-duration")?.addEventListener("click", () => modal.remove());

    modal.querySelectorAll(".btn-choice-duration").forEach((b) => {
      b.addEventListener("click", (e) => {
        const m = parseInt((e.currentTarget as HTMLElement).getAttribute("data-m") || "3", 10);
        sessionConfig.durationMinutes = m;
        storage.set("config_duration", m);
        modal.querySelectorAll(".btn-choice-duration").forEach((el) => el.classList.remove("active"));
        (e.currentTarget as HTMLElement).classList.add("active");
      });
    });

    modal.querySelector("#btn-start-guided-now")?.addEventListener("click", () => {
      modal.remove();
      const before = snapshotProgress();

      startSessionModal(
        repetitionEngine,
        audio,
        sessionConfig,
        (res) => showSessionBilan(before, res.actualPracticeTimeMs, false),
        (cancelledTimeMs) => showSessionBilan(before, cancelledTimeMs, true)
      );
    });

    document.body.appendChild(modal);
  }

  // Modale Choix Tables (Révision tables)
  function openTableSelectionModal() {
    const modal = document.createElement("div");
    modal.className = "session-modal-overlay";

    function updateModalContent() {
      const gridEl = modal.querySelector("#tables-modal-grid");
      if (gridEl) {
        gridEl.querySelectorAll(".btn-choice-table").forEach((btn) => {
          const t = parseInt(btn.getAttribute("data-t") || "1", 10);
          if (selectedRevisionTables.has(t)) {
            btn.classList.add("selected");
          } else {
            btn.classList.remove("selected");
          }
        });
      }
      const countEl = modal.querySelector("#count-selected-tables");
      if (countEl) countEl.textContent = `${selectedRevisionTables.size * 10} calculs`;
    }

    modal.innerHTML = `
      <div class="session-modal-container prompt-choice-modal">
        <div class="prompt-header">
          <h3>Choisis tes tables</h3>
          <button type="button" class="btn-modal-close" id="btn-close-tables">✕</button>
        </div>

        <div class="choice-tables-grid" id="tables-modal-grid">
          ${Array.from({ length: 10 }, (_, i) => i + 1)
            .map(
              (t) => `
                <button type="button" class="btn-choice-table ${selectedRevisionTables.has(t) ? "selected" : ""}" data-t="${t}">
                  Table de ${t}
                </button>
              `
            )
            .join("")}
        </div>

        <div class="choice-footer">
          <button type="button" class="btn-choice-helper" id="btn-toggle-all">Toutes</button>
          <button type="button" class="btn-confirm-launch" id="btn-start-tables-now">
            Valider et commencer <span id="count-selected-tables">${selectedRevisionTables.size * 10} calculs</span>
          </button>
        </div>
      </div>
    `;

    modal.querySelector("#btn-close-tables")?.addEventListener("click", () => modal.remove());

    modal.querySelectorAll(".btn-choice-table").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const t = parseInt((e.currentTarget as HTMLElement).getAttribute("data-t") || "1", 10);
        if (selectedRevisionTables.has(t)) {
          if (selectedRevisionTables.size > 1) selectedRevisionTables.delete(t);
        } else {
          selectedRevisionTables.add(t);
        }
        updateModalContent();
      });
    });

    modal.querySelector("#btn-toggle-all")?.addEventListener("click", () => {
      if (selectedRevisionTables.size === 10) {
        selectedRevisionTables = new Set([2, 3]);
      } else {
        selectedRevisionTables = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      }
      updateModalContent();
    });

    modal.querySelector("#btn-start-tables-now")?.addEventListener("click", () => {
      if (selectedRevisionTables.size === 0) return;
      modal.remove();
      const before = snapshotProgress();

      startEvaluationModal(
        Array.from(selectedRevisionTables).sort((a, b) => a - b),
        matrixStore,
        audio,
        (result) => showSessionBilan(before, result.actualPracticeTimeMs, false),
        (cancelledTimeMs) => showSessionBilan(before, cancelledTimeMs, true)
      );
    });

    document.body.appendChild(modal);
  }

  function openDriveModal(): void {
    openGoogleDriveModal({
      storage,
      onDataRestored: () => {
        activeProfile = profileService.getActiveProfile();
        if (activeProfile) {
          matrixStore.setProfile(activeProfile.id);
          repetitionEngine = createRepetitionEngine(matrixStore, sessionConfig);
          initAppBackground(activeProfile.id);
        } else {
          applyAppBackground(BACKGROUNDS[0].filename);
        }
        renderApp();
      }
    });
  }

  // Écran du joueur de test : le snapshot choisi remplace toute sa progression
  function renderSnapshotsView(container: HTMLElement) {
    const profile = activeProfile;
    if (!profile) return;

    renderSnapshotLoader(container, {
      onLoad: (data, snapshot) => {
        importProfileData(storage, profile.id, data);
        storage.set(LAST_SNAPSHOT_KEY, snapshot.title);
        matrixStore.reload();
        repetitionEngine = createRepetitionEngine(matrixStore, sessionConfig);
        initAppBackground(profile.id);
        currentTab = "home";
        renderApp();
      },
      onBack: () => {
        currentTab = "home";
        renderApp();
      }
    });
  }

  // --- 3. CARNET DE SUIVI ESPACE PARENT ---
  function renderCarnetView(container: HTMLElement) {
    container.innerHTML = "";
    if (!activeProfile) return;

    const bar = document.createElement("div");
    bar.className = "carnet-top-bar";
    bar.innerHTML = `
      <button type="button" class="btn-back-home" id="btn-carnet-back">
        Accueil
      </button>
      <h2>Carnet de suivi — ${activeProfile.avatar} ${activeProfile.name}</h2>
    `;
    bar.querySelector("#btn-carnet-back")?.addEventListener("click", () => {
      currentTab = "home";
      renderApp();
    });
    container.appendChild(bar);

    const carnetContainer = document.createElement("div");
    carnetContainer.className = "carnet-content-wrapper";
    container.appendChild(carnetContainer);

    const matrixView = createMatrixView(matrixStore, audio, repetitionEngine, () => {
      openDriveModal();
    });
    matrixView.mount(carnetContainer);
  }

  function renderApp() {
    if (!rootElement) return;
    rootElement.innerHTML = "";

    const shell = renderShell();
    rootElement.appendChild(shell);

    // Écouteur pour changer d'utilisateur via le badge
    shell.querySelector("#btn-switch-user")?.addEventListener("click", () => {
      profileService.logout();
    });

    // Clic sur l icone Cloud dans le header -> Ouvre la sauvegarde Google Drive
    shell.querySelector("#btn-header-cloud")?.addEventListener("click", () => {
      openDriveModal();
    });

    // Clic sur le compteur de points dans le header -> Ouvre le tableau des récompenses
    shell.querySelector("#btn-header-rewards")?.addEventListener("click", () => {
      openRewardsBoardModal(matrixStore, audio, () => renderApp());
    });

    // Mute
    const muteBtn = shell.querySelector("#btn-audio-mute");
    muteBtn?.addEventListener("click", () => {
      const isMuted = audio.toggleMute();
      if (muteBtn) muteBtn.textContent = isMuted ? "🔇" : "🔊";
    });

    // Install PWA
    const installBtn = shell.querySelector("#btn-pwa-install");
    installBtn?.addEventListener("click", async () => {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === "accepted") {
          if (installBtn) (installBtn as HTMLElement).style.display = "none";
        }
        deferredInstallPrompt = null;
      }
    });

    const content = shell.querySelector("#main-content") as HTMLElement;

    // Si aucun joueur n'est connecté -> Afficher l'écran de Login avec (+)
    if (!activeProfile) {
      renderLoginScreen(content);
      return;
    }

    // L'écran des scénarios n'existe que pour le joueur de test
    if (currentTab === "snapshots" && !isTestProfile(activeProfile)) {
      currentTab = "home";
    }

    // Si connecté -> Afficher l'accueil, le carnet ou les scénarios de test
    if (currentTab === "home") {
      renderKidsHome(content);
    } else if (currentTab === "carnet") {
      renderCarnetView(content);
    } else {
      renderSnapshotsView(content);
    }
  }

  return {
    mount(rootSelector: string) {
      const target = document.querySelector(rootSelector);
      if (!target) throw new Error(`Élément racine introuvable : ${rootSelector}`);
      rootElement = target as HTMLElement;
      audio.init();
      renderApp();
    }
  };
}

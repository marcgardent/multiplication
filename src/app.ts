import { createStorageService, onStorageWrite, STORAGE_NAMESPACE } from "./services/storageService";
import { createAudioService } from "./services/audioService";
import { createProfileService, ANIMAL_AVATARS, ProfileService } from "./services/profileService";
import { createMatrixStore, isGiftUnlocked, MatrixStore } from "./core/matrixStore";
import { createRepetitionEngine } from "./core/repetitionEngine";
import { createMatrixView } from "./components/matrixView";
import { createLearningOrderCard } from "./components/learningOrderCard";
import { startSessionModal } from "./components/sessionModal";
import { startEvaluationModal } from "./components/evaluationModal";
import { showRewardsFlow, openRewardsBoardModal } from "./components/rewardsBoard";
import { openLuckyWheelModal } from "./components/luckyWheel";
import { initAppBackground, applyAppBackground, BACKGROUNDS, countUnlockedBackgrounds, keepUnlockedBackgrounds } from "./core/backgrounds";
import { openBackgroundGalleryModal } from "./components/backgroundGalleryModal";
import { describeCloudSync, openGoogleDriveModal } from "./components/googleDriveModal";
import { createCloudSync, sha256Hex } from "./services/cloudSyncService";
import { createGoogleAuth } from "./services/googleAuthService";
import { createParentCodeService } from "./services/parentCodeService";
import { openParentGate } from "./components/parentGate";
import { renderParentArea } from "./components/parentArea";
import {
  downloadDriveBackup,
  downloadDriveVoice,
  exportAllAppData,
  findDriveBackup,
  importAllAppData,
  listDriveVoices,
  uploadDriveBackup,
  uploadDriveVoice
} from "./services/googleDriveService";
import { renderSnapshotLoader } from "./components/snapshotLoaderScreen";
import { importProfileData, profileKey } from "./core/profileData";
import { isTestProfile } from "./testing/snapshots";
import { createWakeLockService } from "./services/wakeLockService";
import { DEFAULT_TABLES, openTableSelectionModal } from "./components/tableSelectionModal";
import { startListeningModal } from "./components/listeningModal";
import { ListeningTab, openListeningSetupModal } from "./components/listeningSetupModal";
import { ListeningMode, ListeningSelection } from "./radio/listeningPlayer";
import { calculationsOf } from "./radio/program";
import { calculationId, manualRounds } from "./radio/spacedSchedule";
import { guidedLabel, guidedPool, guidedRounds, readPlayerProgress } from "./radio/guidedPool";
import { renderVoiceStudio } from "./components/voiceStudio";
import { createVoiceStore } from "./voices/voiceStore";
import { createVoiceSync } from "./voices/voiceSync";
import { createAnswerPreferences } from "./services/answerPreferences";
import { openAnswerModeModal } from "./components/answerModeModal";
import { answerTogglesHtml, bindAnswerToggles } from "./components/answerToggles";
import { openSpeechTestModal } from "./components/speechTestModal";
import { calibrationSummary, openCalibrationModal } from "./components/calibrationModal";
import { isSpeechSupported } from "./voices/speechListener";
import { downloadVoiceModel, isVoiceModelBusy, onVoiceModelReady } from "./voices/voiceModel";
import { MultiplicationItem, SessionConfig, UserProfile } from "./types";

export interface AppInstance {
  mount(rootSelector: string): void;
}

export function createApp(): AppInstance {
  const storage = createStorageService(STORAGE_NAMESPACE);
  const audio = createAudioService();
  // Son et réponse à la voix : choisis avant chaque séance, modifiables à tout moment depuis la barre du haut
  const answerPreferences = createAnswerPreferences(storage);
  audio.setMuted(!answerPreferences.get().sound);
  answerPreferences.subscribe((p) => audio.setMuted(!p.sound));
  // Modèle vocal installé ici : la sauvegarde le dira aux autres appareils
  onVoiceModelReady(() => answerPreferences.markSpeechModelWanted());
  // Réponse à voix haute activée (ici, ou sur un autre appareil via la sauvegarde) : le modèle se télécharge tout seul
  function downloadVoiceModelIfWanted() {
    if (!answerPreferences.isSpeechAllowed()) return;
    if (!isSpeechSupported() || !navigator.onLine || isVoiceModelBusy()) return;
    downloadVoiceModel().catch((err) => console.warn("Téléchargement automatique du modèle vocal", err));
  }
  let unbindHeaderToggles: (() => void) | null = null;
  const wakeLock = createWakeLockService();

  // Sauvegarde automatique dans le Google Drive du parent : chaque écriture de l'application y part toute seule.
  // Ses réglages vivent dans un espace à part, pour ne pas se retrouver eux-mêmes dans la sauvegarde.
  const googleAuth = createGoogleAuth(() => document.querySelector(".session-modal-overlay") !== null);
  const cloudSync = createCloudSync({
    settings: createStorageService("mult_cloud"),
    auth: googleAuth,
    drive: { find: findDriveBackup, upload: uploadDriveBackup, download: downloadDriveBackup },
    exportBackup: () => exportAllAppData(),
    importBackup: (backup) => {
      importAllAppData(backup);
    },
    removeKeys: (fullKeys) => fullKeys.forEach((fullKey) => localStorage.removeItem(fullKey)),
    hash: sha256Hex,
    isOnline: () => navigator.onLine,
    // Une fusion avec un autre appareil attend la fin de la séance ; la fenêtre de sauvegarde, elle, ne gêne pas
    isBusy: () => document.querySelector(".session-modal-overlay:not(.drive-modal-overlay)") !== null,
    onMerged: () => refreshAfterMerge()
  });
  // Voix enregistrées : sur l'appareil, et dans le Drive à côté de la sauvegarde des joueurs, une par fichier
  const voiceStore = createVoiceStore(() => voiceSync.notifyLocalChange());
  const voiceSync = createVoiceSync({
    voices: voiceStore,
    drive: { list: listDriveVoices, upload: uploadDriveVoice, download: downloadDriveVoice },
    settings: createStorageService("mult_cloud"),
    getToken: () => googleAuth.getToken(),
    isEnabled: () => cloudSync.getState().status !== "off",
    isOnline: () => navigator.onLine
  });
  onStorageWrite((fullKey) => {
    if (fullKey.startsWith(`${STORAGE_NAMESPACE}:`)) cloudSync.notifyLocalChange(fullKey);
  });
  window.addEventListener("online", () => {
    cloudSync.refresh();
    voiceSync.requestCheck();
    downloadVoiceModelIfWanted();
  });
  document.addEventListener("visibilitychange", () => {
    // En partant : envoyer ce qui attend. En revenant : voir ce que les autres appareils ont envoyé
    if (document.visibilityState === "hidden") {
      cloudSync.flush();
      voiceSync.run();
    } else {
      cloudSync.refresh();
      voiceSync.requestCheck();
    }
  });
  cloudSync.subscribe((state) => {
    showCloudStatus();
    // La sauvegarde des joueurs vient d'aboutir : la connexion Google est là, les voix en profitent
    if (state.status === "synced") voiceSync.run();
  });

  // Espace parent : sauvegarde et suppression de joueurs, derrière un code que l'appareil garde pour lui
  const parentCode = createParentCodeService(createStorageService("mult_parent"), sha256Hex);
  let isParentAreaOpen = false;
  let isVoiceStudioOpen = false;
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
          <button type="button" class="icon-btn" id="btn-header-cloud" aria-label="Sauvegarde">☁️</button>
          ${answerTogglesHtml()}
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

      <!-- Écoute : ni points, ni progression, même en mode guidé -->
      <div class="kids-menu-container">
        <button type="button" class="kids-main-btn" id="btn-launch-radio">
          <div class="btn-bubble">📻</div>
          <div class="btn-text-block">
            <span class="btn-title">Radio des tables</span>
            <span class="btn-subtitle">Les multiplications en continu, même écran éteint</span>
          </div>
        </button>

        <button type="button" class="kids-main-btn" id="btn-launch-brushing">
          <div class="btn-bubble">🪥</div>
          <div class="btn-text-block">
            <span class="btn-title">Brossage de dents</span>
            <span class="btn-subtitle">3 minutes de tables, l'écran reste allumé</span>
          </div>
        </button>
      </div>

      <!-- Réservé aux adultes : protégé par un code -->
      <div class="kids-menu-container">
        <button type="button" class="kids-main-btn" id="btn-open-parent">
          <div class="btn-bubble">🔒</div>
          <div class="btn-text-block">
            <span class="btn-title">Espace parent</span>
            <span class="btn-subtitle">Sauvegarde et joueurs</span>
          </div>
        </button>

        <button type="button" class="kids-main-btn" id="btn-open-voices">
          <div class="btn-bubble">🎙️</div>
          <div class="btn-text-block">
            <span class="btn-title">Voix enregistrées</span>
            <span class="btn-subtitle">Votre voix à la place de la voix de synthèse</span>
          </div>
        </button>
      </div>
    `;

    loginEl.querySelector("#btn-open-parent")?.addEventListener("click", () => {
      openParentArea();
    });

    // Enregistrer des voix demande le micro : réservé aux adultes, derrière le même code
    loginEl.querySelector("#btn-open-voices")?.addEventListener("click", () => {
      openParentGate({
        parentCode,
        onGranted: () => {
          isVoiceStudioOpen = true;
          renderApp();
        }
      });
    });

    loginEl.querySelector("#btn-launch-radio")?.addEventListener("click", () => {
      openListeningSetup("radio");
    });

    loginEl.querySelector("#btn-launch-brushing")?.addEventListener("click", () => {
      openListeningSetup("brushing");
    });

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

  // Lancement de la radio ou du brossage : mode guidé (joueurs) ou manuel (tables) ; chaque mode retient sa dernière sélection
  function openListeningSetup(mode: ListeningMode) {
    const profiles = profileService.getProfiles();
    const tabKey = `${mode}_listen_tab`;
    const playersKey = `${mode}_players`;
    const tablesKey = `${mode}_tables`;
    const poolFor = (playerIds: string[]) => guidedPool(playerIds.map((id) => readPlayerProgress(storage, id)));

    openListeningSetupModal({
      mode,
      profiles,
      tab: storage.get<ListeningTab>(tabKey, "guided"),
      playerIds: storage.get<string[]>(playersKey, []),
      tables: storage.get<number[]>(tablesKey, DEFAULT_TABLES),
      guidedCount: (playerIds) => poolFor(playerIds).length,
      onConfirm: (choice) => {
        storage.set(tabKey, choice.tab);
        if (choice.tab === "guided") {
          storage.set(playersKey, choice.playerIds);
          const entries = poolFor(choice.playerIds);
          const names = profiles.filter((p) => choice.playerIds.includes(p.id)).map((p) => p.name);
          const pool = entries.map((entry) => entry.calc);
          startListeningModal(mode, listeningSelection(mode, pool, guidedRounds(entries, lastHeardIds(mode)), guidedLabel(names)), wakeLock);
        } else {
          storage.set(tablesKey, choice.tables);
          const pool = calculationsOf(choice.tables);
          const label = `Tables : ${choice.tables.join(", ")}`;
          startListeningModal(mode, listeningSelection(mode, pool, manualRounds(pool, lastHeardIds(mode)), label), wakeLock);
        }
      }
    });
  }

  // Calculs entendus à la dernière écoute de ce mode : l'écoute suivante commence par les autres
  function lastHeardIds(mode: ListeningMode): string[] {
    return storage.get<string[]>(`${mode}_last_heard`, []);
  }

  function listeningSelection(
    mode: ListeningMode,
    pool: ListeningSelection["pool"],
    nextRound: ListeningSelection["nextRound"],
    label: string
  ): ListeningSelection {
    return {
      pool,
      nextRound,
      label,
      onIntroduced: (calcs) => storage.set(`${mode}_last_heard`, calcs.map(calculationId))
    };
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

  // Modale de configuration : Ordre d'apprentissage des tables prioritaires
  function openLearningOrderModal() {
    const modal = document.createElement("div");
    modal.className = "session-modal-overlay";

    const container = document.createElement("div");
    container.className = "session-modal-container prompt-choice-modal learning-order-modal";

    const closeBar = document.createElement("div");
    closeBar.className = "card-close-bar";
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn-modal-close";
    closeBtn.textContent = "✕";
    closeBtn.setAttribute("aria-label", "Fermer");
    closeBar.appendChild(closeBtn);
    container.appendChild(closeBar);

    const card = createLearningOrderCard(matrixStore);
    card.mount(container);

    const footer = document.createElement("div");
    footer.className = "choice-footer";
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "btn-confirm-launch";
    okBtn.textContent = "Fermer ✓";
    footer.appendChild(okBtn);
    container.appendChild(footer);

    modal.appendChild(container);

    const closeModal = () => {
      document.removeEventListener("keydown", onKeyDown);
      card.destroy();
      modal.remove();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModal();
    };
    document.addEventListener("keydown", onKeyDown);

    closeBtn.addEventListener("click", closeModal);
    okBtn.addEventListener("click", closeModal);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeModal();
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
        <!-- Bouton 1 : Révision guidée avec extension de configuration -->
        <div class="guided-btn-container">
          <button type="button" class="kids-main-btn btn-guided" id="btn-launch-guided">
            <div class="btn-bubble">🚀</div>
            <div class="btn-text-block">
              <span class="btn-title">Révision guidée</span>
              <span class="btn-subtitle">Écoute, quiz et défis chrono</span>
            </div>
          </button>
          <button type="button" class="btn-guided-extension" id="btn-open-learning-order" title="Choisir mes tables prioritaires">
            <span class="extension-icon">🎯</span>
            <span class="extension-label">Choisir mes tables prioritaires</span>
            <span class="extension-action">⚙️</span>
          </button>
        </div>

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

    // Extension : Choisir mes tables prioritaires
    homeEl.querySelector("#btn-open-learning-order")?.addEventListener("click", () => {
      openLearningOrderModal();
    });

    // Bouton 2 : Révision tables
    homeEl.querySelector("#btn-launch-tables")?.addEventListener("click", () => {
      openRevisionTablesModal();
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

  // Modale Choix Durée & Files d'apprentissage (Révision guidée)
  function openDurationModal() {
    const modal = document.createElement("div");
    modal.className = "session-modal-overlay";

    function renderSimpleChip(item: MultiplicationItem, subgroupId?: string): string {
      const extraClass = subgroupId ? `chip-${subgroupId}` : "";
      return `
        <div class="queue-item-chip ${extraClass}" title="${item.a} × ${item.b} = ${item.result}">
          <span class="chip-factors">${item.a} × ${item.b}</span>
        </div>
      `;
    }

    interface ReviewSubgroup {
      id: "review" | "listen" | "gift" | "scheduled" | "mastered";
      title: string;
      dotClass: string;
      icon?: string;
      desc: string;
      items: MultiplicationItem[];
    }

    function categorizeReviews(items: MultiplicationItem[]): ReviewSubgroup[] {
      const toReview: MultiplicationItem[] = [];
      const toListen: MultiplicationItem[] = [];
      const almostGift: MultiplicationItem[] = [];
      const scheduled: MultiplicationItem[] = [];
      const mastered: MultiplicationItem[] = [];

      for (const item of items) {
        if (item.status === "review") {
          toReview.push(item);
        } else if (item.boxLevel === 0) {
          toListen.push(item);
        } else if (item.boxLevel === 4) {
          almostGift.push(item);
        } else if (item.status === "mastered" || item.boxLevel >= 5) {
          mastered.push(item);
        } else {
          scheduled.push(item);
        }
      }

      const groups: ReviewSubgroup[] = [];

      if (toReview.length > 0) {
        groups.push({
          id: "review",
          title: "À revoir",
          dotClass: "dot-review",
          desc: "Erreurs récentes",
          items: toReview
        });
      }

      if (toListen.length > 0) {
        groups.push({
          id: "listen",
          title: "À réécouter",
          dotClass: "dot-discovery",
          desc: "Découverte audio",
          items: toListen
        });
      }

      if (almostGift.length > 0) {
        groups.push({
          id: "gift",
          title: "Bientôt le cadeau",
          dotClass: "dot-gift",
          icon: "🎁",
          desc: "21e jour d'ancrage",
          items: almostGift
        });
      }

      if (scheduled.length > 0) {
        groups.push({
          id: "scheduled",
          title: "Révisions programmées",
          dotClass: "dot-discovery",
          desc: "Calendrier espacé",
          items: scheduled
        });
      }

      if (mastered.length > 0) {
        groups.push({
          id: "mastered",
          title: "Entretien",
          dotClass: "dot-mastered",
          desc: "Vérification d'ancrage",
          items: mastered
        });
      }

      return groups;
    }

    function renderQueuesHtml(minutes: number): string {
      const lot = repetitionEngine.previewLot(minutes);
      const qStats = repetitionEngine.getQueueStats(minutes);
      const isOverloaded = repetitionEngine.isReviewQueueOverloaded(minutes);

      const reviewSubgroups = categorizeReviews(lot.reviews);
      const reviewsHtml =
        lot.reviews.length > 0
          ? `
            <div class="queue-card-group group-reviews">
              <div class="queue-group-header">
                <div class="queue-group-title">
                  <span class="queue-badge-icon">🔄</span>
                  <strong>Les révisions</strong>
                  <span class="queue-count-pill">${lot.reviews.length} calcul${lot.reviews.length > 1 ? "s" : ""}</span>
                </div>
                <span class="queue-group-help">Calculs déjà vus, à réviser aujourd'hui pour les retenir</span>
              </div>
              <div class="queue-subgroups-list">
                ${reviewSubgroups
                  .map(
                    (group) => `
                      <div class="queue-subgroup subgroup-${group.id}">
                        <div class="subgroup-header">
                          ${
                            group.icon
                              ? `<span class="subgroup-gift-icon" aria-hidden="true">${group.icon}</span>`
                              : `<span class="dot ${group.dotClass}" aria-hidden="true"></span>`
                          }
                          <strong class="subgroup-title">${group.title}</strong>
                          <span class="subgroup-desc">${group.desc}</span>
                        </div>
                        <div class="queue-chips-grid">
                          ${group.items.map((i) => renderSimpleChip(i, group.id)).join("")}
                        </div>
                      </div>
                    `
                  )
                  .join("")}
              </div>
            </div>
          `
          : `
            <div class="queue-card-group group-empty">
              <div class="queue-group-header">
                <div class="queue-group-title">
                  <span class="queue-badge-icon">🔄</span>
                  <strong>Les révisions</strong>
                  <span class="queue-count-pill">0</span>
                </div>
                <span class="queue-group-help">✨ Aucune révision en attente : tu es parfaitement à jour !</span>
              </div>
            </div>
          `;

      let newsHtml = "";
      if (lot.news.length > 0) {
        const newsByTable = new Map<number, MultiplicationItem[]>();
        for (const item of lot.news) {
          const list = newsByTable.get(item.a) ?? [];
          list.push(item);
          newsByTable.set(item.a, list);
        }

        newsHtml = `
          <div class="queue-card-group group-news">
            <div class="queue-group-header">
              <div class="queue-group-title">
                <span class="queue-badge-icon">✨</span>
                <strong>Les nouveaux</strong>
                <span class="queue-count-pill">${lot.news.length} calcul${lot.news.length > 1 ? "s" : ""}</span>
              </div>
              <span class="queue-group-help">Multiplications que tu découvres aujourd'hui</span>
            </div>
            <div class="queue-subgroups-list">
              ${Array.from(newsByTable.entries())
                .map(
                  ([tableNum, items]) => `
                    <div class="queue-subgroup subgroup-news">
                      <div class="subgroup-header">
                        <span class="dot dot-discovery" aria-hidden="true"></span>
                        <strong class="subgroup-title">Table de ${tableNum}</strong>
                        <span class="subgroup-desc">Nouvelle découverte</span>
                      </div>
                      <div class="queue-chips-grid">
                        ${items.map((i) => renderSimpleChip(i, "news")).join("")}
                      </div>
                    </div>
                  `
                )
                .join("")}
            </div>
          </div>
        `;
      } else if (isOverloaded) {
        newsHtml = `
          <div class="queue-info-banner banner-warning">
            <span class="banner-icon">🛡️</span>
            <div class="banner-text">
              <strong>Priorité aux révisions</strong>
              <p>Tu as ${lot.reviews.length} révisions à consolider d'abord. L'application attend que tu maîtrises ces calculs avant d'en ajouter de nouveaux pour ne pas te surcharger !</p>
            </div>
          </div>
        `;
      } else if (qStats.newAvailableCount === 0) {
        newsHtml = `
          <div class="queue-info-banner banner-success">
            <span class="banner-icon">🏆</span>
            <div class="banner-text">
              <strong>Toutes les tables découvertes !</strong>
              <p>Tu as déjà abordé les 100 multiplications. Tes séances consolident la vitesse et les révisions d'entretien.</p>
            </div>
          </div>
        `;
      } else {
        newsHtml = `
          <div class="queue-info-banner banner-neutral">
            <span class="banner-icon">💡</span>
            <div class="banner-text">
              <p>Séance de ${minutes} min axée sur tes révisions. Choisis 6, 9 ou 15 minutes pour ajouter de nouveaux calculs.</p>
            </div>
          </div>
        `;
      }

      const reinforceHtml =
        lot.reinforcements.length > 0
          ? `
            <div class="queue-card-group group-reinforce">
              <div class="queue-group-header">
                <div class="queue-group-title">
                  <span class="queue-badge-icon">⚡</span>
                  <strong>Calculs de renfort</strong>
                  <span class="queue-count-pill">${lot.reinforcements.length}</span>
                </div>
                <span class="queue-group-help">Calculs en cours pour compléter la séance</span>
              </div>
              <div class="queue-subgroups-list">
                <div class="queue-subgroup subgroup-reinforce">
                  <div class="subgroup-header">
                    <span class="dot dot-discovery" aria-hidden="true"></span>
                    <strong class="subgroup-title">En consolidation</strong>
                    <span class="subgroup-desc">Entraînement supplémentaire</span>
                  </div>
                  <div class="queue-chips-grid">
                    ${lot.reinforcements.map((i) => renderSimpleChip(i, "reinforce")).join("")}
                  </div>
                </div>
              </div>
            </div>
          `
          : "";

      const hasDiscovery = lot.reviews.filter((i) => i.boxLevel === 0).length + lot.news.length > 0;
      const workshopsSummary = hasDiscovery
        ? "3 ateliers : 🎧 Découverte → 🎯 Quiz → ⚡ Défi Chrono"
        : "2 ateliers : 🎯 Quiz → ⚡ Défi Chrono";

      return `
        <details class="session-lot-program-card">
          <summary class="program-card-header">
            <div class="program-header-titles">
              <span class="program-title">📋 <strong>${lot.items.length} calculs</strong> au programme de cette séance</span>
              <span class="program-workshops-tag">${workshopsSummary}</span>
            </div>
            <span class="program-expand-hint" aria-hidden="true">Détail</span>
          </summary>

          <div class="program-card-content">
            <div class="queues-groups-list">
              ${reviewsHtml}
              ${newsHtml}
              ${reinforceHtml}
            </div>

            <div class="queues-kpi-summary">
              <div class="kpi-mini-item">
                <span class="kpi-mini-num color-review">${qStats.dueCount}</span>
                <span class="kpi-mini-lbl">À réviser</span>
              </div>
              <div class="kpi-mini-item">
                <span class="kpi-mini-num color-learning">${qStats.learningCount}</span>
                <span class="kpi-mini-lbl">En apprentissage</span>
              </div>
              <div class="kpi-mini-item">
                <span class="kpi-mini-num color-mastered">${qStats.masteredCount}</span>
                <span class="kpi-mini-lbl">Maîtrisés 🎁</span>
              </div>
              <div class="kpi-mini-item">
                <span class="kpi-mini-num color-unknown">${qStats.newAvailableCount}</span>
                <span class="kpi-mini-lbl">À découvrir</span>
              </div>
            </div>
          </div>
        </details>
      `;
    }

    modal.innerHTML = `
      <div class="session-modal-container prompt-choice-modal duration-queues-modal">
        <div class="prompt-header">
          <div>
            <h3>🎯 Révision guidée</h3>
            <p class="modal-subheading">Choisis ta durée & découvre le programme</p>
          </div>
          <button type="button" class="btn-modal-close" id="btn-close-duration" aria-label="Fermer">✕</button>
        </div>

        <div class="duration-picker-block">
          <span class="block-mini-title">⏱️ Durée de la séance</span>
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
        </div>

        <div id="guided-queues-preview">
          ${renderQueuesHtml(sessionConfig.durationMinutes)}
        </div>

        <button type="button" class="btn-confirm-launch" id="btn-start-guided-now">
          C'est parti pour ${sessionConfig.durationMinutes} min ! 🚀
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

        const previewContainer = modal.querySelector("#guided-queues-preview");
        if (previewContainer) {
          const wasOpen = previewContainer.querySelector("details.session-lot-program-card")?.hasAttribute("open");
          previewContainer.innerHTML = renderQueuesHtml(m);
          if (wasOpen) {
            previewContainer.querySelector("details.session-lot-program-card")?.setAttribute("open", "");
          }
        }

        const btnLaunch = modal.querySelector("#btn-start-guided-now");
        if (btnLaunch) {
          btnLaunch.textContent = `C'est parti pour ${m} min ! 🚀`;
        }
      });
    });

    modal.querySelector("#btn-start-guided-now")?.addEventListener("click", () => {
      modal.remove();
      openAnswerModeModal({
        preferences: answerPreferences,
        onConfirm: () => {
          const before = snapshotProgress();
          const releaseScreen = wakeLock.keepAwake();

          startSessionModal(
            repetitionEngine,
            audio,
            answerPreferences,
            sessionConfig,
            (res) => {
              releaseScreen();
              showSessionBilan(before, res.actualPracticeTimeMs, false);
            },
            (cancelledTimeMs) => {
              releaseScreen();
              showSessionBilan(before, cancelledTimeMs, true);
            }
          );
        }
      });
    });

    document.body.appendChild(modal);
  }

  // Modale Choix Tables (Révision tables) : chaque joueur retient sa propre sélection
  function openRevisionTablesModal() {
    const revisionKey = activeProfile ? profileKey("selected_tables", activeProfile.id) : "selected_tables_guest";
    openTableSelectionModal({
      selected: storage.get<number[]>(revisionKey, DEFAULT_TABLES),
      confirmLabel: "Valider et commencer",
      onConfirm: (tables) => {
        storage.set(revisionKey, tables);
        openAnswerModeModal({
          preferences: answerPreferences,
          onConfirm: () => {
            const before = snapshotProgress();
            const releaseScreen = wakeLock.keepAwake();

            startEvaluationModal(
              tables,
              matrixStore,
              audio,
              answerPreferences,
              (result) => {
                releaseScreen();
                showSessionBilan(before, result.actualPracticeTimeMs, false);
              },
              (cancelledTimeMs) => {
                releaseScreen();
                showSessionBilan(before, cancelledTimeMs, true);
              }
            );
          }
        });
      }
    });
  }

  function openDriveModal(): void {
    openGoogleDriveModal({
      cloudSync,
      auth: googleAuth,
      // Joueurs, progression et décor viennent d'être remplacés : on repart des données restaurées
      onDataRestored: () => window.location.reload()
    });
  }

  // Les données viennent d'être fusionnées avec celles d'un autre appareil : tout est relu, sans recharger la page
  function refreshAfterMerge() {
    profileService.reload();
    profileService.getProfiles().forEach((p) => keepUnlockedBackgrounds(p.id));
    matrixStore.reload();
    repetitionEngine = createRepetitionEngine(matrixStore, sessionConfig);
    sessionConfig.durationMinutes = storage.get<number>("config_duration", sessionConfig.durationMinutes);
    if (activeProfile) initAppBackground(activeProfile.id);
    renderApp();
    downloadVoiceModelIfWanted();
  }

  // Le code est demandé à chaque entrée dans l'espace parent
  function openParentArea() {
    if (isParentAreaOpen) return;
    openParentGate({
      parentCode,
      onGranted: () => {
        isParentAreaOpen = true;
        renderApp();
      }
    });
  }

  function renderParentAreaView(container: HTMLElement) {
    renderParentArea(container, {
      profiles: profileService.getProfiles(),
      backupStatus: describeCloudSync(cloudSync.getState()),
      onOpenBackup: () => openDriveModal(),
      onDeleteProfile: (profile) => {
        profileService.deleteProfile(profile.id);
        // Le joueur supprimé était peut-être celui dont la progression est en mémoire
        if (!profileService.getActiveProfile()) matrixStore.setProfile("guest");
        renderApp();
      },
      onChangeCode: () => openParentGate({ parentCode, isChangingCode: true, onGranted: () => undefined }),
      speech: {
        isAllowed: answerPreferences.isSpeechAllowed(),
        onChange: (allowed) => answerPreferences.setSpeechAllowed(allowed),
        openTest: openSpeechTestModal,
        calibrationText: () => {
          const calibration = answerPreferences.speechCalibration();
          return calibration ? calibrationSummary(calibration) : null;
        },
        openCalibration: (onDone) => openCalibrationModal({ preferences: answerPreferences, onDone }),
        listenMode: answerPreferences.listenMode(),
        isPhoneSlow: () => {
          const verdict = answerPreferences.speechCalibration()?.verdict;
          return verdict === "slow" || verdict === "unusable";
        },
        onListenMode: (mode) => answerPreferences.setListenMode(mode)
      },
      onBack: () => {
        isParentAreaOpen = false;
        renderApp();
      }
    });
  }

  // Pastille du bouton ☁️ : sauvegarde à jour, en attente, ou qui demande l'intervention du parent
  function showCloudStatus() {
    const button = document.getElementById("btn-header-cloud");
    if (!button) return;
    const state = cloudSync.getState();
    button.dataset.sync = state.status;
    button.setAttribute("aria-label", `Sauvegarde : ${describeCloudSync(state)}`);
    button.title = `Sauvegarde : ${describeCloudSync(state)}`;
    const parentStatus = document.getElementById("parent-backup-status");
    if (parentStatus) parentStatus.textContent = describeCloudSync(state);
  }

  // Écran du joueur de test : le snapshot choisi remplace toute sa progression
  function renderSnapshotsView(container: HTMLElement) {
    const profile = activeProfile;
    if (!profile) return;

    renderSnapshotLoader(container, {
      onLoad: (data, snapshot) => {
        importProfileData(storage, profile.id, data);
        storage.set(LAST_SNAPSHOT_KEY, snapshot.title);
        // Un scénario remplace la progression : il remplace aussi la sauvegarde du Drive, sans fusion
        cloudSync.startNewLineage();
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

    const matrixView = createMatrixView(matrixStore, audio, repetitionEngine);
    matrixView.mount(carnetContainer);
  }

  // Bas de l'écran des joueurs : les pages du site, hors de l'application
  function renderSiteLinks(container: HTMLElement) {
    const site = import.meta.env.BASE_URL;
    const linksEl = document.createElement("nav");
    linksEl.className = "app-site-links";
    linksEl.setAttribute("aria-label", "Informations");
    linksEl.innerHTML = `
      <a href="${site}?presentation" target="_blank" rel="noopener">Présentation</a>
      <a href="${site}conditions.html" target="_blank" rel="noopener">Conditions d'utilisation</a>
      <a href="${site}confidentialite.html" target="_blank" rel="noopener">Confidentialité</a>
    `;
    container.appendChild(linksEl);
  }

  // Bas des deux écrans d'accueil : la version installée
  function renderVersion(container: HTMLElement) {
    const versionEl = document.createElement("p");
    versionEl.className = "app-version";
    versionEl.textContent = `Version ${__APP_VERSION__}`;
    container.appendChild(versionEl);
  }


  function renderApp() {
    if (!rootElement) return;
    rootElement.innerHTML = "";

    const shell = renderShell();
    rootElement.appendChild(shell);
    showCloudStatus();

    // Écouteur pour changer d'utilisateur via le badge
    shell.querySelector("#btn-switch-user")?.addEventListener("click", () => {
      profileService.logout();
    });

    // Le nuage montre l'état de la sauvegarde ; y toucher mène à l'espace parent, donc au code
    shell.querySelector("#btn-header-cloud")?.addEventListener("click", () => {
      if (isParentAreaOpen) openDriveModal();
      else openParentArea();
    });

    // Clic sur le compteur de points dans le header -> Ouvre le tableau des récompenses
    shell.querySelector("#btn-header-rewards")?.addEventListener("click", () => {
      openRewardsBoardModal(matrixStore, audio, () => renderApp());
    });

    // Son et réponse à la voix
    unbindHeaderToggles?.();
    unbindHeaderToggles = bindAnswerToggles(shell, answerPreferences);

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

    if (isParentAreaOpen) {
      renderParentAreaView(content);
      return;
    }

    if (isVoiceStudioOpen) {
      renderVoiceStudio(content, {
        store: voiceStore,
        onBack: () => {
          isVoiceStudioOpen = false;
          renderApp();
        }
      });
      return;
    }

    // Si aucun joueur n'est connecté -> Afficher l'écran de Login avec (+)
    if (!activeProfile) {
      renderLoginScreen(content);
      renderSiteLinks(content);
      renderVersion(content);
      return;
    }

    // L'écran des scénarios n'existe que pour le joueur de test
    if (currentTab === "snapshots" && !isTestProfile(activeProfile)) {
      currentTab = "home";
    }

    // Si connecté -> Afficher l'accueil, le carnet ou les scénarios de test
    if (currentTab === "home") {
      renderKidsHome(content);
      renderVersion(content);
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
      voiceStore
        .applyAll()
        .catch((err) => console.warn("Voix enregistrées indisponibles", err))
        .then(() => voiceSync.requestCheck());
      renderApp();
      cloudSync.start();
      downloadVoiceModelIfWanted();
    }
  };
}

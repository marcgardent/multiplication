import { StorageService } from "../services/storageService";
import {
  getSavedClientId,
  saveClientId,
  getLastSyncTime,
  setLastSyncTime,
  exportAllAppData,
  importAllAppData,
  downloadLocalBackup,
  readLocalBackupFile,
  loadGsiScript,
  requestGoogleAccessToken,
  uploadDriveBackup,
  downloadDriveBackup
} from "../services/googleDriveService";

export interface GoogleDriveModalOptions {
  storage: StorageService;
  onDataRestored: () => void;
}

export function openGoogleDriveModal(options: GoogleDriveModalOptions): HTMLElement {
  const { storage, onDataRestored } = options;

  let currentAccessToken: string | null = null;
  let currentClientId = getSavedClientId(storage);

  const modal = document.createElement("div");
  modal.className = "session-modal-overlay drive-modal-overlay";

  function formatSyncDate(timestamp: number): string {
    if (!timestamp) return "Aucune synchronisation";
    const d = new Date(timestamp);
    const day = d.toLocaleDateString("fr-FR");
    const time = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    return `${day} à ${time}`;
  }

  function renderModalContent(): void {
    const lastSyncTime = getLastSyncTime(storage);
    const lastSyncFormatted = formatSyncDate(lastSyncTime);
    const isConnected = Boolean(currentAccessToken);

    modal.innerHTML = `
      <div class="session-modal-container drive-modal-card">
        <div class="session-modal-header drive-modal-header">
          <div class="drive-modal-title">
            <span class="drive-cloud-icon">☁️</span>
            <h3>Sauvegarde Google Drive</h3>
          </div>
          <button type="button" class="btn-close" aria-label="Fermer">✕</button>
        </div>

        <div class="drive-modal-body">
          <div class="drive-info-banner">
            <p>
              Enregistrez l ensemble de vos données et profils dans l espace sécurisé App Data de Google Drive.
              Cet espace privé reste réservé à l application et invisible dans les dossiers ordinaires.
            </p>
          </div>

          <div class="drive-section-card">
            <div class="section-title-row">
              <h4>1. Identifiant Client Google Cloud</h4>
            </div>
            <p class="section-hint">
              Indiquez votre Identifiant Client OAuth pour autoriser la connexion avec votre compte Google.
            </p>
            <div class="client-id-input-group">
              <input
                type="text"
                id="drive-client-id-input"
                class="drive-text-input"
                placeholder="Exemple : 123456789-abc.apps.googleusercontent.com"
                value="${currentClientId}"
              />
              <button type="button" class="btn-save-key" id="btn-save-client-id">
                Enregistrer
              </button>
            </div>
          </div>

          <div class="drive-section-card">
            <div class="section-title-row">
              <h4>2. Synchronisation en ligne</h4>
              <span class="drive-status-badge ${isConnected ? "badge-online" : "badge-offline"}">
                ${isConnected ? "Connecté" : "Non connecté"}
              </span>
            </div>

            <div class="drive-sync-meta">
              <span class="meta-label">Dernière sauvegarde :</span>
              <span class="meta-val" id="drive-last-sync-label">${lastSyncFormatted}</span>
            </div>

            <div class="drive-actions-group">
              ${
                !isConnected
                  ? `
                    <button type="button" class="btn-drive-action btn-drive-login" id="btn-drive-login">
                      🔑 Se connecter à Google Drive
                    </button>
                  `
                  : `
                    <button type="button" class="btn-drive-action btn-drive-upload" id="btn-drive-upload">
                      ⬆️ Sauvegarder sur Google Drive
                    </button>
                    <button type="button" class="btn-drive-action btn-drive-download" id="btn-drive-download">
                      ⬇️ Restaurer depuis Google Drive
                    </button>
                    <button type="button" class="btn-drive-action btn-drive-logout" id="btn-drive-logout">
                      Déconnexion
                    </button>
                  `
              }
            </div>

            <div class="drive-feedback-log" id="drive-feedback-log" style="display: none;"></div>
          </div>

          <div class="drive-section-card">
            <div class="section-title-row">
              <h4>3. Copie locale sur cet appareil</h4>
            </div>
            <p class="section-hint">
              Téléchargez un fichier de sauvegarde directement sur votre disque ou importez un fichier existant.
            </p>
            <div class="local-actions-group">
              <button type="button" class="btn-drive-action btn-local-export" id="btn-local-export">
                💾 Télécharger le fichier JSON
              </button>
              <button type="button" class="btn-drive-action btn-local-import" id="btn-local-import">
                📥 Importer un fichier JSON
              </button>
              <input type="file" id="local-file-picker" accept=".json" style="display: none;" />
            </div>
          </div>
        </div>
      </div>
    `;

    attachEvents();
  }

  function setLog(message: string, isError = false): void {
    const logBox = modal.querySelector("#drive-feedback-log") as HTMLElement | null;
    if (!logBox) return;
    logBox.style.display = "block";
    logBox.className = `drive-feedback-log ${isError ? "log-error" : "log-success"}`;
    logBox.textContent = message;
  }

  function attachEvents(): void {
    modal.querySelector(".btn-close")?.addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    modal.querySelector("#btn-save-client-id")?.addEventListener("click", () => {
      const input = modal.querySelector("#drive-client-id-input") as HTMLInputElement | null;
      if (input) {
        currentClientId = input.value.trim();
        saveClientId(storage, currentClientId);
        setLog("Identifiant Client Google Cloud enregistré");
      }
    });

    modal.querySelector("#btn-drive-login")?.addEventListener("click", async () => {
      if (!currentClientId) {
        setLog("Veuillez renseigner un Identifiant Client Google Cloud à l étape 1", true);
        return;
      }
      setLog("Chargement du service d authentification Google...");
      try {
        await loadGsiScript();
        setLog("Connexion en cours...");
        const token = await requestGoogleAccessToken(currentClientId);
        currentAccessToken = token;
        renderModalContent();
        setLog("Connexion réussie à Google Drive");
      } catch (err: any) {
        setLog(err?.message || "Échec de connexion à Google", true);
      }
    });

    modal.querySelector("#btn-drive-logout")?.addEventListener("click", () => {
      currentAccessToken = null;
      renderModalContent();
      setLog("Déconnexion effectuée");
    });

    modal.querySelector("#btn-drive-upload")?.addEventListener("click", async () => {
      if (!currentAccessToken) {
        setLog("Veuillez vous connecter avant de sauvegarder", true);
        return;
      }
      setLog("Préparation et envoi des données vers Google Drive...");
      try {
        const backup = exportAllAppData();
        await uploadDriveBackup(currentAccessToken, backup);
        const now = Date.now();
        setLastSyncTime(storage, now);
        renderModalContent();
        setLog("Données enregistrées avec succès dans l espace App Data de Google Drive");
      } catch (err: any) {
        setLog(err?.message || "Erreur lors de la sauvegarde sur Google Drive", true);
      }
    });

    modal.querySelector("#btn-drive-download")?.addEventListener("click", async () => {
      if (!currentAccessToken) {
        setLog("Veuillez vous connecter avant de restaurer", true);
        return;
      }
      setLog("Récupération de la sauvegarde depuis Google Drive...");
      try {
        const backup = await downloadDriveBackup(currentAccessToken);
        importAllAppData(backup);
        setLog("Restauration réussie des données depuis Google Drive");
        onDataRestored();
      } catch (err: any) {
        setLog(err?.message || "Erreur lors de la restauration depuis Google Drive", true);
      }
    });

    modal.querySelector("#btn-local-export")?.addEventListener("click", () => {
      try {
        const backup = exportAllAppData();
        downloadLocalBackup(backup);
        setLog("Fichier de sauvegarde exporté avec succès");
      } catch (err: any) {
        setLog(err?.message || "Erreur lors de l export local", true);
      }
    });

    const filePicker = modal.querySelector("#local-file-picker") as HTMLInputElement | null;
    modal.querySelector("#btn-local-import")?.addEventListener("click", () => {
      filePicker?.click();
    });

    filePicker?.addEventListener("change", async () => {
      const file = filePicker.files?.[0];
      if (!file) return;
      setLog("Lecture du fichier de sauvegarde...");
      try {
        const backup = await readLocalBackupFile(file);
        importAllAppData(backup);
        setLog("Fichier importé avec succès. Mise à jour des profils...");
        onDataRestored();
      } catch (err: any) {
        setLog(err?.message || "Fichier invalide ou illisible", true);
      }
    });
  }

  renderModalContent();
  document.body.appendChild(modal);
  return modal;
}

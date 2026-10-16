import { CloudSync, CloudSyncState } from "../services/cloudSyncService";
import { GoogleAuth } from "../services/googleAuthService";
import { exportAllAppData, importAllAppData, downloadLocalBackup, readLocalBackupFile } from "../services/googleDriveService";

export interface GoogleDriveModalOptions {
  cloudSync: CloudSync;
  auth: GoogleAuth;
  onDataRestored: () => void;
}

function formatDate(date: number | string): string {
  if (!date) return "jamais";
  const d = new Date(date);
  return `${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

// Libellé court de l'état de la sauvegarde, repris par le bouton ☁️ de l'en-tête
export function describeCloudSync(state: CloudSyncState): string {
  if (state.status === "off") return "Désactivée";
  if (state.status === "synced") return "À jour";
  if (state.status === "pending") return "Envoi en attente";
  if (state.issue === "signin") return "Reconnexion nécessaire";
  if (state.issue === "conflict") return "Choix nécessaire";
  return "Erreur";
}

export function openGoogleDriveModal(options: GoogleDriveModalOptions): HTMLElement {
  const { cloudSync, auth, onDataRestored } = options;

  // Message de la dernière action, conservé quand l'état de la sauvegarde change
  let feedback: { message: string; isError: boolean } | null = null;
  let isWorking = false;

  const modal = document.createElement("div");
  modal.className = "session-modal-overlay drive-modal-overlay";

  function renderSyncSection(state: CloudSyncState): string {
    if (state.status === "off") {
      return `
        <p class="section-hint">
          À activer une fois sur chaque appareil, avec le même compte Google. Les progrès de cet appareil sont alors fusionnés
          avec ceux déjà présents dans votre Drive : rien n'est écrasé, ni d'un côté ni de l'autre.
        </p>
        <div class="drive-actions-group">
          <button type="button" class="btn-drive-action btn-drive-login" data-action="enable">
            Activer la synchronisation cloud
          </button>
        </div>
      `;
    }

    if (state.issue === "conflict") {
      return `
        <p class="section-hint">
          ${
            state.remoteModifiedTime
              ? `La sauvegarde de votre Drive a été remplacée depuis un autre appareil, le ${formatDate(state.remoteModifiedTime)}.`
              : "La dernière synchronisation a été interrompue avant la fin."
          }
          Laquelle faut-il garder ?
        </p>
        <div class="drive-actions-group">
          <button type="button" class="btn-drive-action btn-drive-download" data-action="restore">
            ⬇️ Reprendre la sauvegarde du Drive sur cet appareil
          </button>
          <button type="button" class="btn-drive-action btn-drive-download" data-action="keep-local">
            ⬆️ Garder cet appareil et remplacer la sauvegarde
          </button>
          <button type="button" class="btn-drive-action btn-drive-logout" data-action="disable">Désactiver</button>
        </div>
      `;
    }

    const hint =
      state.issue === "signin"
        ? "Google demande de vous reconnecter. Les progrès restent enregistrés sur cet appareil en attendant."
        : state.issue === "error"
          ? `L'envoi a échoué : ${state.errorMessage}. Il sera retenté au prochain progrès.`
          : state.status === "pending"
            ? "Les derniers progrès partiront dès que possible : au retour du réseau, ou au prochain toucher sur l'accueil."
            : "Chaque progrès est fusionné avec ceux de vos autres appareils, dans les deux sens, sans rien avoir à faire.";

    return `
      <div class="drive-sync-meta">
        <span class="meta-label">Dernière synchronisation :</span>
        <span class="meta-val">${formatDate(state.lastPushAt)}</span>
      </div>
      <p class="section-hint">${hint}</p>
      <div class="drive-actions-group">
        ${
          state.issue
            ? `<button type="button" class="btn-drive-action btn-drive-login" data-action="reconnect">
                ${state.issue === "signin" ? "Se reconnecter à Google" : "Réessayer"}
              </button>`
            : ""
        }
        <button type="button" class="btn-drive-action btn-drive-logout" data-action="disable">Désactiver</button>
      </div>
    `;
  }

  function render(): void {
    const state = cloudSync.getState();
    const badgeClass = state.status === "synced" ? "badge-online" : state.status === "attention" ? "badge-attention" : "badge-offline";

    modal.innerHTML = `
      <div class="session-modal-container drive-modal-card">
        <div class="session-modal-header drive-modal-header">
          <div class="drive-modal-title">
            <span class="drive-cloud-icon">☁️</span>
            <h3>Sauvegarde</h3>
          </div>
          <button type="button" class="btn-close" aria-label="Fermer">✕</button>
        </div>

        <div class="drive-modal-body">
          <div class="drive-info-banner">
            <p>
              Enregistrez tous les joueurs et leur progression dans votre Google Drive, pour les retrouver sur un autre appareil.
              L'application n'accède qu'à son propre dossier caché, jamais à vos autres fichiers.
              <a href="${import.meta.env.BASE_URL}confidentialite.html" target="_blank" rel="noopener">Politique de confidentialité</a>
            </p>
          </div>

          <div class="drive-section-card">
            <div class="section-title-row">
              <h4>1. Synchronisation cloud</h4>
              <span class="drive-status-badge ${badgeClass}">${describeCloudSync(state)}</span>
            </div>
            ${renderSyncSection(state)}
            ${
              feedback
                ? `<div class="drive-feedback-log ${feedback.isError ? "log-error" : "log-success"}">${feedback.message}</div>`
                : ""
            }
          </div>

          <div class="drive-section-card">
            <div class="section-title-row">
              <h4>2. Copie sur cet appareil</h4>
            </div>
            <p class="section-hint">
              Téléchargez un fichier de sauvegarde sur cet appareil, ou importez un fichier existant.
            </p>
            <div class="local-actions-group">
              <button type="button" class="btn-drive-action btn-local-export" data-action="local-export">
                💾 Télécharger la sauvegarde
              </button>
              <button type="button" class="btn-drive-action btn-local-import" data-action="local-import">
                📥 Importer une sauvegarde
              </button>
              <input type="file" id="local-file-picker" accept=".json" style="display: none;" />
            </div>
          </div>
        </div>
      </div>
    `;

    modal.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
      button.disabled = isWorking;
      button.addEventListener("click", () => runAction(button.dataset.action ?? ""));
    });
    modal.querySelector(".btn-close")?.addEventListener("click", close);
    modal.querySelector("#local-file-picker")?.addEventListener("change", importLocalFile);
  }

  function setFeedback(message: string, isError = false): void {
    feedback = { message, isError };
    render();
  }

  // Une action Google à la fois ; son résultat s'affiche sous les boutons
  async function runGoogleAction(pending: string, done: string, action: () => Promise<void>): Promise<boolean> {
    isWorking = true;
    setFeedback(pending);
    try {
      // Le service de connexion doit être chargé avant d'ouvrir la fenêtre Google
      await auth.prepare();
      await action();
      isWorking = false;
      setFeedback(done);
      return true;
    } catch (err) {
      isWorking = false;
      setFeedback(err instanceof Error ? err.message : "Échec de l'opération", true);
      return false;
    }
  }

  async function runAction(action: string): Promise<void> {
    if (action === "enable") {
      await runGoogleAction("Connexion à Google...", "Synchronisation cloud activée", () => cloudSync.enable());
    } else if (action === "reconnect") {
      await runGoogleAction("Connexion à Google...", "Connexion rétablie", () => cloudSync.reconnect());
    } else if (action === "keep-local") {
      await runGoogleAction("Envoi vers Google Drive...", "Sauvegarde remplacée par les données de cet appareil", () =>
        cloudSync.keepLocal()
      );
    } else if (action === "restore") {
      const isRestored = await runGoogleAction("Récupération depuis Google Drive...", "Données restaurées", () =>
        cloudSync.restoreRemote()
      );
      if (isRestored) onDataRestored();
    } else if (action === "disable") {
      cloudSync.disable();
      setFeedback("Synchronisation cloud désactivée. La sauvegarde déjà présente dans votre Drive n'est pas supprimée.");
    } else if (action === "local-export") {
      downloadLocalBackup(exportAllAppData());
      setFeedback("Fichier de sauvegarde téléchargé");
    } else if (action === "local-import") {
      (modal.querySelector("#local-file-picker") as HTMLInputElement | null)?.click();
    }
  }

  async function importLocalFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      importAllAppData(await readLocalBackupFile(file));
      // Le parent remplace les données : elles remplaceront aussi la sauvegarde du Drive, sans fusion
      cloudSync.startNewLineage();
      onDataRestored();
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Fichier invalide ou illisible", true);
    }
  }

  const unsubscribe = cloudSync.subscribe(() => render());

  function close(): void {
    unsubscribe();
    modal.remove();
  }

  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  render();
  document.body.appendChild(modal);
  // Chargé dès l'ouverture : un clic sur « Activer » ouvre alors la fenêtre Google sans délai
  auth.prepare().catch(() => undefined);
  return modal;
}

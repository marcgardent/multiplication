import { UserProfile } from "../types";

// Espace parent : réglages réservés aux adultes, derrière le code à 4 chiffres

export interface ParentAreaOptions {
  profiles: UserProfile[];
  // État de la sauvegarde, en clair : « À jour », « Désactivée »...
  backupStatus: string;
  onOpenBackup(): void;
  onDeleteProfile(profile: UserProfile): void;
  onChangeCode(): void;
  onBack(): void;
}

export function renderParentArea(container: HTMLElement, options: ParentAreaOptions): void {
  container.innerHTML = "";

  const bar = document.createElement("div");
  bar.className = "carnet-top-bar";
  bar.innerHTML = `
    <button type="button" class="btn-back-home" id="btn-parent-back">Accueil</button>
    <h2>Espace parent</h2>
  `;
  bar.querySelector("#btn-parent-back")?.addEventListener("click", options.onBack);
  container.appendChild(bar);

  const area = document.createElement("div");
  area.className = "parent-area";
  area.innerHTML = `
    <section class="parent-card">
      <div class="parent-card-head">
        <h3>☁️ Sauvegarde</h3>
        <span class="parent-card-status" id="parent-backup-status">${options.backupStatus}</span>
      </div>
      <p>Enregistrez les joueurs et leur progression dans votre Google Drive, ou dans un fichier sur cet appareil.</p>
      <button type="button" class="btn-confirm-launch" id="btn-parent-backup">Ouvrir la sauvegarde</button>
    </section>

    <section class="parent-card">
      <div class="parent-card-head">
        <h3>👥 Joueurs</h3>
      </div>
      ${
        options.profiles.length === 0
          ? `<p>Aucun joueur pour l'instant.</p>`
          : `<ul class="parent-players">
              ${options.profiles
                .map(
                  (profile) => `
                    <li>
                      <span class="parent-player-avatar">${profile.avatar}</span>
                      <span class="parent-player-name">${profile.name}</span>
                      <button type="button" class="btn-cancel" data-delete="${profile.id}">Supprimer</button>
                    </li>
                  `
                )
                .join("")}
            </ul>`
      }
    </section>

    <section class="parent-card">
      <div class="parent-card-head">
        <h3>🔒 Code parent</h3>
      </div>
      <p>Le code protège cet espace. Il reste sur cet appareil.</p>
      <button type="button" class="btn-choice-helper" id="btn-parent-code">Changer le code</button>
    </section>
  `;

  area.querySelector("#btn-parent-backup")?.addEventListener("click", options.onOpenBackup);
  area.querySelector("#btn-parent-code")?.addEventListener("click", options.onChangeCode);
  area.querySelectorAll<HTMLElement>("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      const profile = options.profiles.find((p) => p.id === button.dataset.delete);
      if (profile) confirmDeletion(profile, () => options.onDeleteProfile(profile));
    });
  });

  container.appendChild(area);
}

// Suppression définitive : une fenêtre dit clairement ce qui va disparaître, et où
function confirmDeletion(profile: UserProfile, onConfirm: () => void): void {
  const modal = document.createElement("div");
  modal.className = "session-modal-overlay";
  modal.innerHTML = `
    <div class="session-modal-container notification-modal">
      <div class="notification-body">
        <h3>Supprimer ${profile.avatar} ${profile.name} ?</h3>
        <p>
          Sa progression, ses points, ses cadeaux et ses décors seront effacés de cet appareil,
          puis de la sauvegarde et de vos autres appareils.
        </p>
        <p><strong>C'est définitif.</strong></p>
      </div>
      <div class="choice-footer">
        <button type="button" class="btn-choice-helper" id="btn-keep-player">Annuler</button>
        <button type="button" class="btn-cancel" id="btn-delete-player">Supprimer définitivement</button>
      </div>
    </div>
  `;
  modal.querySelector("#btn-keep-player")?.addEventListener("click", () => modal.remove());
  modal.querySelector("#btn-delete-player")?.addEventListener("click", () => {
    modal.remove();
    onConfirm();
  });
  document.body.appendChild(modal);
}

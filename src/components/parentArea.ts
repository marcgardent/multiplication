import { UserProfile } from "../types";
import { isSpeechSupported } from "../voices/speechListener";
import { downloadVoiceModel, isVoiceModelBusy, isVoiceModelDownloaded, MODEL_SIZE_MB } from "../voices/voiceModel";

// Espace parent : réglages réservés aux adultes, derrière le code à 4 chiffres

export interface ParentAreaOptions {
  profiles: UserProfile[];
  // État de la sauvegarde, en clair : « À jour », « Désactivée »...
  backupStatus: string;
  onOpenBackup(): void;
  onDeleteProfile(profile: UserProfile): void;
  onChangeCode(): void;
  onBack(): void;
  // Réponse à voix haute : proposée ou non aux enfants, et ce que cet appareil sait faire
  speech: {
    isAllowed: boolean;
    onChange(allowed: boolean): void;
    // Essai, où le parent valide aussi les heuristiques
    openTest(): void;
  };
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
        <h3>🎤 Réponse à voix haute</h3>
        <span class="parent-card-status" id="parent-speech-status"></span>
      </div>
      <p>Avant chaque séance, les enfants peuvent choisir « Je parle » : ils disent la réponse au lieu de la taper.</p>
      <label class="parent-switch">
        <input type="checkbox" id="parent-speech-allowed" ${options.speech.isAllowed ? "checked" : ""} />
        <span>Proposer la réponse à voix haute</span>
      </label>
      <p id="parent-speech-model">${
        isSpeechSupported()
          ? "Vérification du modèle vocal…"
          : "❌ Ce navigateur ne sait pas faire tourner la reconnaissance vocale : sur cet appareil, les enfants répondent au clavier."
      }</p>
      <button type="button" class="btn-choice-helper" id="btn-parent-speech-download" hidden>Télécharger le modèle vocal (${MODEL_SIZE_MB} Mo)</button>
      <button type="button" class="btn-choice-helper" id="btn-parent-speech-test" ${isSpeechSupported() ? "" : "hidden"}>🎤 Essayer la reconnaissance</button>
    </section>

    <section class="parent-card">
      <div class="parent-card-head">
        <h3>🔒 Code parent</h3>
      </div>
      <p>Le code protège cet espace. Il reste sur cet appareil.</p>
      <button type="button" class="btn-choice-helper" id="btn-parent-code">Changer le code</button>
    </section>
  `;

  bindSpeechCard(area, options.speech);
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

function bindSpeechCard(area: HTMLElement, speech: ParentAreaOptions["speech"]): void {
  const statusEl = area.querySelector("#parent-speech-status") as HTMLElement;
  const checkbox = area.querySelector("#parent-speech-allowed") as HTMLInputElement;

  const showAllowed = () => {
    statusEl.textContent = checkbox.checked ? "Proposée" : "Désactivée";
  };

  area.querySelector("#btn-parent-speech-test")?.addEventListener("click", speech.openTest);

  // État réel du modèle sur cet appareil, relu dans le stockage du navigateur à chaque affichage et après chaque téléchargement.
  // Il se télécharge aussi tout seul : au premier « Je parle », et sur un nouveau téléphone dont la sauvegarde dit qu'il a servi
  const modelEl = area.querySelector("#parent-speech-model") as HTMLElement;
  const downloadBtn = area.querySelector("#btn-parent-speech-download") as HTMLButtonElement;
  const label = `Télécharger le modèle vocal (${MODEL_SIZE_MB} Mo)`;

  const showDownloading = () => {
    modelEl.textContent = `⏳ Téléchargement et installation du modèle vocal (${MODEL_SIZE_MB} Mo)…`;
    downloadBtn.hidden = false;
    downloadBtn.disabled = true;
    downloadBtn.textContent = "Téléchargement en cours…";
  };
  const refresh = async (problem = "") => {
    if (isVoiceModelBusy()) {
      showDownloading();
      return;
    }
    const isDownloaded = await isVoiceModelDownloaded();
    modelEl.textContent = isDownloaded
      ? "✅ Modèle vocal installé sur cet appareil : la reconnaissance marche sans internet, et la voix ne quitte jamais l'appareil."
      : `${problem}📦 Modèle vocal à télécharger une fois (${MODEL_SIZE_MB} Mo, avec internet). Ensuite, la reconnaissance marche sans internet, et la voix ne quitte jamais l'appareil.`;
    downloadBtn.hidden = isDownloaded;
    downloadBtn.disabled = false;
    downloadBtn.textContent = label;
  };
  // Attend la fin d'un téléchargement, lancé ici ou ailleurs, puis relit l'état réel
  const follow = () => {
    showDownloading();
    downloadVoiceModel().then(
      () => refresh(),
      () => refresh("⚠️ Le téléchargement n'a pas abouti : vérifiez la connexion. ")
    );
  };

  downloadBtn.addEventListener("click", follow);
  if (isSpeechSupported()) {
    if (isVoiceModelBusy()) follow();
    else refresh();
  }

  checkbox.addEventListener("change", () => {
    speech.onChange(checkbox.checked);
    showAllowed();
  });
  showAllowed();
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

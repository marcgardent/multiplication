import { UserProfile } from "../types";
import { isSpeechSupported, ListenMode } from "../voices/speechListener";
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
    // Calibrage : son dernier résultat sur cet appareil, et de quoi le refaire
    calibrationText(): string | null;
    openCalibration(onDone: () => void): void;
    // Façon d'écouter sur cet appareil ; le test a-t-il trouvé ce téléphone trop lent pour le repérage automatique ?
    listenMode: ListenMode;
    isPhoneSlow(): boolean;
    onListenMode(mode: ListenMode): void;
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

    <section class="parent-card" id="parent-speech-card"></section>

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

// Carte « Réponse à voix haute » : éteinte, un gros bouton pour l'activer ; allumée, une ligne d'état et l'essentiel.
// Le reste (façon d'écouter, essai de la reconnaissance) est replié dans « Plus d'options »
function bindSpeechCard(area: HTMLElement, speech: ParentAreaOptions["speech"]): void {
  const card = area.querySelector("#parent-speech-card") as HTMLElement;
  let isOn = speech.isAllowed;

  const head = (pill: string) => `
    <div class="parent-card-head">
      <h3>🎤 Réponse à voix haute</h3>
      ${pill ? `<span class="parent-card-status">${pill}</span>` : ""}
    </div>
  `;

  function render() {
    if (!isSpeechSupported()) {
      card.innerHTML = `${head("")}<p>Ce navigateur ne sait pas faire tourner la reconnaissance vocale : sur cet appareil, les enfants répondent au clavier.</p>`;
      return;
    }
    if (!isOn) {
      card.innerHTML = `
        ${head("")}
        <p>Les enfants disent la réponse au lieu de la taper. Leur voix reste sur le téléphone.</p>
        <button type="button" class="btn-confirm-launch" data-speech="enable">Activer la réponse à voix haute</button>
      `;
      card.querySelector('[data-speech="enable"]')?.addEventListener("click", () => {
        isOn = true;
        speech.onChange(true);
        render();
        // Activer, c'est installer puis tester le téléphone tout de suite
        speech.openCalibration(render);
      });
      return;
    }
    card.innerHTML = `
      ${head("Activée")}
      <p class="parent-speech-state" id="parent-speech-state">Vérification…</p>
      <div class="parent-speech-actions">
        <button type="button" class="btn-choice-helper" data-speech="test">📏 Refaire le test</button>
        <button type="button" class="btn-choice-helper" data-speech="disable">Désactiver</button>
      </div>
      <details class="parent-speech-more">
        <summary>Plus d'options</summary>
        <fieldset class="parent-listen-mode">
          <legend>Sur ce téléphone, l'enfant…</legend>
          <label><input type="radio" name="parent-listen-mode" value="hold" ${speech.listenMode === "hold" ? "checked" : ""} /> maintient un bouton pendant qu'il parle (conseillé)</label>
          <label class="${speech.isPhoneSlow() ? "is-discouraged" : ""}"><input type="radio" name="parent-listen-mode" value="auto" ${speech.listenMode === "auto" ? "checked" : ""} /> ${
            speech.isPhoneSlow()
              ? "parle simplement, sans bouton : déconseillé, ce téléphone est trop lent pour écouter en continu"
              : "parle simplement : la parole est repérée au volume"
          }</label>
        </fieldset>
        <button type="button" class="btn-choice-helper" data-speech="try">🎤 Essayer la reconnaissance</button>
      </details>
    `;
    card.querySelector('[data-speech="test"]')?.addEventListener("click", () => speech.openCalibration(render));
    card.querySelector('[data-speech="try"]')?.addEventListener("click", speech.openTest);
    card.querySelector('[data-speech="disable"]')?.addEventListener("click", () => {
      isOn = false;
      speech.onChange(false);
      render();
    });
    card.querySelectorAll<HTMLInputElement>('input[name="parent-listen-mode"]').forEach((input) =>
      input.addEventListener("change", () => {
        speech.listenMode = input.value as ListenMode;
        speech.onListenMode(speech.listenMode);
      })
    );
    refreshState();
  }

  // Une ligne : l'installation tant qu'elle n'est pas faite, sinon le résultat du test. Une installation manquée se relance toute seule
  async function refreshState(hasFailed = false) {
    const stateEl = card.querySelector("#parent-speech-state") as HTMLElement | null;
    if (!stateEl) return;
    if (isVoiceModelBusy()) {
      install(stateEl);
      return;
    }
    if (!(await isVoiceModelDownloaded())) {
      if (!hasFailed && navigator.onLine) install(stateEl);
      else stateEl.textContent = "⚠️ Pas encore installée : il faut internet. Elle s'installera toute seule dès que le téléphone sera connecté.";
      return;
    }
    stateEl.textContent = speech.calibrationText() ?? "📏 Pas encore testée sur ce téléphone.";
  }

  function install(stateEl: HTMLElement) {
    stateEl.textContent = `⏳ Installation sur ce téléphone (${MODEL_SIZE_MB} Mo)…`;
    downloadVoiceModel().then(
      () => refreshState(),
      () => refreshState(true)
    );
  }

  render();
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

import { UserProfile } from "../types";
import { isSpeechSupported, ListenMode } from "../voices/speechListener";
import { downloadVoiceModel, isVoiceModelBusy, isVoiceModelDownloaded, MODEL_SIZE_MB } from "../voices/voiceModel";

// Espace parent : réglages réservés aux adultes, derrière le code à 4 chiffres.
// Ses fonctions sont listées sur l'accueil, pour que les parents les voient ; une fois le code tapé,
// un hub les reprend, et chacune s'ouvre dans sa propre fenêtre

export type ParentFeature = "speech" | "voices" | "players" | "backup" | "code";

// Ce qui change le libellé d'une fonction : « Activer » tant qu'elle est éteinte, « Gérer » ensuite
export interface ParentFeatureState {
  isSpeechOn: boolean;
  isBackupOn: boolean;
  hasCode: boolean;
}

interface ParentFeatureItem {
  feature: ParentFeature;
  icon: string;
  title: string;
}

export function parentFeatures(state: ParentFeatureState): ParentFeatureItem[] {
  return [
    { feature: "speech", icon: "🎤", title: state.isSpeechOn ? "Gérer la réponse à voix haute" : "Activer la réponse à voix haute" },
    { feature: "voices", icon: "🎙️", title: "Enregistrer votre voix" },
    { feature: "players", icon: "👥", title: "Gérer les joueurs" },
    { feature: "backup", icon: "☁️", title: state.isBackupOn ? "Gérer la sauvegarde" : "Activer la sauvegarde" },
    { feature: "code", icon: "🔑", title: state.hasCode ? "Changer le code parent" : "Définir le code parent" }
  ];
}

function featureList(state: ParentFeatureState): string {
  return parentFeatures(state)
    .map(
      (item) => `
        <button type="button" class="parent-feature-item" data-feature="${item.feature}">
          <span class="parent-feature-icon" aria-hidden="true">${item.icon}</span>
          <span class="parent-feature-title">${item.title}</span>
        </button>
      `
    )
    .join("");
}

// Carte de l'accueil : l'espace parent et ce qu'on y trouve. Chaque ligne demande le code puis ouvre sa fonction
export function renderParentEntry(container: HTMLElement, state: ParentFeatureState, onOpen: (feature?: ParentFeature) => void): void {
  const card = document.createElement("section");
  card.className = "parent-entry";
  card.innerHTML = `
    <button type="button" class="parent-entry-head" data-feature="">
      <span class="parent-feature-icon" aria-hidden="true">🔒</span>
      <span class="parent-entry-title">Espace parent</span>
    </button>
    <div class="parent-feature-list">${featureList(state)}</div>
  `;
  card.querySelectorAll<HTMLElement>("[data-feature]").forEach((button) =>
    button.addEventListener("click", () => onOpen((button.dataset.feature as ParentFeature) || undefined))
  );
  container.appendChild(card);
}

export interface ParentHubOptions {
  state(): ParentFeatureState;
  // Chaque fonction ouvre sa fenêtre et la rend, pour que le hub se mette à jour à sa fermeture
  open: Record<ParentFeature, () => HTMLElement | null>;
  onClose(): void;
}

// Hub : la liste des fonctions, rien d'autre
export function openParentHub(options: ParentHubOptions, initial?: ParentFeature): void {
  if (document.querySelector(".parent-hub-modal")) return;
  const modal = document.createElement("div");
  modal.className = "session-modal-overlay";
  modal.innerHTML = `
    <div class="session-modal-container prompt-choice-modal parent-hub-modal">
      <div class="prompt-header">
        <h3>🔒 Espace parent</h3>
        <button type="button" class="btn-modal-close" data-action="close" aria-label="Fermer">✕</button>
      </div>
      <div class="parent-feature-list" id="parent-hub-list"></div>
    </div>
  `;
  const list = modal.querySelector("#parent-hub-list") as HTMLElement;

  function draw() {
    list.innerHTML = featureList(options.state());
    list.querySelectorAll<HTMLElement>("[data-feature]").forEach((button) =>
      button.addEventListener("click", () => open(button.dataset.feature as ParentFeature))
    );
  }

  function open(feature: ParentFeature) {
    const opened = options.open[feature]();
    if (opened) onRemoved(opened, draw);
  }

  modal.querySelector('[data-action="close"]')?.addEventListener("click", () => {
    modal.remove();
    options.onClose();
  });
  draw();
  document.body.appendChild(modal);
  if (initial) open(initial);
}

// Prévient quand une fenêtre se ferme, quelle que soit la façon dont elle se ferme
function onRemoved(element: HTMLElement, callback: () => void): void {
  const observer = new MutationObserver(() => {
    if (element.isConnected) return;
    observer.disconnect();
    callback();
  });
  observer.observe(document.body, { childList: true });
}

// Fenêtre d'une fonction : un titre, une croix, le contenu
export function openFeatureModal(title: string, className = ""): { modal: HTMLElement; body: HTMLElement } {
  const modal = document.createElement("div");
  modal.className = "session-modal-overlay";
  modal.innerHTML = `
    <div class="session-modal-container prompt-choice-modal parent-feature-modal ${className}">
      <div class="prompt-header">
        <h3>${title}</h3>
        <button type="button" class="btn-modal-close" data-action="close" aria-label="Fermer">✕</button>
      </div>
      <div class="parent-feature-body"></div>
    </div>
  `;
  modal.querySelector('[data-action="close"]')?.addEventListener("click", () => modal.remove());
  document.body.appendChild(modal);
  return { modal, body: modal.querySelector(".parent-feature-body") as HTMLElement };
}

// Joueurs : la liste, et de quoi en supprimer un
export function openPlayersModal(options: { profiles(): UserProfile[]; onDelete(profile: UserProfile): void }): HTMLElement {
  const { modal, body } = openFeatureModal("👥 Joueurs");

  function draw() {
    const profiles = options.profiles();
    body.innerHTML =
      profiles.length === 0
        ? `<p>Aucun joueur pour l'instant.</p>`
        : `<ul class="parent-players">
            ${profiles
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
          </ul>`;
    body.querySelectorAll<HTMLElement>("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => {
        const profile = profiles.find((p) => p.id === button.dataset.delete);
        if (profile)
          confirmDeletion(profile, () => {
            options.onDelete(profile);
            draw();
          });
      });
    });
  }

  draw();
  return modal;
}

export interface SpeechSettings {
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
}

// Réponse à voix haute : éteinte, un gros bouton pour l'activer ; allumée, une ligne d'état et l'essentiel.
// Le reste (façon d'écouter, essai de la reconnaissance) est replié dans « Plus d'options »
export function openSpeechModal(speech: SpeechSettings): HTMLElement {
  const { modal, body: card } = openFeatureModal("🎤 Réponse à voix haute");
  let isOn = speech.isAllowed;

  function render() {
    if (!isSpeechSupported()) {
      card.innerHTML = `<p>Ce navigateur ne sait pas faire tourner la reconnaissance vocale : sur cet appareil, les enfants répondent au clavier.</p>`;
      return;
    }
    if (!isOn) {
      card.innerHTML = `
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
  return modal;
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

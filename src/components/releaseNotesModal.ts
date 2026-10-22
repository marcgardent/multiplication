import { ReleaseNote } from "../core/releaseNotes";

// « Quoi de neuf ? » : après une mise à jour, ou tout l'historique depuis la mention « Version » de l'accueil
export function openReleaseNotesModal(notes: ReleaseNote[], title = "🎉 Quoi de neuf ?"): void {
  if (notes.length === 0) return;
  const modal = document.createElement("div");
  modal.className = "session-modal-overlay";
  modal.innerHTML = `
    <div class="session-modal-container prompt-choice-modal release-notes-modal">
      <div class="prompt-header">
        <h3>${title}</h3>
        <button type="button" class="btn-modal-close" data-action="close" aria-label="Fermer">✕</button>
      </div>
      <div class="release-notes-list">
        ${notes
          .map(
            (note) => `
              <p class="release-note"><strong>${note.title}</strong><span>Version ${note.series}</span></p>
            `
          )
          .join("")}
      </div>
      <button type="button" class="btn-confirm-launch" data-action="close">Super !</button>
    </div>
  `;
  modal.querySelectorAll('[data-action="close"]').forEach((button) => button.addEventListener("click", () => modal.remove()));
  document.body.appendChild(modal);
}

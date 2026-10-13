export interface TableSelectionOptions {
  // Tables cochées à l'ouverture
  selected: number[];
  confirmLabel: string;
  onConfirm(tables: number[]): void;
}

const ALL_TABLES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const DEFAULT_TABLES = [2, 3];

// Modale « Choisis tes tables », commune à la révision des tables, à la radio et au brossage de dents
export function openTableSelectionModal(options: TableSelectionOptions): void {
  let selected = new Set(Array.isArray(options.selected) && options.selected.length > 0 ? options.selected : DEFAULT_TABLES);

  const modal = document.createElement("div");
  modal.className = "session-modal-overlay";

  function updateModalContent() {
    modal.querySelectorAll(".btn-choice-table").forEach((btn) => {
      const t = parseInt(btn.getAttribute("data-t") || "1", 10);
      btn.classList.toggle("selected", selected.has(t));
    });
    const countEl = modal.querySelector("#count-selected-tables");
    if (countEl) countEl.textContent = `${selected.size * 10} calculs`;
  }

  modal.innerHTML = `
    <div class="session-modal-container prompt-choice-modal">
      <div class="prompt-header">
        <h3>Choisis tes tables</h3>
        <button type="button" class="btn-modal-close" id="btn-close-tables">✕</button>
      </div>

      <div class="choice-tables-grid" id="tables-modal-grid">
        ${ALL_TABLES.map(
          (t) => `
            <button type="button" class="btn-choice-table ${selected.has(t) ? "selected" : ""}" data-t="${t}">
              Table de ${t}
            </button>
          `
        ).join("")}
      </div>

      <div class="choice-footer">
        <button type="button" class="btn-choice-helper" id="btn-toggle-all">Toutes</button>
        <button type="button" class="btn-confirm-launch" id="btn-start-tables-now">
          ${options.confirmLabel} <span id="count-selected-tables">${selected.size * 10} calculs</span>
        </button>
      </div>
    </div>
  `;

  modal.querySelector("#btn-close-tables")?.addEventListener("click", () => modal.remove());

  modal.querySelectorAll(".btn-choice-table").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const t = parseInt((e.currentTarget as HTMLElement).getAttribute("data-t") || "1", 10);
      if (selected.has(t)) {
        if (selected.size > 1) selected.delete(t);
      } else {
        selected.add(t);
      }
      updateModalContent();
    });
  });

  modal.querySelector("#btn-toggle-all")?.addEventListener("click", () => {
    selected = new Set(selected.size === ALL_TABLES.length ? DEFAULT_TABLES : ALL_TABLES);
    updateModalContent();
  });

  modal.querySelector("#btn-start-tables-now")?.addEventListener("click", () => {
    modal.remove();
    options.onConfirm(Array.from(selected).sort((a, b) => a - b));
  });

  document.body.appendChild(modal);
}

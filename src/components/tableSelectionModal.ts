export interface TableSelectionOptions {
  // Tables cochées à l'ouverture
  selected: number[];
  confirmLabel: string;
  onConfirm(tables: number[]): void;
}

const ALL_TABLES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
export const DEFAULT_TABLES = [2, 3];

export function initialTables(saved: number[]): Set<number> {
  return new Set(Array.isArray(saved) && saved.length > 0 ? saved : DEFAULT_TABLES);
}

// Grille « Table de 1 … Table de 10 », commune à la révision des tables, à la radio et au brossage
export function tablesGridHtml(selected: Set<number>): string {
  return `
    <div class="choice-tables-grid">
      ${ALL_TABLES.map(
        (t) => `
          <button type="button" class="btn-choice-table ${selected.has(t) ? "selected" : ""}" data-t="${t}">
            Table de ${t}
          </button>
        `
      ).join("")}
    </div>
  `;
}

// Coche et décoche les tables de la grille, en en gardant toujours au moins une
export function bindTablesGrid(root: HTMLElement, selected: Set<number>, onChange: () => void): void {
  root.querySelectorAll<HTMLElement>(".btn-choice-table").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = parseInt(btn.getAttribute("data-t") || "1", 10);
      if (selected.has(t)) {
        if (selected.size > 1) selected.delete(t);
      } else {
        selected.add(t);
      }
      onChange();
    });
  });
}

// Bouton « Toutes » : coche toutes les tables, ou revient au choix par défaut si elles le sont déjà
export function toggleAllTables(selected: Set<number>): void {
  const next = selected.size === ALL_TABLES.length ? DEFAULT_TABLES : ALL_TABLES;
  selected.clear();
  next.forEach((t) => selected.add(t));
}

export function refreshTablesGrid(root: HTMLElement, selected: Set<number>): void {
  root.querySelectorAll<HTMLElement>(".btn-choice-table").forEach((btn) => {
    btn.classList.toggle("selected", selected.has(parseInt(btn.getAttribute("data-t") || "1", 10)));
  });
}

export function sortedTables(selected: Set<number>): number[] {
  return Array.from(selected).sort((a, b) => a - b);
}

// Modale « Choisis tes tables » de la révision des tables
export function openTableSelectionModal(options: TableSelectionOptions): void {
  const selected = initialTables(options.selected);

  const modal = document.createElement("div");
  modal.className = "session-modal-overlay";

  function updateModalContent() {
    refreshTablesGrid(modal, selected);
    const countEl = modal.querySelector("#count-selected-tables");
    if (countEl) countEl.textContent = `${selected.size * 10} calculs`;
  }

  modal.innerHTML = `
    <div class="session-modal-container prompt-choice-modal">
      <div class="prompt-header">
        <h3>Choisis tes tables</h3>
        <button type="button" class="btn-modal-close" id="btn-close-tables">✕</button>
      </div>

      ${tablesGridHtml(selected)}

      <div class="choice-footer">
        <button type="button" class="btn-choice-helper" id="btn-toggle-all">Toutes</button>
        <button type="button" class="btn-confirm-launch" id="btn-start-tables-now">
          ${options.confirmLabel} <span id="count-selected-tables">${selected.size * 10} calculs</span>
        </button>
      </div>
    </div>
  `;

  modal.querySelector("#btn-close-tables")?.addEventListener("click", () => modal.remove());
  bindTablesGrid(modal, selected, updateModalContent);

  modal.querySelector("#btn-toggle-all")?.addEventListener("click", () => {
    toggleAllTables(selected);
    updateModalContent();
  });

  modal.querySelector("#btn-start-tables-now")?.addEventListener("click", () => {
    modal.remove();
    options.onConfirm(sortedTables(selected));
  });

  document.body.appendChild(modal);
}

import { MatrixStore } from "../core/matrixStore";

export interface LearningOrderCardComponent {
  render(): HTMLElement;
  mount(parent: HTMLElement): HTMLElement;
  destroy(): void;
}

const ALL_TABLES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const DEFAULT_ORDER = [1, 10, 2, 5, 3, 4, 6, 7, 8, 9];
const ASC_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Composant modulaire pour ordonner la liste des tables à apprendre.
 * Respecte le pattern Factory avec encapsulation d'état et injection de MatrixStore.
 */
export function createLearningOrderCard(matrixStore: MatrixStore): LearningOrderCardComponent {
  let element: HTMLElement | null = null;
  let unsubscribe: (() => void) | null = null;

  function renderCard(): HTMLElement {
    const card = document.createElement("section");
    card.className = "learning-order-card";

    const activeTables = matrixStore.getLearningTables();
    const inactiveTables = ALL_TABLES.filter((t) => !activeTables.includes(t));

    // Trouver la première table active ayant encore des calculs non abordés
    let currentLearningTable: number | null = null;
    for (const t of activeTables) {
      let hasUnknown = false;
      for (let b = 1; b <= 10; b++) {
        const item = matrixStore.getByFactors(t, b);
        if (item && item.status === "unknown") {
          hasUnknown = true;
          break;
        }
      }
      if (hasUnknown) {
        currentLearningTable = t;
        break;
      }
    }

    const headerHtml = `
      <div class="order-card-header">
        <div class="order-card-title-group">
          <h3>🎯 Ordre d'apprentissage des tables</h3>
          <p class="order-card-desc">
            L'algorithme pioche les nouveaux calculs dans cet ordre. Vous pouvez réordonner les tables ou choisir celles à apprendre.
          </p>
        </div>
        ${
          currentLearningTable !== null
            ? `<span class="order-current-badge">En cours : Table de ${currentLearningTable}</span>`
            : activeTables.length > 0
            ? `<span class="order-current-badge badge-all-started">Toutes les tables abordées !</span>`
            : `<span class="order-current-badge badge-none">Aucune table active</span>`
        }
      </div>

      <div class="order-presets-row">
        <span class="presets-label">Raccourcis :</span>
        <button type="button" class="btn-order-preset" id="preset-school" title="Ordre par défaut (1, 10, 2, 5, 3, 4, 6, 7, 8, 9)">Ordre par défaut</button>
        <button type="button" class="btn-order-preset" id="preset-asc" title="De 1 à 10">Ordre 1 à 10</button>
        ${
          inactiveTables.length > 0
            ? `<button type="button" class="btn-order-preset" id="preset-all" title="Activer toutes les tables">Toutes (+${inactiveTables.length})</button>`
            : ""
        }
        <div class="order-legend-inline">
          <span class="legend-chip"><span class="dot dot-discovery" aria-hidden="true"></span> Abordés</span>
          <span class="legend-chip"><span class="dot dot-mastered" aria-hidden="true"></span> Maîtrisés</span>
        </div>
      </div>
    `;

    let listHtml = "";
    if (activeTables.length === 0) {
      listHtml = `
        <div class="order-empty-message">
          <span class="empty-icon">⏸️</span>
          <p>Aucune table n'est sélectionnée pour l'apprentissage. Ajoutez des tables ci-dessous pour que l'algorithme puisse introduire de nouveaux calculs.</p>
        </div>
      `;
    } else {
      listHtml = `
        <ul class="learning-tables-list" id="learning-tables-list">
          ${activeTables
            .map((t, idx) => {
              let unknown = 0;
              let mastered = 0;
              for (let b = 1; b <= 10; b++) {
                const item = matrixStore.getByFactors(t, b);
                if (!item || item.status === "unknown") unknown++;
                else if (item.status === "mastered") mastered++;
              }

              const started = 10 - unknown;
              const isCurrent = t === currentLearningTable;

              return `
                <li class="learning-table-row ${isCurrent ? "row-current" : ""}" data-table="${t}" data-index="${idx}">
                  <div class="row-left">
                    <span class="table-drag-handle" title="Glisser pour réordonner" aria-hidden="true">⋮⋮</span>
                    <span class="table-rank-badge">#${idx + 1}</span>
                    <strong class="table-title">Table de ${t}</strong>
                    ${isCurrent ? `<span class="badge-next-to-learn">En cours</span>` : ""}
                  </div>
                  <div class="row-right">
                    <div class="table-badges">
                      <span class="badge-stat badge-discovery ${started === 0 ? "is-zero" : ""}" title="${started} calcul(s) abordé(s)">
                        <span class="dot dot-discovery" aria-hidden="true"></span>
                        <span class="badge-num">${started}</span>
                      </span>
                      <span class="badge-stat badge-mastered ${mastered === 0 ? "is-zero" : ""}" title="${mastered} calcul(s) maîtrisé(s)">
                        <span class="dot dot-mastered" aria-hidden="true"></span>
                        <span class="badge-num">${mastered}${mastered === 10 ? " 🎁" : ""}</span>
                      </span>
                    </div>
                    <div class="table-actions">
                      <button type="button" class="btn-table-action btn-move-up" data-action="up" data-table="${t}" title="Monter" aria-label="Monter la table de ${t}" ${idx === 0 ? "disabled" : ""}>▲</button>
                      <button type="button" class="btn-table-action btn-move-down" data-action="down" data-table="${t}" title="Descendre" aria-label="Descendre la table de ${t}" ${idx === activeTables.length - 1 ? "disabled" : ""}>▼</button>
                      <button type="button" class="btn-table-action btn-remove-table" data-action="remove" data-table="${t}" title="Mettre en réserve" aria-label="Mettre la table de ${t} en réserve">✕</button>
                    </div>
                  </div>
                </li>
              `;
            })
            .join("")}
        </ul>
      `;
    }

    let inactiveHtml = "";
    if (inactiveTables.length > 0) {
      inactiveHtml = `
        <div class="inactive-tables-section">
          <span class="inactive-label">Tables en pause :</span>
          <div class="inactive-chips-list">
            ${inactiveTables
              .map((t) => {
                return `<button type="button" class="btn-add-table-chip" data-table="${t}" title="Ajouter à l'apprentissage">+ Table de ${t}</button>`;
              })
              .join("")}
          </div>
        </div>
      `;
    }

    card.innerHTML = `
      ${headerHtml}
      ${listHtml}
      ${inactiveHtml}
    `;

    // 1. Drag & drop via Pointer Events (souris + tactile, sans curseur "not-allowed" natif)
    let activePointerId: number | null = null;
    let draggedRow: HTMLElement | null = null;
    let draggedTable: number | null = null;
    let startY = 0;
    let currentOverRow: HTMLElement | null = null;

    const listEl = card.querySelector("#learning-tables-list") as HTMLElement | null;
    if (listEl) {
      const applyReorder = (targetTable: number) => {
        if (draggedTable && draggedTable !== targetTable) {
          const fromIdx = activeTables.indexOf(draggedTable);
          const toIdx = activeTables.indexOf(targetTable);
          if (fromIdx !== -1 && toIdx !== -1) {
            const next = [...activeTables];
            next.splice(fromIdx, 1);
            next.splice(toIdx, 0, draggedTable);
            matrixStore.setLearningTables(next);
          }
        }
      };

      const rows = Array.from(listEl.querySelectorAll<HTMLElement>(".learning-table-row"));

      rows.forEach((row) => {
        row.addEventListener("pointerdown", (e: PointerEvent) => {
          if ((e.target as HTMLElement).closest(".btn-table-action")) return;
          if (e.button !== undefined && e.button !== 0) return;

          activePointerId = e.pointerId;
          draggedRow = row;
          draggedTable = parseInt(row.getAttribute("data-table") || "0", 10);
          startY = e.clientY;

          try {
            row.setPointerCapture(e.pointerId);
          } catch {}

          row.classList.add("dragging");
          listEl.classList.add("is-dragging");
        });

        row.addEventListener("pointermove", (e: PointerEvent) => {
          if (activePointerId !== e.pointerId || !draggedRow) return;

          const deltaY = e.clientY - startY;
          draggedRow.style.transform = `translateY(${deltaY}px)`;

          // Trouver la ligne sous le pointeur
          let foundOver: HTMLElement | null = null;
          for (const otherRow of rows) {
            if (otherRow === draggedRow) continue;
            const rect = otherRow.getBoundingClientRect?.();
            if (rect && e.clientY >= rect.top && e.clientY <= rect.bottom) {
              foundOver = otherRow;
              break;
            }
          }

          rows.forEach((r) => r.classList.remove("drag-over"));
          if (foundOver) {
            foundOver.classList.add("drag-over");
            currentOverRow = foundOver;
          } else {
            currentOverRow = null;
          }
        });

        const endDrag = (e: PointerEvent) => {
          if (activePointerId !== e.pointerId || !draggedRow) return;

          try {
            row.releasePointerCapture(e.pointerId);
          } catch {}

          draggedRow.style.transform = "";
          draggedRow.classList.remove("dragging");
          listEl.classList.remove("is-dragging");
          rows.forEach((r) => r.classList.remove("drag-over"));

          if (currentOverRow && draggedTable !== null) {
            const targetTable = parseInt(currentOverRow.getAttribute("data-table") || "0", 10);
            applyReorder(targetTable);
          }

          activePointerId = null;
          draggedRow = null;
          draggedTable = null;
          currentOverRow = null;
        };

        row.addEventListener("pointerup", endDrag);
        row.addEventListener("pointercancel", endDrag);

        // Compatibilité tests / dragover
        row.addEventListener("dragover", (e) => {
          e.preventDefault();
        });
        row.addEventListener("drop", (e) => {
          e.preventDefault();
          const targetTable = parseInt(row.getAttribute("data-table") || "0", 10);
          applyReorder(targetTable);
        });
      });
    }

    // 2. Actions monter / descendre / retirer
    card.querySelectorAll<HTMLElement>("[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const action = btn.getAttribute("data-action");
        const tableNum = parseInt(btn.getAttribute("data-table") || "0", 10);
        const idx = activeTables.indexOf(tableNum);
        if (idx === -1) return;

        if (action === "up" && idx > 0) {
          const next = [...activeTables];
          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
          matrixStore.setLearningTables(next);
        } else if (action === "down" && idx < activeTables.length - 1) {
          const next = [...activeTables];
          [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
          matrixStore.setLearningTables(next);
        } else if (action === "remove") {
          const next = activeTables.filter((t) => t !== tableNum);
          matrixStore.setLearningTables(next);
        }
      });
    });

    // 3. Puces d'ajout de tables en réserve
    card.querySelectorAll<HTMLElement>(".btn-add-table-chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tableNum = parseInt(btn.getAttribute("data-table") || "0", 10);
        if (!activeTables.includes(tableNum)) {
          matrixStore.setLearningTables([...activeTables, tableNum]);
        }
      });
    });

    // 4. Raccourcis
    card.querySelector("#preset-school")?.addEventListener("click", () => {
      matrixStore.setLearningTables(DEFAULT_ORDER);
    });

    card.querySelector("#preset-asc")?.addEventListener("click", () => {
      matrixStore.setLearningTables(ASC_ORDER);
    });

    card.querySelector("#preset-all")?.addEventListener("click", () => {
      const missing = ALL_TABLES.filter((t) => !activeTables.includes(t));
      matrixStore.setLearningTables([...activeTables, ...missing]);
    });

    return card;
  }

  function updateDOM() {
    if (!element) return;
    const newElement = renderCard();
    element.replaceWith(newElement);
    element = newElement;
  }

  return {
    render(): HTMLElement {
      element = renderCard();
      return element;
    },

    mount(parent: HTMLElement): HTMLElement {
      element = renderCard();
      parent.appendChild(element);
      if (!unsubscribe) {
        unsubscribe = matrixStore.subscribe(() => {
          updateDOM();
        });
      }
      return element;
    },

    destroy(): void {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      element?.remove();
      element = null;
    }
  };
}

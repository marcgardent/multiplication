import { ListeningMode } from "../radio/listeningPlayer";
import { UserProfile } from "../types";
import { bindTablesGrid, initialTables, refreshTablesGrid, sortedTables, tablesGridHtml, toggleAllTables } from "./tableSelectionModal";

export type ListeningTab = "guided" | "manual";
export type ListeningChoice = { tab: "guided"; playerIds: string[] } | { tab: "manual"; tables: number[] };

export interface ListeningSetupOptions {
  mode: ListeningMode;
  profiles: UserProfile[];
  // Dernier onglet et dernière sélection de ce mode
  tab: ListeningTab;
  playerIds: string[];
  tables: number[];
  // Nombre de calculs à revoir pour ces joueurs
  guidedCount(playerIds: string[]): number;
  // Appelé pendant le clic : le téléphone n'autorise le son qu'à ce moment-là
  onConfirm(choice: ListeningChoice): void;
}

const TITLES: Record<ListeningMode, { title: string; confirm: string }> = {
  radio: { title: "📻 Radio des tables", confirm: "Lancer la radio" },
  brushing: { title: "🪥 Brossage de dents", confirm: "Commencer le brossage" }
};

// Fenêtre de lancement de la radio et du brossage : onglet Guidé (joueurs) ou Manuel (tables)
export function openListeningSetupModal(options: ListeningSetupOptions): void {
  const texts = TITLES[options.mode];
  const hasPlayers = options.profiles.length > 0;
  let tab: ListeningTab = hasPlayers ? options.tab : "manual";

  const knownIds = new Set(options.profiles.map((p) => p.id));
  const savedPlayers = options.playerIds.filter((id) => knownIds.has(id));
  const players = new Set(savedPlayers.length > 0 ? savedPlayers : options.profiles.map((p) => p.id));
  const tables = initialTables(options.tables);

  const modal = document.createElement("div");
  modal.className = "session-modal-overlay";
  modal.innerHTML = `
    <div class="session-modal-container prompt-choice-modal listening-setup-modal">
      <div class="prompt-header">
        <h3>${texts.title}</h3>
        <button type="button" class="btn-modal-close" id="btn-close-listen-setup" aria-label="Fermer">✕</button>
      </div>

      <div class="listening-tabs" role="tablist" ${hasPlayers ? "" : "hidden"}>
        <button type="button" role="tab" class="listening-tab" data-tab="guided">🎯 Guidé</button>
        <button type="button" role="tab" class="listening-tab" data-tab="manual">✋ Manuel</button>
      </div>

      <div class="listening-tab-panel" data-panel="guided" role="tabpanel">
        <p class="listening-tab-hint">Coche les joueurs : l'écoute reprend ce qu'ils ont à revoir.</p>
        <div class="choice-tables-grid">
          ${options.profiles
            .map(
              (p) => `
                <button type="button" class="btn-choice-table btn-choice-player" data-player="${p.id}">
                  <span aria-hidden="true">${p.avatar}</span> ${p.name}
                </button>
              `
            )
            .join("")}
        </div>
        <p class="listening-empty" id="listen-guided-empty">Rien à revoir pour l'instant. Choisis des tables dans l'onglet Manuel.</p>
      </div>

      <div class="listening-tab-panel" data-panel="manual" role="tabpanel">
        <p class="listening-tab-hint">Coche les tables à écouter.</p>
        ${tablesGridHtml(tables)}
      </div>

      <div class="choice-footer">
        <button type="button" class="btn-choice-helper" id="btn-toggle-all">Toutes</button>
        <button type="button" class="btn-confirm-launch" id="btn-listen-start">
          ${texts.confirm} <span id="listen-setup-count"></span>
        </button>
      </div>
    </div>
  `;

  const guidedPanel = modal.querySelector('[data-panel="guided"]') as HTMLElement;
  const manualPanel = modal.querySelector('[data-panel="manual"]') as HTMLElement;
  const emptyEl = modal.querySelector("#listen-guided-empty") as HTMLElement;
  const toggleAllBtn = modal.querySelector("#btn-toggle-all") as HTMLElement;
  const startBtn = modal.querySelector("#btn-listen-start") as HTMLButtonElement;
  const countEl = modal.querySelector("#listen-setup-count") as HTMLElement;

  function selectedPlayers(): string[] {
    return options.profiles.map((p) => p.id).filter((id) => players.has(id));
  }

  function update() {
    modal.querySelectorAll<HTMLElement>(".listening-tab").forEach((btn) => {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle("selected", isActive);
      btn.setAttribute("aria-selected", String(isActive));
    });
    guidedPanel.hidden = tab !== "guided";
    manualPanel.hidden = tab !== "manual";
    toggleAllBtn.hidden = tab !== "manual";

    guidedPanel.querySelectorAll<HTMLElement>(".btn-choice-player").forEach((btn) => {
      btn.classList.toggle("selected", players.has(btn.dataset.player ?? ""));
    });
    refreshTablesGrid(manualPanel, tables);

    if (tab === "guided") {
      const guidedCount = options.guidedCount(selectedPlayers());
      emptyEl.hidden = guidedCount > 0;
      countEl.textContent = guidedCount > 0 ? `${guidedCount} calculs à revoir` : "";
      startBtn.disabled = guidedCount === 0;
    } else {
      countEl.textContent = `${tables.size * 10} calculs`;
      startBtn.disabled = false;
    }
  }

  modal.querySelectorAll<HTMLElement>(".listening-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      tab = btn.dataset.tab === "guided" ? "guided" : "manual";
      update();
    });
  });

  // Au moins un joueur reste coché, comme pour les tables
  guidedPanel.querySelectorAll<HTMLElement>(".btn-choice-player").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.player ?? "";
      if (players.has(id)) {
        if (players.size > 1) players.delete(id);
      } else {
        players.add(id);
      }
      update();
    });
  });

  bindTablesGrid(manualPanel, tables, update);
  toggleAllBtn.addEventListener("click", () => {
    toggleAllTables(tables);
    update();
  });

  modal.querySelector("#btn-close-listen-setup")?.addEventListener("click", () => modal.remove());
  startBtn.addEventListener("click", () => {
    if (startBtn.disabled) return;
    modal.remove();
    options.onConfirm(tab === "guided" ? { tab, playerIds: selectedPlayers() } : { tab, tables: sortedTables(tables) });
  });

  update();
  document.body.appendChild(modal);
}

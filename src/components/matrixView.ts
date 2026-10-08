import { MatrixStore } from "../core/matrixStore";
import { MultiplicationItem, ItemStatus } from "../types";
import { AudioService } from "../services/audioService";
import { RepetitionEngine } from "../core/repetitionEngine";

export type MatrixDisplayMode = "status" | "errorRate" | "responseTime";

export interface MatrixViewComponent {
  mount(parent: HTMLElement): void;
  destroy(): void;
  refresh(): void;
}

export function createMatrixView(
  matrixStore: MatrixStore,
  audioService: AudioService,
  repetitionEngine?: RepetitionEngine
): MatrixViewComponent {
  let element: HTMLElement | null = null;
  let unsubscribe: (() => void) | null = null;
  let currentDisplayMode: MatrixDisplayMode = "status";

  const statusLabels: Record<ItemStatus, { label: string; class: string; icon: string }> = {
    unknown: { label: "Non abordé", class: "status-unknown", icon: "⚪" },
    discovery: { label: "En découverte", class: "status-discovery", icon: "🔵" },
    review: { label: "À réviser", class: "status-review", icon: "🟠" },
    mastered: { label: "Maîtrisé", class: "status-mastered", icon: "🟢" }
  };

  function getErrorRate(item: MultiplicationItem): number {
    if (item.seenCount === 0) return 0;
    return Math.round((item.errorCount / item.seenCount) * 100);
  }

  function getErrorRateColorClass(errorRate: number, seenCount: number): string {
    if (seenCount === 0) return "heat-none";
    if (errorRate === 0) return "heat-safe";
    if (errorRate <= 25) return "heat-low";
    if (errorRate <= 50) return "heat-medium";
    return "heat-high";
  }

  function getResponseTimeColorClass(avgMs: number): string {
    if (avgMs === 0) return "heat-none";
    if (avgMs < 2000) return "heat-safe";
    if (avgMs < 3500) return "heat-low";
    if (avgMs < 5000) return "heat-medium";
    return "heat-high";
  }

  function renderModal(item: MultiplicationItem): HTMLElement {
    const modal = document.createElement("div");
    modal.className = "matrix-detail-modal";

    const st = statusLabels[item.status];
    const errorRate = getErrorRate(item);
    const times = item.responseTimesMs || [];
    const minTime = times.length > 0 ? Math.min(...times) : 0;
    const maxTime = times.length > 0 ? Math.max(...times) : 0;
    const recentTimes = times.slice(-5).map((t) => `${(t / 1000).toFixed(2)}s`).join(", ");

    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <h3>${item.a} × ${item.b} = ${item.result}</h3>
          <button type="button" class="btn-close" aria-label="Fermer">✕</button>
        </div>
        <div class="modal-body">
          <div class="status-badge ${st.class}">
            ${st.icon} ${st.label} — Palier ${item.boxLevel} sur 4
          </div>
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-label">Présentations :</span>
              <span class="stat-val">${item.seenCount}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Taux d'erreur :</span>
              <span class="stat-val ${errorRate > 30 ? "text-danger" : ""}">${item.seenCount > 0 ? errorRate + "%" : "-"}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Erreurs total :</span>
              <span class="stat-val">${item.errorCount}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Réussites de suite :</span>
              <span class="stat-val">${item.successStreak}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Temps moyen :</span>
              <span class="stat-val">${item.avgResponseTimeMs > 0 ? (item.avgResponseTimeMs / 1000).toFixed(2) + "s" : "-"}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Plus rapide / Plus lent :</span>
              <span class="stat-val">${minTime > 0 ? (minTime / 1000).toFixed(1) + "s / " + (maxTime / 1000).toFixed(1) + "s" : "-"}</span>
            </div>
          </div>

          <div class="all-times-history">
            <span class="times-title">Chronomètres enregistrés (${times.length}) :</span>
            <div class="times-list">${recentTimes ? recentTimes : "Aucune mesure"}</div>
          </div>

          <div class="modal-actions">
            <button type="button" class="btn-action btn-play-audio">
              🔊 Écouter
            </button>
          </div>
        </div>
      </div>
    `;

    modal.querySelector(".btn-close")?.addEventListener("click", () => modal.remove());
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    modal.querySelector(".btn-play-audio")?.addEventListener("click", async () => {
      await audioService.playQuestion(item.a, item.b);
      setTimeout(() => audioService.playAnswer(item.result), 500);
    });

    return modal;
  }

  function render(): HTMLElement {
    const container = document.createElement("div");
    container.className = "matrix-view-container";

    const counts = matrixStore.getCountsByStatus();
    const masteredPct = Math.round((counts.mastered / 100) * 100);

    const totalTimeMs = matrixStore.getTotalPracticeTimeMs();
    const totalMinutes = Math.floor(totalTimeMs / 60000);
    const totalSeconds = Math.floor((totalTimeMs % 60000) / 1000);
    const formattedPracticeTime = totalMinutes > 0 
      ? `${totalMinutes} min ${totalSeconds > 0 ? totalSeconds + " s" : ""}` 
      : `${totalSeconds} secondes`;

    // Section 1 : État des files et régulation
    let poolSectionHtml = "";
    if (repetitionEngine) {
      const qStats = repetitionEngine.getQueueStats();
      const isOverloaded = repetitionEngine.isReviewQueueOverloaded();
      poolSectionHtml = `
        <div class="parent-kpi-card">
          <div class="kpi-header">
            <h3>Temps utile & apprentissage</h3>
            <span class="kpi-badge ${isOverloaded ? "badge-warning" : "badge-ok"}">
              ${isOverloaded ? "Priorité aux erreurs" : "Progression fluide"}
            </span>
          </div>

          <div class="practice-time-banner">
            <span class="time-clock-icon">⏱️</span>
            <div class="time-banner-info">
              <span class="time-banner-val">${formattedPracticeTime}</span>
              <span class="time-banner-lbl">Temps effectif passé à s'entraîner</span>
            </div>
          </div>

          <div class="kpi-grid">
            <div class="kpi-box">
              <span class="kpi-num">${qStats.activePoolSize}</span>
              <span class="kpi-lbl">Calculs en cours</span>
            </div>
            <div class="kpi-box">
              <span class="kpi-num">${qStats.reviewQueueCount}</span>
              <span class="kpi-lbl">En révision</span>
            </div>
            <div class="kpi-box">
              <span class="kpi-num">${counts.discovery}</span>
              <span class="kpi-lbl">En découverte</span>
            </div>
            <div class="kpi-box">
              <span class="kpi-num">${counts.mastered}</span>
              <span class="kpi-lbl">Maîtrisés</span>
            </div>
          </div>
          ${
            isOverloaded
              ? `<p class="kpi-advice">La file de révision contient ${qStats.reviewQueueCount} calculs en difficulté. L'application bloque l'ajout de nouvelles tables pour consolider les acquis.</p>`
              : `<p class="kpi-advice">L'élève alterne harmonieusement nouvelles découvertes et consolidation de ses erreurs.</p>`
          }

          <button type="button" class="btn-parent-guide-toggle" id="btn-toggle-parent-guide">
            <span class="guide-toggle-icon">📖</span>
            <span class="guide-toggle-title">Comprendre la méthode de répétition espacée</span>
            <span class="guide-toggle-arrow" id="guide-arrow">▼</span>
          </button>

          <div class="parent-guide-content" id="parent-guide-content" style="display: none;">
            <div class="guide-intro">
              Cette application applique les principes neuroscientifiques de la mémoire à long terme pour éviter le par cœur éphémère.
            </div>
            <div class="guide-steps-list">
              <div class="guide-step-item">
                <span class="step-num-badge">1</span>
                <div class="step-desc">
                  <strong>Les 4 boîtes de Leitner</strong> : Chaque calcul progresse de la boîte 0 à la boîte 4. Une bonne réponse rapide le fait monter de boîte, une erreur le fait redescendre pour être révisé plus tôt.
                </div>
              </div>
              <div class="guide-step-item">
                <span class="step-num-badge">2</span>
                <div class="step-desc">
                  <strong>Pondération adaptative</strong> : Plus un calcul présente des erreurs récentes, plus il a de chances de réapparaître rapidement. Les calculs solides reviennent à intervalles de plus en plus espacés.
                </div>
              </div>
              <div class="guide-step-item">
                <span class="step-num-badge">3</span>
                <div class="step-desc">
                  <strong>Régulation anti-surcharge</strong> : Si votre enfant a plusieurs calculs en difficulté en même temps, l'application bloque l'arrivée de nouvelles tables tant que les précédentes ne sont pas consolidées.
                </div>
              </div>
              <div class="guide-step-item">
                <span class="step-num-badge">4</span>
                <div class="step-desc">
                  <strong>Critère de maîtrise par réflexe</strong> : Un calcul n'est validé comme maîtrisé qu'après plusieurs réponses exactes rapides en moins de 3,8 secondes pour garantir l'ancrage sans hésitation.
                </div>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    const header = document.createElement("div");
    header.className = "matrix-header";
    header.innerHTML = `
      ${poolSectionHtml}

      <div class="matrix-title-row">
        <h2>Grille des 100 calculs</h2>
        <div class="matrix-mastery-score">${masteredPct}% maîtrisé</div>
      </div>

      <div class="matrix-view-mode-selector">
        <button type="button" class="btn-display-mode ${currentDisplayMode === "status" ? "active" : ""}" data-mode="status">
          Statut
        </button>
        <button type="button" class="btn-display-mode ${currentDisplayMode === "errorRate" ? "active" : ""}" data-mode="errorRate">
          Erreurs
        </button>
        <button type="button" class="btn-display-mode ${currentDisplayMode === "responseTime" ? "active" : ""}" data-mode="responseTime">
          Vitesse
        </button>
      </div>

      <div class="matrix-legend">
        ${
          currentDisplayMode === "status"
            ? `
              <span class="legend-item"><span class="dot dot-unknown"></span> ${counts.unknown} non abordés</span>
              <span class="legend-item"><span class="dot dot-discovery"></span> ${counts.discovery} en découverte</span>
              <span class="legend-item"><span class="dot dot-review"></span> ${counts.review} en révision</span>
              <span class="legend-item"><span class="dot dot-mastered"></span> ${counts.mastered} maîtrisés</span>
            `
            : currentDisplayMode === "errorRate"
            ? `
              <span class="legend-item"><span class="dot heat-safe"></span> Sans erreur</span>
              <span class="legend-item"><span class="dot heat-low"></span> Moins de 25%</span>
              <span class="legend-item"><span class="dot heat-medium"></span> 25 à 50%</span>
              <span class="legend-item"><span class="dot heat-high"></span> Plus de 50%</span>
            `
            : `
              <span class="legend-item"><span class="dot heat-safe"></span> Moins de 2s</span>
              <span class="legend-item"><span class="dot heat-low"></span> 2 à 3.5s</span>
              <span class="legend-item"><span class="dot heat-medium"></span> 3.5 à 5s</span>
              <span class="legend-item"><span class="dot heat-high"></span> Plus de 5s</span>
            `
        }
      </div>
    `;

    header.querySelector("#btn-toggle-parent-guide")?.addEventListener("click", () => {
      const content = header.querySelector("#parent-guide-content") as HTMLElement | null;
      const arrow = header.querySelector("#guide-arrow") as HTMLElement | null;
      if (content) {
        const isHidden = content.style.display === "none";
        content.style.display = isHidden ? "block" : "none";
        if (arrow) arrow.textContent = isHidden ? "▲" : "▼";
      }
    });

    header.querySelectorAll(".btn-display-mode").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const mode = (e.currentTarget as HTMLElement).getAttribute("data-mode") as MatrixDisplayMode;
        if (mode && mode !== currentDisplayMode) {
          currentDisplayMode = mode;
          container.parentElement?.replaceChild(render(), container);
        }
      });
    });

    container.appendChild(header);

    // Grille 10x10
    const gridWrapper = document.createElement("div");
    gridWrapper.className = "matrix-grid-scroll";

    const table = document.createElement("table");
    table.className = "matrix-table";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    headerRow.innerHTML = `<th>×</th>` + Array.from({ length: 10 }, (_, i) => `<th>${i + 1}</th>`).join("");
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");

    for (let a = 1; a <= 10; a++) {
      const row = document.createElement("tr");
      const rowHeader = document.createElement("th");
      rowHeader.textContent = a.toString();
      row.appendChild(rowHeader);

      for (let b = 1; b <= 10; b++) {
        const item = matrixStore.getByFactors(a, b);
        const cell = document.createElement("td");
        cell.setAttribute("data-id", `${a}x${b}`);

        let cellClass = "";
        let displayText = (a * b).toString();
        let subText = "";

        if (item) {
          if (currentDisplayMode === "status") {
            cellClass = `status-${item.status || "unknown"}`;
            displayText = (a * b).toString();
          } else if (currentDisplayMode === "errorRate") {
            const errRate = getErrorRate(item);
            cellClass = getErrorRateColorClass(errRate, item.seenCount);
            subText = item.seenCount > 0 ? `${errRate}%` : "-";
          } else if (currentDisplayMode === "responseTime") {
            cellClass = getResponseTimeColorClass(item.avgResponseTimeMs);
            subText = item.avgResponseTimeMs > 0 ? `${(item.avgResponseTimeMs / 1000).toFixed(1)}s` : "-";
          }
        }

        cell.className = `matrix-cell ${cellClass}`;
        cell.innerHTML = `
          <div class="cell-content">
            <span class="cell-result">${displayText}</span>
            ${subText ? `<span class="cell-sub">${subText}</span>` : ""}
          </div>
        `;

        cell.addEventListener("click", () => {
          if (item) {
            const modal = renderModal(item);
            document.body.appendChild(modal);
          }
        });

        row.appendChild(cell);
      }
      tbody.appendChild(row);
    }

    table.appendChild(tbody);
    gridWrapper.appendChild(table);
    container.appendChild(gridWrapper);

    return container;
  }

  return {
    mount(parent: HTMLElement) {
      element = render();
      parent.appendChild(element);
      unsubscribe = matrixStore.subscribe(() => {
        this.refresh();
      });
    },

    destroy() {
      if (unsubscribe) unsubscribe();
      element?.remove();
      element = null;
    },

    refresh() {
      if (!element || !element.parentElement) return;
      const parent = element.parentElement;
      element.remove();
      element = render();
      parent.appendChild(element);
    }
  };
}

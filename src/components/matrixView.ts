import { FLUENT_ANSWER_MS, MatrixStore } from "../core/matrixStore";
import { MultiplicationItem, ItemStatus } from "../types";
import { AudioService } from "../services/audioService";
import { RepetitionEngine } from "../core/repetitionEngine";

export type MatrixDisplayMode = "status" | "accuracy" | "responseTime";

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
    discovery: { label: "En apprentissage", class: "status-discovery", icon: "🔵" },
    review: { label: "À réviser", class: "status-review", icon: "🟠" },
    mastered: { label: "Maîtrisé", class: "status-mastered", icon: "🟢" }
  };

  function getAccuracy(item: MultiplicationItem): number {
    if (item.seenCount === 0) return 0;
    const accuracy = Math.round(((item.seenCount - item.errorCount) / item.seenCount) * 100);
    return Math.max(0, Math.min(100, accuracy));
  }

  function getAccuracyColorClass(accuracy: number, seenCount: number): string {
    if (seenCount === 0) return "heat-none";
    if (accuracy === 100) return "heat-safe";
    if (accuracy >= 75) return "heat-low";
    if (accuracy >= 50) return "heat-medium";
    return "heat-high";
  }

  function getResponseTimeColorClass(avgMs: number): string {
    if (avgMs === 0) return "heat-none";
    if (avgMs < FLUENT_ANSWER_MS) return "heat-safe";
    if (avgMs < 2 * FLUENT_ANSWER_MS) return "heat-low";
    if (avgMs < 4 * FLUENT_ANSWER_MS) return "heat-medium";
    return "heat-high";
  }

  function formatNextReview(item: MultiplicationItem): string {
    if (item.seenCount === 0 || item.nextReviewAt === null) {
      return "Non programmée";
    }
    const now = Date.now();
    const diffMs = item.nextReviewAt - now;
    if (diffMs <= 0 || item.status === "review") {
      return "À réviser ce jour";
    }
    const diffMinutes = Math.round(diffMs / 60000);
    if (diffMinutes < 60) {
      return `Dans ${Math.max(1, diffMinutes)} min`;
    }
    const diffHours = Math.round(diffMs / 3600000);
    if (diffHours < 24) {
      return `Dans ${diffHours} h`;
    }
    const diffDays = Math.round(diffMs / 86400000);
    return `Dans ${diffDays} jour${diffDays > 1 ? "s" : ""}`;
  }

  function formatInterval(item: MultiplicationItem): string {
    if (item.seenCount === 0) return "-";
    if (item.intervalDays < 0.05) return "10 minutes";
    if (item.intervalDays < 1.5) return "1 jour";
    return `${Math.round(item.intervalDays)} jours`;
  }

  function renderModal(item: MultiplicationItem): HTMLElement {
    const modal = document.createElement("div");
    modal.className = "matrix-detail-modal";

    const st = statusLabels[item.status];
    const accuracy = getAccuracy(item);
    const times = item.responseTimesMs || [];
    const minTime = times.length > 0 ? Math.min(...times) : 0;
    const maxTime = times.length > 0 ? Math.max(...times) : 0;
    const recentTimes = times.slice(-5).map((t) => `${(t / 1000).toFixed(2)}s`).join(", ");
    const isDue = matrixStore.isItemDue(item);

    modal.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <h3>${item.a} × ${item.b} = ${item.result}</h3>
          <button type="button" class="btn-close" aria-label="Fermer">✕</button>
        </div>
        <div class="modal-body">
          <div class="status-badge ${st.class}">
            ${st.icon} ${st.label} — Boîte ${item.boxLevel} sur 5
          </div>
          <div class="stats-grid">
            <div class="stat-item">
              <span class="stat-label">Présentations :</span>
              <span class="stat-val">${item.seenCount}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Précision :</span>
              <span class="stat-val ${accuracy < 70 && item.seenCount > 0 ? "text-danger" : ""}">${item.seenCount > 0 ? accuracy + "%" : "-"}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Prochaine révision :</span>
              <span class="stat-val ${isDue && item.seenCount > 0 ? "text-warning" : ""}">${formatNextReview(item)}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Intervalle mémoire :</span>
              <span class="stat-val">${formatInterval(item)}</span>
            </div>
            <div class="stat-item">
              <span class="stat-label">Erreurs au total :</span>
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
            <span class="times-title">Historique des chronos - ${times.length} mesure${times.length > 1 ? "s" : ""} :</span>
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
    if (repetitionEngine) {
      const qStats = repetitionEngine.getQueueStats();
      const isOverloaded = repetitionEngine.isReviewQueueOverloaded();
      const poolCard = document.createElement("div");
      poolCard.className = "parent-kpi-card";
      poolCard.innerHTML = `
        <div class="kpi-header">
          <h3>Temps utile & apprentissage</h3>
          <span class="kpi-badge ${isOverloaded ? "badge-warning" : "badge-ok"}">
            ${isOverloaded ? "Priorité aux révisions" : "Progression fluide"}
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
            <span class="kpi-num">${qStats.dueCount}</span>
            <span class="kpi-lbl">À réviser aujourd'hui</span>
          </div>
          <div class="kpi-box">
            <span class="kpi-num">${qStats.learningCount}</span>
            <span class="kpi-lbl">En apprentissage</span>
          </div>
          <div class="kpi-box">
            <span class="kpi-num">${qStats.masteredCount}</span>
            <span class="kpi-lbl">Maîtrisés</span>
          </div>
          <div class="kpi-box">
            <span class="kpi-num">${qStats.nextSessionNewCount}</span>
            <span class="kpi-lbl">Nouveaux à la prochaine séance</span>
          </div>
        </div>
        ${
          isOverloaded
            ? `<p class="kpi-advice">${qStats.dueCount} calculs sont à réviser : ils occupent toute la prochaine séance. Les nouveaux calculs reprendront une fois ces révisions faites.</p>`
            : qStats.newAvailableCount === 0
            ? `<p class="kpi-advice">Tous les calculs des tables actives ont été abordés ! Vos prochaines séances consolident les révisions.</p>`
            : `<p class="kpi-advice">La prochaine séance mêle les révisions du jour et ${qStats.nextSessionNewCount} nouveaux calculs.</p>`
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
                <strong>Révisions à jours fixes</strong> : Un calcul réussi pour la première fois se révise le lendemain, puis au 3e, au 7e et au 21e jour. Réussi ce 21e jour, il est maîtrisé et son cadeau est gagné pour de bon. Après une erreur, il revient 10 minutes plus tard et son calendrier repart du début. Un calcul ne change de boîte que le jour prévu : le réussir plusieurs fois dans la même séance l'entraîne, sans le faire monter plus vite.
              </div>
            </div>
            <div class="guide-step-item">
              <span class="step-num-badge">2</span>
              <div class="step-desc">
                <strong>Espacement intra-séance protecteur</strong> : Après une réponse incorrecte, l application attend au moins 3 calculs intercalaires avant de réinterroger votre enfant. Cela force l évocation active en mémoire profonde au lieu du simple souvenir immédiat.
              </div>
            </div>
            <div class="guide-step-item">
              <span class="step-num-badge">3</span>
              <div class="step-desc">
                <strong>Vitesse de réponse et réflexe</strong> : Une réponse en moins de 5 secondes est fluide (vert) : elle rapporte un bonus, et elle est demandée pour entrer en dernière boîte. Plus lente ce jour-là, le calcul revient simplement le lendemain. La vitesse ne change pas les autres révisions.
              </div>
            </div>
            <div class="guide-step-item">
              <span class="step-num-badge">4</span>
              <div class="step-desc">
                <strong>Un lot fixe par séance</strong> : Chaque séance travaille un lot de calculs choisi au départ, les révisions du jour d'abord, puis quelques nouveaux selon la durée (2 pour 3 minutes, jusqu'à 8 pour 15 minutes). Quand les révisions remplissent le lot, aucun nouveau calcul n'est ajouté, pour protéger votre enfant de la surcharge cognitive.
              </div>
            </div>
            <div class="guide-step-item">
              <span class="step-num-badge">5</span>
              <div class="step-desc">
                <strong>Ordre d'apprentissage des tables</strong> : Les nouveaux calculs sont introduits selon l ordre défini sur l accueil sous Révision guidée (par défaut : 1, 10, 2, 5, 3, 4, 6, 7, 8, 9). Vous pouvez glisser-déposer les tables pour personnaliser cet ordre ou mettre des tables en pause.
              </div>
            </div>
            <div class="guide-step-item">
              <span class="step-num-badge">6</span>
              <div class="step-desc">
                <strong>Contrôle d ancrage à 21 jours</strong> : Même lorsqu un calcul est validé comme maîtrisé, il est revu toutes les 3 semaines pour vérifier que le réflexe reste parfait au fil du temps.
              </div>
            </div>
          </div>
        </div>
      `;

      poolCard.querySelector("#btn-toggle-parent-guide")?.addEventListener("click", () => {
        const content = poolCard.querySelector("#parent-guide-content") as HTMLElement | null;
        const arrow = poolCard.querySelector("#guide-arrow") as HTMLElement | null;
        if (content) {
          const isHidden = content.style.display === "none";
          content.style.display = isHidden ? "block" : "none";
          if (arrow) arrow.textContent = isHidden ? "▲" : "▼";
        }
      });

      container.appendChild(poolCard);
    }

    // Section 2 : Grille des 100 calculs
    const header = document.createElement("div");
    header.className = "matrix-header";
    header.innerHTML = `
      <div class="matrix-title-row">
        <h2>Grille des 100 calculs</h2>
        <div class="matrix-mastery-score">${masteredPct}% maîtrisé</div>
      </div>

      <div class="matrix-view-mode-selector">
        <button type="button" class="btn-display-mode ${currentDisplayMode === "status" ? "active" : ""}" data-mode="status">
          Statut
        </button>
        <button type="button" class="btn-display-mode ${currentDisplayMode === "accuracy" ? "active" : ""}" data-mode="accuracy">
          Précision
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
              <span class="legend-item"><span class="dot dot-discovery"></span> ${counts.discovery} en apprentissage</span>
              <span class="legend-item"><span class="dot dot-review"></span> ${counts.review} en révision</span>
              <span class="legend-item"><span class="dot dot-mastered"></span> ${counts.mastered} maîtrisés</span>
            `
            : currentDisplayMode === "accuracy"
            ? `
              <span class="legend-item"><span class="dot heat-safe"></span> 100% parfait</span>
              <span class="legend-item"><span class="dot heat-low"></span> 75 à 99%</span>
              <span class="legend-item"><span class="dot heat-medium"></span> 50 à 74%</span>
              <span class="legend-item"><span class="dot heat-high"></span> Moins de 50%</span>
            `
            : `
              <span class="legend-item"><span class="dot heat-safe"></span> Moins de 5s</span>
              <span class="legend-item"><span class="dot heat-low"></span> 5 à 10s</span>
              <span class="legend-item"><span class="dot heat-medium"></span> 10 à 20s</span>
              <span class="legend-item"><span class="dot heat-high"></span> Plus de 20s</span>
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
          } else if (currentDisplayMode === "accuracy") {
            const accuracy = getAccuracy(item);
            cellClass = getAccuracyColorClass(accuracy, item.seenCount);
            subText = item.seenCount > 0 ? `${accuracy}%` : "-";
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

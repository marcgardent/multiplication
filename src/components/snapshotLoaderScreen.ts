import { ProfileData } from "../core/profileData";
import { fetchSnapshot, fetchSnapshotIndex, rebaseProfileData, SnapshotMeta } from "../testing/snapshots";

export interface SnapshotLoaderOptions {
  onLoad: (data: ProfileData, snapshot: SnapshotMeta) => void;
  onBack: () => void;
}

// Écran du joueur de test : charge dans son profil un état enregistré par `make scenarios`
export function renderSnapshotLoader(container: HTMLElement, options: SnapshotLoaderOptions): void {
  container.innerHTML = `
    <div class="carnet-top-bar">
      <button type="button" class="btn-back-home" id="btn-snapshots-back">Accueil</button>
      <h2>Scénarios de test</h2>
    </div>
    <div class="snapshot-screen">
      <p class="snapshot-intro">
        Chaque scénario remplace toute la progression de ce joueur par un état enregistré, recalé sur aujourd'hui.
      </p>
      <p class="snapshot-status" id="snapshot-status" role="status">Chargement de la liste…</p>
      <div class="snapshot-list" id="snapshot-list"></div>
    </div>
  `;

  const statusEl = container.querySelector("#snapshot-status") as HTMLElement;
  const listEl = container.querySelector("#snapshot-list") as HTMLElement;
  container.querySelector("#btn-snapshots-back")?.addEventListener("click", options.onBack);

  function summaryLine(snapshot: SnapshotMeta): string {
    const { points, giftsEarned, giftsToOpen, dueCount, boxes } = snapshot.summary;
    const gifts = giftsEarned === 0 ? "aucun cadeau" : `${giftsEarned} cadeau${giftsEarned > 1 ? "x" : ""}, ${giftsToOpen} à ouvrir`;
    return `${points} points, ${gifts}, ${dueCount} à réviser<br />Boîtes 0 à 5 : ${boxes.join(" · ")}`;
  }

  function renderList(snapshots: SnapshotMeta[]): void {
    statusEl.textContent = `${snapshots.length} scénarios disponibles`;
    listEl.innerHTML = snapshots
      .map(
        (snapshot) => `
          <article class="snapshot-card">
            <div class="snapshot-card-head">
              <h3>${snapshot.title}</h3>
              <span class="snapshot-day">${snapshot.day}</span>
            </div>
            <p class="snapshot-learner">${snapshot.learner}</p>
            <p class="snapshot-description">${snapshot.description}</p>
            <p class="snapshot-summary">${summaryLine(snapshot)}</p>
            <ul class="snapshot-checks">
              ${snapshot.checks.map((check) => `<li>${check}</li>`).join("")}
            </ul>
            <button type="button" class="btn-load-snapshot" data-id="${snapshot.id}">Charger</button>
          </article>
        `
      )
      .join("");

    listEl.querySelectorAll<HTMLButtonElement>(".btn-load-snapshot").forEach((button) => {
      button.addEventListener("click", async () => {
        const meta = snapshots.find((s) => s.id === button.dataset.id);
        if (!meta) return;
        button.disabled = true;
        try {
          const snapshot = await fetchSnapshot(meta.id);
          options.onLoad(rebaseProfileData(snapshot), meta);
        } catch (err) {
          button.disabled = false;
          statusEl.textContent = err instanceof Error ? err.message : "Chargement impossible";
        }
      });
    });
  }

  fetchSnapshotIndex()
    .then(renderList)
    .catch(() => {
      statusEl.textContent = "Aucun snapshot trouvé : lancer « make scenarios » pour les générer.";
    });
}

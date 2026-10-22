// Pages autonomes du site : présentation, conditions d'utilisation, confidentialité
import "@fontsource-variable/lexend";
import "../styles/site.scss";
import { compareVersions, VERSION_HISTORY } from "../core/releaseNotes";

document.querySelectorAll("[data-app-version]").forEach((el) => {
  el.textContent = `Version ${__APP_VERSION__}`;
});

// Historique des versions de la page d'accueil, depuis les mêmes nouveautés que l'application ; jusqu'à la version publiée
const historyBody = document.querySelector("[data-version-history]");
if (historyBody) {
  const day = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
  VERSION_HISTORY.filter((entry) => compareVersions(entry.version, __APP_VERSION__) <= 0).forEach((entry) => {
    const row = document.createElement("tr");
    [entry.version, day(entry.date), entry.summary].forEach((text) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.appendChild(cell);
    });
    historyBody.appendChild(row);
  });
}

// Même bouton que dans l'application : il n'apparaît que lorsque le navigateur propose l'installation
let installPrompt: (Event & { prompt(): Promise<void> }) | null = null;
const installButton = document.querySelector<HTMLButtonElement>("#btn-install-app");

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event as Event & { prompt(): Promise<void> };
  if (installButton) installButton.hidden = false;
});
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  if (installButton) installButton.hidden = true;
});
installButton?.addEventListener("click", async () => {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  installButton.hidden = true;
  await prompt.prompt();
});

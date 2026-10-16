// Pages autonomes du site : présentation, conditions d'utilisation, confidentialité
import "@fontsource-variable/lexend";
import "../styles/site.scss";

document.querySelectorAll("[data-app-version]").forEach((el) => {
  el.textContent = `Version ${__APP_VERSION__}`;
});

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

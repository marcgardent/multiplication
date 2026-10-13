import "@fontsource-variable/lexend";
import "./styles/main.scss";
import { createApp } from "./app";
import { isInstalledApp, startBackGuard } from "./services/backGuardService";
import { startUpdateWatcher } from "./services/updateService";

const app = createApp();
app.mount("#app");

// Une fenêtre ouverte (séance, radio, brossage, choix) retarde le rechargement après une mise à jour
startUpdateWatcher(() => document.querySelector(".session-modal-overlay") !== null);

// En développement, désenregistrer tout Service Worker résiduel pour éviter les caches fantômes sur localhost
if (!import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const reg of registrations) {
      reg.unregister();
    }
  });
  if ("caches" in window) {
    caches.keys().then((names) => {
      for (const name of names) {
        caches.delete(name);
      }
    });
  }
}

// Dans l'application installée, le bouton retour du téléphone ne ferme plus l'application
if (isInstalledApp()) startBackGuard();

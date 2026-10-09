import "@fontsource-variable/lexend";
import "./styles/main.scss";
import { createApp } from "./app";

// Initialisation de la PWA Service Worker avec vite-plugin-pwa
if ("serviceWorker" in navigator) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({
        immediate: true,
        onNeedRefresh() {
          console.log("Nouvelle version de l'application disponible.");
        },
        onOfflineReady() {
          console.log("Application prête pour une utilisation 100% hors-ligne.");
        }
      });
    })
    .catch((err) => {
      console.warn("Service worker registration non disponible en mode dev", err);
    });
}

const app = createApp();
app.mount("#app");

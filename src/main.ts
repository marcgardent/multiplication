import "@fontsource-variable/lexend";
import "./styles/main.scss";
import { createApp } from "./app";
import { startUpdateWatcher } from "./services/updateService";

const app = createApp();
app.mount("#app");

// Une fenêtre ouverte (séance, radio, brossage, choix) retarde le rechargement après une mise à jour
startUpdateWatcher(() => document.querySelector(".session-modal-overlay") !== null);

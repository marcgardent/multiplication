// Pages autonomes du site : présentation, conditions d'utilisation, confidentialité
import "@fontsource-variable/lexend";
import "../styles/site.scss";

document.querySelectorAll("[data-app-version]").forEach((el) => {
  el.textContent = `Version ${__APP_VERSION__}`;
});

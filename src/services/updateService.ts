// Mise à jour de l'application installée.
// Le navigateur ne cherche une nouvelle version qu'au chargement d'une page. Or une application installée
// reste en mémoire des jours : on la rouvre sans rien recharger, donc sans jamais rien chercher.
// On vérifie donc nous-mêmes, à chaque retour au premier plan puis toutes les 30 minutes,
// et on recharge dès que l'écran est libre : jamais au milieu d'une séance, de la radio ou du brossage.

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const BUSY_RETRY_MS = 2000;

export function startUpdateWatcher(isBusy: () => boolean): void {
  // En développement il n'y a pas de service worker
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  // À la toute première installation, la prise de contrôle n'est pas une mise à jour
  let isControlled = navigator.serviceWorker.controller !== null;
  let isReloading = false;

  function reloadWhenIdle() {
    if (isReloading) return;
    if (isBusy()) {
      setTimeout(reloadWhenIdle, BUSY_RETRY_MS);
      return;
    }
    isReloading = true;
    window.location.reload();
  }

  // La nouvelle version est téléchargée et a pris la main : il reste à recharger la page
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (isControlled) reloadWhenIdle();
    isControlled = true;
  });

  navigator.serviceWorker
    .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
    .then((registration) => {
      const check = () => {
        if (document.visibilityState !== "visible" || !navigator.onLine) return;
        registration.update().catch((err) => console.warn("Recherche de mise à jour impossible", err));
      };
      document.addEventListener("visibilitychange", check);
      window.addEventListener("online", check);
      setInterval(check, CHECK_INTERVAL_MS);
    })
    .catch((err) => console.warn("Service worker non enregistré", err));
}

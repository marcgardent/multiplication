// Bouton retour du téléphone.
// Dans l'application installée, il n'y a rien derrière la page : un appui sur retour ferme l'application,
// en pleine séance. On ajoute donc une étape dans l'historique, et chaque retour y est aussitôt renvoyé.
// Le navigateur ignore au retour une étape ajoutée sans geste : elle est posée au premier toucher.

type GuardWindow = Pick<Window, "history" | "addEventListener">;

const GUARD_STATE = { backGuard: true };

// Vrai pour l'application installée ; dans un onglet, le bouton retour reste celui du navigateur
export function isInstalledApp(): boolean {
  const isStandaloneOnIos = (window.navigator as { standalone?: boolean }).standalone === true;
  return window.matchMedia("(display-mode: standalone)").matches || isStandaloneOnIos;
}

export function startBackGuard(win: GuardWindow = window): void {
  const isOnGuard = () => win.history.state?.backGuard === true;

  const arm = () => {
    if (!isOnGuard()) win.history.pushState(GUARD_STATE, "");
  };

  win.addEventListener("pointerup", arm, true);
  win.addEventListener("keydown", arm, true);
  win.addEventListener("popstate", () => {
    if (!isOnGuard()) win.history.forward();
  });
}

// Nouveautés, écrites pour les familles : ce qui change pour elles, sans jargon. Historique reconstitué depuis git.
// - VERSION_HISTORY : chaque version publiée, en une ligne ; la page d'accueil du site l'affiche en tableau.
// - RELEASE_NOTES : les versions majeures seulement (une par série 1.x), montrées dans l'application
//   à la première ouverture d'une nouvelle série, et toutes ensemble depuis la mention « Version » de l'accueil.
// Monter la version sans ajouter sa ligne (et, pour une nouvelle série, sa note) fait échouer les tests.

export interface VersionEntry {
  version: string;
  // Jour de publication, AAAA-MM-JJ
  date: string;
  summary: string;
}

export interface ReleaseNote {
  // Série : « 1.7 »
  series: string;
  title: string;
}

// De la plus récente à la plus ancienne
export const VERSION_HISTORY: VersionEntry[] = [
  { version: "1.8.4", date: "2026-10-23", summary: "Texte de l'affiche corrigé sur le site" },
  { version: "1.8.3", date: "2026-10-23", summary: "Test du téléphone plus court et plus clair ; une note de nouveautés pour la 1.8" },
  { version: "1.8.2", date: "2026-10-22", summary: "Espace parent aligné sur les autres boutons de l'accueil" },
  { version: "1.8.1", date: "2026-10-22", summary: "Message « Application mise à jour » ; brossage, radio et espace parent visibles sur l'accueil du joueur ; une fenêtre par réglage" },
  { version: "1.8.0", date: "2026-10-22", summary: "Les nouveautés s'affichent après chaque grande mise à jour ; historique des versions sur le site" },
  { version: "1.7.5", date: "2026-10-22", summary: "Bouton à maintenir pour répondre à voix haute ; test du téléphone ; carte parent simplifiée" },
  { version: "1.7.4", date: "2026-10-22", summary: "La voix marche mieux sur les téléphones lents ; premier test du téléphone" },
  { version: "1.7.3", date: "2026-10-22", summary: "L'enfant voit qu'il est entendu" },
  { version: "1.7.2", date: "2026-10-22", summary: "Affiche à imprimer" },
  { version: "1.7.1", date: "2026-10-22", summary: "La voix s'active dans l'espace parent" },
  { version: "1.7.0", date: "2026-10-22", summary: "Répondre à voix haute ; choix En silence, Avec le son ou Je parle" },
  { version: "1.6.0", date: "2026-10-22", summary: "Voix enregistrées par un parent" },
  { version: "1.5.3", date: "2026-10-22", summary: "Bouton « Je ne sais pas » au-dessus du clavier" },
  { version: "1.5.2", date: "2026-10-18", summary: "L'appui sur Valider n'est plus compté dans le temps" },
  { version: "1.5.1", date: "2026-10-18", summary: "Nouveau clavier : Effacer à gauche, Valider en vert" },
  { version: "1.5.0", date: "2026-10-17", summary: "Radio et brossage en mode Guidé ou Manuel ; calculs répétés pendant l'écoute" },
  { version: "1.4.2", date: "2026-10-16", summary: "Bouton pour installer l'application ; conseils d'épinglage sous Android" },
  { version: "1.4.1", date: "2026-10-13", summary: "Clavier stable sur téléphone" },
  { version: "1.4.0", date: "2026-10-13", summary: "Ordre d'apprentissage au choix ; bonne réponse dite en révision des tables ; tables retenues par joueur" },
  { version: "1.3.1", date: "2026-10-11", summary: "Le bouton retour ne ferme plus l'application" },
  { version: "1.3.0", date: "2026-10-11", summary: "Espace parent protégé par un code" },
  { version: "1.2.0", date: "2026-10-10", summary: "Sauvegarde automatique dans Google Drive, partagée entre appareils" },
  { version: "1.1.0", date: "2026-10-10", summary: "Radio des tables et brossage de dents ; l'écran reste allumé" },
  { version: "1.0.0", date: "2026-10-08", summary: "Première version : révisions au jour 1, 3, 7 et 21, points, cadeaux, décors, roue, carnet de suivi" }
];

// Versions majeures, de la plus récente à la plus ancienne : une seule nouveauté chacune, en quelques mots
export const RELEASE_NOTES: ReleaseNote[] = [
  { series: "1.8", title: "L'espace parent visible depuis l'accueil" },
  { series: "1.7", title: "Répondre à voix haute" },
  { series: "1.6", title: "Votre voix à la place de la voix de synthèse" },
  { series: "1.5", title: "Radio et brossage guidés" },
  { series: "1.4", title: "Choisir l'ordre des tables" },
  { series: "1.3", title: "Espace parent" },
  { series: "1.2", title: "Sauvegarde Google Drive" },
  { series: "1.1", title: "Radio des tables et brossage de dents" },
  { series: "1.0", title: "Première version" }
];

// Série d'une version : « 1.7.4 » → « 1.7 »
export function seriesOf(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

// Compare deux versions ou séries nombre par nombre : négatif si a est plus ancienne que b
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

// Toutes les versions majeures jusqu'à la version installée
export function notesUpTo(current: string): ReleaseNote[] {
  return RELEASE_NOTES.filter((note) => compareVersions(note.series, seriesOf(current)) <= 0);
}

// Versions majeures parues entre la dernière version vue et la version installée
export function notesSince(lastSeen: string, current: string): ReleaseNote[] {
  return notesUpTo(current).filter((note) => compareVersions(note.series, seriesOf(lastSeen)) > 0);
}

// Une famille qui utilisait l'application avant que les nouveautés existent voit les deux dernières versions majeures :
// celle qui les affiche, et celle d'avant, qu'on ne lui a jamais présentée
const FIRST_TIME_SERIES = 2;

// À montrer au lancement : rien à la toute première ouverture ; sinon les séries parues depuis la dernière version vue
export function notesToShow(lastSeen: string | null, current: string, hasUsedApp: boolean): ReleaseNote[] {
  if (lastSeen === null) return hasUsedApp ? notesUpTo(current).slice(0, FIRST_TIME_SERIES) : [];
  return notesSince(lastSeen, current);
}

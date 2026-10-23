// Les états capturés par les scénarios, dans l'ordre où l'écran de test les présente
export interface CatalogEntry {
  id: string;
  title: string;
  day: string;
  learner: string;
  description: string;
  checks: string[];
}

const REGULAR = "Élève régulière, 6 min par jour";
const STRUGGLING = "Élève en difficulté, 3 min par jour";
const FAST = "Élève rapide, 15 min par jour";

export const CATALOG = [
  {
    id: "nouveau-joueur",
    title: "Nouveau joueur",
    day: "J0, avant tout",
    learner: "Personne n'a encore joué",
    description: "Profil vierge : les 100 calculs sont en Boîte 0.",
    checks: ["La révision guidée fait écouter 4 calculs", "0 cadeau, 1 décor sur 14"]
  },
  {
    id: "j01-premiere-revision",
    title: "Première révision",
    day: "J1, matin",
    learner: REGULAR,
    description: "Les calculs réussis hier sont en Boîte 1 et échus aujourd'hui.",
    checks: ["La séance les fait passer en Boîte 2", "Ils ne sont pas réécoutés avant d'être interrogés", "Toujours 0 cadeau à la fin"]
  },
  {
    id: "decor-ete-imminent",
    title: "Décor Été à portée",
    day: "J4, en cours de séance",
    learner: REGULAR,
    description: "Il manque 15 points au plus pour débloquer Été, le premier décor à gagner.",
    checks: [
      "Décors : Été est verrouillé, « Encore N points nécessaires »",
      "Une ou deux bonnes réponses en Révision tables",
      "Décors : Été est débloqué, 2 sur 14"
    ]
  },
  {
    id: "decor-ete-debloque",
    title: "Décor Été tout juste débloqué",
    day: "J4, en cours de séance",
    learner: REGULAR,
    description: "Le seuil du décor Été vient d'être atteint, le décor n'est pas encore choisi.",
    checks: ["Accueil : Décors 2 sur 14", "Décors : Été propose « Choisir ce fond »", "Le fond change et reste après rechargement"]
  },
  {
    id: "j03-revision",
    title: "Révision du 3e jour",
    day: "J3, matin",
    learner: REGULAR,
    description: "Les calculs appris à J0 sont en Boîte 2 et échus aujourd'hui.",
    checks: ["La séance les fait passer en Boîte 3, prochaine révision dans 4 jours", "Toujours 0 cadeau"]
  },
  {
    id: "j07-revision",
    title: "Révision du 7e jour",
    day: "J7, matin",
    learner: REGULAR,
    description: "Les calculs appris à J0 sont en Boîte 3 et échus aujourd'hui.",
    checks: ["La séance les fait passer en Boîte 4, prochaine révision dans 14 jours", "Toujours 0 cadeau"]
  },
  {
    id: "roue-epuisee",
    title: "Roue épuisée",
    day: "J10, soir",
    learner: REGULAR,
    description: "Les 3 tours de roue du jour sont utilisés.",
    checks: ["Accueil : la carte Roue Magique affiche « Demain »", "La roue ne se lance plus"]
  },
  {
    id: "j20-avant-cadeau",
    title: "Veille du cadeau",
    day: "J20, soir",
    learner: REGULAR,
    description: "Vingt jours de séances, des calculs en Boîte 4, et toujours aucun cadeau.",
    checks: ["Accueil : Mes Cadeaux 0 sur 100", "Une Révision tables réussie aujourd'hui ne donne pas de cadeau"]
  },
  {
    id: "j21-jour-du-cadeau",
    title: "Le jour du cadeau",
    day: "J21, matin",
    learner: REGULAR,
    description: "Les calculs appris à J0 sont en Boîte 4 et échus aujourd'hui : la séance du jour donne les premiers cadeaux.",
    checks: [
      "Accueil avant la séance : 0 cadeau",
      "Révision guidée : à la fin, « cadeaux à ouvrir »",
      "Carnet : ces calculs sont maîtrisés, Boîte 5"
    ]
  },
  {
    id: "j21-cadeaux-a-ouvrir",
    title: "Cadeaux à ouvrir",
    day: "J21, soir",
    learner: REGULAR,
    description: "Les premiers cadeaux sont gagnés, aucun n'est ouvert.",
    checks: ["Mes Cadeaux : des paquets à ouvrir", "Ouvrir un paquet : +25 points", "Le paquet ouvert le reste après rechargement"]
  },
  {
    id: "cadeau-garde-apres-echec",
    title: "Cadeau gardé après un échec",
    day: "J22, matin",
    learner: REGULAR,
    description: "Un cadeau a été ouvert, puis son calcul a été raté : il est retombé en Boîte 0.",
    checks: ["Carnet : le calcul est « à revoir », Boîte 0", "Mes Cadeaux : son cadeau est toujours ouvert", "Les autres cadeaux gagnés sont toujours à ouvrir"]
  },
  {
    id: "j42-entretien",
    title: "Révision d'entretien",
    day: "J42, matin",
    learner: REGULAR,
    description: "Les calculs maîtrisés à J21 sont de nouveau échus, 21 jours plus tard.",
    checks: ["La séance les interroge", "Réussis, ils restent en Boîte 5 pour 21 jours", "Ratés, ils retombent en Boîte 0 et gardent leur cadeau"]
  },
  {
    id: "erreurs-a-reviser",
    title: "Erreurs à revoir",
    day: "Fin d'une séance difficile",
    learner: STRUGGLING,
    description: "Plusieurs calculs viennent d'être ratés : ils sont en Boîte 0 et reviennent dans 10 minutes.",
    checks: ["Carnet : calculs « à revoir »", "La révision guidée les fait réécouter", "Une réussite tout de suite ne les fait pas monter, 10 minutes plus tard si"]
  },
  {
    id: "revisions-saturees",
    title: "Révisions saturées",
    day: "Matin",
    learner: STRUGGLING,
    description: "Les révisions échues remplissent toute une séance de 3 minutes : aucun nouveau calcul n'entre.",
    checks: ["Carnet : alerte de file de révisions pleine", "Révision guidée de 3 minutes : rien de nouveau à écouter"]
  },
  {
    id: "retour-apres-absence",
    title: "Retour après deux semaines d'absence",
    day: "J24, matin",
    learner: "Élève régulière jusqu'à J9, puis absente",
    description: "Dix jours de séances, puis plus rien pendant deux semaines : tout est en retard.",
    checks: ["Carnet : beaucoup de calculs à réviser aujourd'hui", "Chaque calcul réussi ne monte que d'une boîte", "L'attente suivante repart d'aujourd'hui"]
  },
  {
    id: "presque-fini",
    title: "Presque fini",
    day: "Matin",
    learner: FAST,
    description: "Au moins 95 calculs sont en Boîte 5.",
    checks: ["Mes Cadeaux : presque tout est gagné", "Décors : tous débloqués", "Carnet : il reste quelques calculs en cours"]
  },
  {
    id: "tout-maitrise",
    title: "Tout est maîtrisé",
    day: "Soir",
    learner: FAST,
    description: "Les 100 calculs sont en Boîte 5.",
    checks: ["Mes Cadeaux : 100 sur 100", "La révision guidée se lance quand même", "Carnet : 100 maîtrisés"]
  }
] as const satisfies readonly CatalogEntry[];

export type SnapshotId = (typeof CATALOG)[number]["id"];

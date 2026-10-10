# Multiplications PWA - Entraînement Vocal Hors-Ligne

Application web progressive (PWA) d'apprentissage des tables de multiplication, spécialement conçue pour être installée et utilisée **100% hors-ligne sur Android**.

https://marcgardent.github.io/multiplication/

---

## 🚀 Fonctionnalités Clés

1. **Génération Audio TTS Français en Local (`uv` + `Makefile`)** :
   - Voix neuronale française Piper (`fr_FR-siwis-medium`), synthétisée sur la machine : aucun service en ligne, le modèle est téléchargé une fois dans `scripts/.voices/`.
   - 156 fichiers audios générés : 100 questions distinctes (`"2 fois 7"`, `"7 fois 2"`), 42 réponses uniques (`"14"`, etc.), 12 félicitations et les 2 annonces du brossage de dents.
   - Les félicitations sont la liste `CHEERS` de `scripts/generate_audio.py`, les annonces la liste `PHRASES` : modifier la liste puis lancer `make audio`.
   - Tous les fichiers sont pré-cachés par le Service Worker Workbox pour un fonctionnement complet en mode avion.

2. **Matrice 10×10 avec Suivi Séparé & Statuts d'Apprentissage** :
   - **Dissociation stricte de la commutativité** : $2 \times 7$ et $7 \times 2$ ont leur propre suivi, historique d'erreurs et temps moyen de réponse.
   - **4 Statuts visuels** :
     - ⚪ **Inconnu** : non encore abordé.
     - 🔵 **Découverte** : en cours d'écoute ou introduit récemment.
     - 🟠 **Révision** : erreur commise ou temps de réponse lent.
     - 🟢 **Maîtrisé** : réussi aux révisions de J1, J3, J7 et J21 ; le cadeau du calcul est alors gagné pour de bon (voir [`docs/progression-et-recompenses.md`](docs/progression-et-recompenses.md)).
   - Fiche détaillée consultable au toucher pour chaque calcul.

3. **Algorithme de Répétition Espacée avec Régulation de Surcharge (*Backpressure*)** :
   - Pool actif borné à $N$ multiplications.
   - **Protection anti-surcharge** : si la file de révision est encombrée, aucune nouvelle opération n'est injectée. L'apprenant consolide ses erreurs avant de progresser.
   - Respect strict de la durée de session (**$N$ minutes** garanties).

4. **3 Modes Dédiés** :
   - 🎧 **Mode 1 : Découverte (Écoute Passive)** : Question vocale $\rightarrow$ pause de réflexion $\rightarrow$ réponse vocale avec affichage synchronisé.
   - 🎯 **Mode 2 : Quiz Sans Enjeu** : Entraînement bienveillant, possibilité de recommencer à l'infini ou de dévoiler la réponse vocale.
   - ⚡ **Mode 3 : Time-Attack** : Chronomètre haute précision (ms), mesure des réflexes et alimentation automatique des révisions.

5. **2 Modes d'Écoute Sans Joueur** (écran « Qui va s'entraîner ? ») :
   - 📻 **Radio des tables** : question, temps de réflexion, réponse, dans un ordre aléatoire et sans fin. Elle continue écran éteint.
   - 🪥 **Brossage de dents** : « Début du brossage des dents », 3 minutes de calculs avec décompte à l'écran, puis une félicitation et « Fin du brossage des dents ». L'écran reste allumé.
   - On choisit ses tables avant de lancer ; chaque mode retient sa dernière sélection. Aucun point, aucune progression : ces modes n'appartiennent à aucun joueur.

6. **PWA Mobile-First pour Android** :
   - Pavé tactile virtuel ergonomique évitant les sursauts d'affichage du clavier virtuel Android.
   - Bouton in-app d'installation PWA (`beforeinstallprompt`).
   - Mode plein écran autonome (`display: standalone`).

---

## 🛠️ Commandes Disponibles (`Makefile`)

| Commande | Action |
|---|---|
| `make audio` | Génère les voix (questions, réponses, félicitations) dans `public/audio/` via `uv` ; seuls les fichiers absents ou dont la phrase a changé sont refaits |
| `make install` | Installe les dépendances npm |
| `make dev` | Démarre le serveur de développement Vite |
| `make build` | Compile TypeScript + SCSS + PWA pour la production (`dist/`) |
| `make preview` | Prévisualise le build de production localement |
| `make test` | Lance les tests des règles de progression : un test par flèche du graphe des boîtes |
| `make scenarios` | Fait jouer des élèves simulés sur plusieurs semaines et régénère `public/snapshots/` |

## 📱 Veille du téléphone

Un téléphone met en veille une page que personne ne touche, ce qui coupait les séances d'écoute. Deux réponses, selon le besoin :

- **Garder l'écran allumé** (révision guidée, révision des tables, brossage de dents) : [`src/services/wakeLockService.ts`](src/services/wakeLockService.ts) demande un verrou d'écran (Screen Wake Lock) pendant l'activité et le rend à la fin. Le système le retire quand l'application passe en arrière-plan ; il est repris à son retour. Un téléphone en économie d'énergie peut le refuser : l'activité continue, l'écran suit alors la veille normale.
- **Continuer écran éteint** (radio, et brossage si le verrou est refusé) : [`src/radio/`](src/radio/) décode les voix une fois, puis assemble questions, silences et réponses en **un seul son continu** de plusieurs minutes, joué par un unique lecteur audio. Le téléphone le traite comme une musique : rien ne dépend d'une minuterie, que la veille ralentit ou arrête. La radio enchaîne des morceaux d'environ 2 min 30, le suivant étant prêt avant la fin du précédent. Pause, lecture et arrêt sont proposés sur l'écran verrouillé (Media Session).

## 🔄 Mises à jour et version

- La version affichée en bas des écrans d'accueil est celle de `package.json` : la changer avec `npm version <x.y.z> --no-git-tag-version` avant de publier.
- Une application installée reste en mémoire des jours et ne recharge jamais sa page : le navigateur ne cherchait donc pas de nouvelle version. [`src/services/updateService.ts`](src/services/updateService.ts) la cherche à chaque retour au premier plan et toutes les 30 minutes. Une fois téléchargée, elle s'installe par un rechargement dès qu'aucune fenêtre n'est ouverte : jamais au milieu d'une séance, de la radio ou du brossage.

## 🧪 Tests et scénarios

Les règles (boîtes, jours de révision, cadeau, points) sont décrites dans [`docs/progression-et-recompenses.md`](docs/progression-et-recompenses.md). Ce document fait référence : on le modifie avant le code.

- **`make test`** vérifie chaque transition du graphe avec une horloge simulée, ainsi que l'assemblage des programmes d'écoute (3 minutes exactes de brossage, aucun calcul coupé) et le verrou d'écran.
- **`make scenarios`** joue les scénarios du dossier `scenarios/` : des élèves simulés (régulière, en difficulté, rapide, absente) enchaînent de vraies séances à travers le store et le moteur, jour après jour. Chaque scénario vérifie ses invariants (aucun cadeau avant le 21e jour, jamais plus d'une boîte par jour, aucun cadeau repris) et enregistre l'état du joueur aux moments clés dans `public/snapshots/`. La sortie est identique d'un lancement à l'autre : un diff dans `public/snapshots/` signale un changement de comportement.
- **Dans l'application**, créer un joueur nommé `@test-ci` : un bouton « Scénarios de test » apparaît sur son accueil et charge n'importe lequel de ces états dans son profil, recalé sur la date du jour. On teste ainsi « le jour du cadeau » ou « un décor sur le point d'être débloqué » sans attendre.

Pour ajouter un état : une entrée dans `scenarios/catalog.ts`, un appel `capture(world, "id")` dans un scénario, puis `make scenarios`.

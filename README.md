# Multiplications PWA - Entraînement Vocal Hors-Ligne

Application web progressive (PWA) d'apprentissage des tables de multiplication, spécialement conçue pour être installée et utilisée **100% hors-ligne sur Android**.

| Page | Adresse |
|---|---|
| Présentation | https://marcgardent.github.io/multiplication/ |
| Application | https://marcgardent.github.io/multiplication/app/ |
| Conditions générales d'utilisation | https://marcgardent.github.io/multiplication/conditions.html |
| Politique de confidentialité | https://marcgardent.github.io/multiplication/confidentialite.html |

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

5. **2 Modes d'Écoute** (écran « Qui va s'entraîner ? ») :
   - 📻 **Radio des tables** : question, temps de réflexion, réponse, sans fin. Elle continue écran éteint.
   - 🪥 **Brossage de dents** : « Début du brossage des dents », 3 minutes de calculs avec décompte à l'écran, puis une félicitation et « Fin du brossage des dents ». L'écran reste allumé.
   - Avant de lancer, onglet **Guidé** (on coche un ou plusieurs joueurs : l'écoute reprend ce qu'ils ont à revoir) ou **Manuel** (on coche des tables). Chaque mode retient sa dernière sélection.
   - Chaque calcul est repris 3, 6 puis 12 calculs plus tard (répétition espacée pendant l'écoute) ; l'écoute suivante commence par les calculs qui n'ont pas été entendus. Règles : [`docs/progression-et-recompenses.md`](docs/progression-et-recompenses.md#radio-et-brossage-de-dents).
   - Aucun point, aucune progression, même en mode guidé : écouter ne prouve pas que l'enfant sait.

6. **Voix enregistrées** (accueil, derrière le code parent) :
   - Félicitations et annonces, tableau des 100 multiplications, 42 réponses : chaque case ouvre une fenêtre où l'on **maintient** un bouton pour enregistrer, puis réécoute, recommence ou passe au suivant (file dans l'ordre 1, 10, 2, 5…).
   - Les blancs avant et après sont retirés et le volume réglé sur l'appareil ([`src/voices/`](src/voices/)). Une voix enregistrée remplace la voix de synthèse partout, radio et brossage compris.
   - Rangées dans IndexedDB ; avec la sauvegarde Drive, un fichier daté par voix, la plus récente l'emporte ([`docs/sauvegarde-et-fusion.md`](docs/sauvegarde-et-fusion.md)).

7. **Répondre à la voix** :
   - Avant chaque séance : 🤫 En silence (clavier, sans son), 🔊 Avec le son (clavier), 🎤 Je parle (réponse à voix haute). Icônes 🔊 et 🎤 en haut de l'écran pour changer à tout moment.
   - Reconnaissance sur l'appareil par [Vosk](https://alphacephei.com/vosk/) ([`vosk-browser`](https://github.com/ccoreilly/vosk-browser), Apache 2.0) : le micro est capté par un AudioWorklet, la reconnaissance tourne dans un Web Worker, limitée à une liste fermée (0 à 100, « passe », « réponse »…) ([`src/voices/speechListener.ts`](src/voices/speechListener.ts)). Modèle `vosk-model-small-fr-0.22` (42 Mo, Apache 2.0) servi depuis [`public/models/`](public/models/), gardé par Vosk dans IndexedDB, téléchargé quand un parent active la réponse à voix haute (désactivée par défaut), et tout seul sur les autres appareils où la sauvegarde l'a activée ([`src/voices/voiceModel.ts`](src/voices/voiceModel.ts)). Le nombre dit remplit la réponse, l'enfant confirme avec Valider ; le temps de réponse s'arrête au dernier mot prononcé ; le texte entendu devient un nombre, « passe » ou « réponse » ([`src/voices/speechGuess.ts`](src/voices/speechGuess.ts)). Règles : [`docs/progression-et-recompenses.md`](docs/progression-et-recompenses.md#répondre-à-la-voix).

8. **PWA Mobile-First pour Android** :
   - Pavé tactile virtuel ergonomique évitant les sursauts d'affichage du clavier virtuel Android.
   - Bouton in-app d'installation PWA (`beforeinstallprompt`).
   - Mode plein écran autonome (`display: standalone`).

---

## 🛠️ Commandes Disponibles (`Makefile`)

| Commande | Action |
|---|---|
| `make audio` | Génère les voix (questions, réponses, félicitations) dans `public/audio/` via `uv` ; seuls les fichiers absents ou dont la phrase a changé sont refaits |
| `make affiche` | Régénère l'affiche A4 à imprimer, `public/affiche-multiplication.pdf`, et son aperçu `.png` pour la page d'accueil, depuis [`scripts/affiche/affiche.html`](scripts/affiche/affiche.html) : QR code de l'adresse du site, impression par Chrome sans fenêtre, aperçu par `pdftoppm` (poppler-utils) |
| `make install` | Installe les dépendances npm |
| `make dev` | Démarre le serveur de développement Vite |
| `make build` | Compile TypeScript + SCSS + PWA pour la production (`dist/`) |
| `make preview` | Prévisualise le build de production localement |
| `make test` | Lance les tests des règles de progression : un test par flèche du graphe des boîtes |
| `make scenarios` | Fait jouer des élèves simulés sur plusieurs semaines et régénère `public/snapshots/` |

## 🌐 Site et application

Le site compte quatre pages, construites ensemble par Vite :

- [`index.html`](index.html), [`conditions.html`](conditions.html) et [`confidentialite.html`](confidentialite.html) sont des pages autonomes, en HTML simple : présentation, conditions d'utilisation, politique de confidentialité. Leur style est dans [`src/styles/site.scss`](src/styles/site.scss). Ce sont les adresses à déclarer dans l'écran de consentement Google.
- [`app/index.html`](app/index.html) est l'application installable. Son manifeste limite l'application à `app/` : les trois autres pages s'ouvrent hors de l'application.
- Une application installée quand elle vivait encore à la racine s'ouvre sur la présentation, qui la renvoie aussitôt vers `app/`.

**Toute modification de ce que l'application enregistre ou envoie doit être reportée dans `confidentialite.html`.**

### Espace parent

Sur l'écran des joueurs, l'entrée « Espace parent » regroupe ce qui ne regarde pas les enfants : la sauvegarde et la suppression d'un joueur. Le bouton ☁️ de l'en-tête y mène aussi.

- Il est protégé par un **code à 4 chiffres** choisi à la première entrée ([`src/components/parentGate.ts`](src/components/parentGate.ts)). Seule l'empreinte du code est enregistrée, sur l'appareil, hors de la sauvegarde. Trois codes faux bloquent le clavier 30 secondes.
- Code oublié : un calcul hors de portée d'un enfant, comme 47 × 68, permet d'en choisir un nouveau.
- Supprimer un joueur efface sa progression, ses points, ses cadeaux et ses décors, sur l'appareil puis dans la sauvegarde et sur les autres appareils. C'est définitif.

### Sauvegarde Google Drive

L'identifiant OAuth est dans [`src/services/googleDriveService.ts`](src/services/googleDriveService.ts) : l'utilisateur n'a rien à saisir. Cet identifiant est public par nature. Dans la console Google Cloud, il faut autoriser les origines JavaScript `https://marcgardent.github.io` et, pour le développement, `http://localhost:5173`. La seule autorisation demandée est `drive.appdata`, le dossier caché de l'application.

Une fois activée par le parent, la sauvegarde est automatique ([`src/services/cloudSyncService.ts`](src/services/cloudSyncService.ts)) :

- chaque écriture dans le stockage de l'application déclenche un envoi ; les écritures rapprochées sont regroupées (8 secondes après la dernière, 30 secondes au plus) ;
- une écriture qui ne change rien n'envoie rien ;
- hors ligne, l'envoi attend le retour du réseau ;
- quand un autre appareil a écrit entre-temps, les deux sauvegardes sont **fusionnées automatiquement** : points additionnés, joueurs réunis, état de chaque calcul pris sur l'appareil qui l'a travaillé en dernier. Les règles sont dans [`docs/sauvegarde-et-fusion.md`](docs/sauvegarde-et-fusion.md) et le code dans [`src/services/cloudMerge.ts`](src/services/cloudMerge.ts). Il n'y a pas de verrou : la fusion donne le même résultat quels que soient l'ordre et les répétitions ;
- le Drive est aussi consulté au lancement et à chaque retour au premier plan, pour faire apparaître les progrès faits sur un autre appareil. Une fusion n'est jamais appliquée pendant une séance ;
- le parent n'est sollicité (pastille orange) que si la sauvegarde a été remplacée volontairement depuis un autre appareil : import d'un fichier ou « Garder cet appareil » ;
- Google ne donne à une application web qu'un jeton d'une heure, à travers une fenêtre ouverte pendant un geste. Il est redemandé au premier toucher sur un écran calme : la fenêtre Google s'ouvre et se referme seule ([`src/services/googleAuthService.ts`](src/services/googleAuthService.ts)). Une sauvegarde sans aucune fenêtre demanderait un serveur.

## 📱 Veille du téléphone

Un téléphone met en veille une page que personne ne touche, ce qui coupait les séances d'écoute. Deux réponses, selon le besoin :

- **Garder l'écran allumé** (révision guidée, révision des tables, brossage de dents) : [`src/services/wakeLockService.ts`](src/services/wakeLockService.ts) demande un verrou d'écran (Screen Wake Lock) pendant l'activité et le rend à la fin. Le système le retire quand l'application passe en arrière-plan ; il est repris à son retour. Un téléphone en économie d'énergie peut le refuser : l'activité continue, l'écran suit alors la veille normale.
- **Continuer écran éteint** (radio, et brossage si le verrou est refusé) : [`src/radio/`](src/radio/) décode les voix une fois, puis assemble questions, silences et réponses en **un seul son continu** de plusieurs minutes, joué par un unique lecteur audio. Le téléphone le traite comme une musique : rien ne dépend d'une minuterie, que la veille ralentit ou arrête. La radio enchaîne des morceaux d'environ 2 min 30, le suivant étant prêt avant la fin du précédent. Pause, lecture et arrêt sont proposés sur l'écran verrouillé (Media Session).

## ◀️ Bouton retour du téléphone

Dans l'application installée, le bouton retour du téléphone fermait l'application, en pleine séance. [`src/services/backGuardService.ts`](src/services/backGuardService.ts) le neutralise : il ne fait plus rien. On quitte l'application par le bouton ou le geste d'accueil du téléphone. Ouverte dans un onglet du navigateur, l'application laisse le bouton retour tranquille.

## 🔄 Mises à jour et version

- La version affichée en bas des écrans d'accueil est celle de `package.json` : la changer avec `npm version <x.y.z> --no-git-tag-version` avant de publier.
- Une application installée reste en mémoire des jours et ne recharge jamais sa page : le navigateur ne cherchait donc pas de nouvelle version. [`src/services/updateService.ts`](src/services/updateService.ts) la cherche à chaque retour au premier plan et toutes les 30 minutes. Une fois téléchargée, elle s'installe par un rechargement dès qu'aucune fenêtre n'est ouverte : jamais au milieu d'une séance, de la radio ou du brossage.

## 🧪 Tests et scénarios

Les règles (boîtes, jours de révision, cadeau, points) sont décrites dans [`docs/progression-et-recompenses.md`](docs/progression-et-recompenses.md). Ce document fait référence : on le modifie avant le code.

- **`make test`** vérifie chaque transition du graphe avec une horloge simulée, ainsi que l'assemblage des programmes d'écoute (3 minutes exactes de brossage, aucun calcul coupé), le verrou d'écran, la sauvegarde automatique face à un faux Google (regroupement, hors ligne, jeton expiré) et la fusion : chaque règle, son indépendance à l'ordre sur 200 cas tirés au hasard, et deux appareils sur un faux Drive partagé.
- **`make scenarios`** joue les scénarios du dossier `scenarios/` : des élèves simulés (régulière, en difficulté, rapide, absente) enchaînent de vraies séances à travers le store et le moteur, jour après jour. Chaque scénario vérifie ses invariants (aucun cadeau avant le 21e jour, jamais plus d'une boîte par jour, aucun cadeau repris) et enregistre l'état du joueur aux moments clés dans `public/snapshots/`. La sortie est identique d'un lancement à l'autre : un diff dans `public/snapshots/` signale un changement de comportement.
- **Dans l'application**, créer un joueur nommé `@test-ci` : un bouton « Scénarios de test » apparaît sur son accueil et charge n'importe lequel de ces états dans son profil, recalé sur la date du jour. On teste ainsi « le jour du cadeau » ou « un décor sur le point d'être débloqué » sans attendre.

Pour ajouter un état : une entrée dans `scenarios/catalog.ts`, un appel `capture(world, "id")` dans un scénario, puis `make scenarios`.

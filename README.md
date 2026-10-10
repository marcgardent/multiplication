# Multiplications PWA - Entraînement Vocal Hors-Ligne

Application web progressive (PWA) d'apprentissage des tables de multiplication, spécialement conçue pour être installée et utilisée **100% hors-ligne sur Android**.

https://marcgardent.github.io/multiplication/

---

## 🚀 Fonctionnalités Clés

1. **Génération Audio TTS Français en Local (`uv` + `Makefile`)** :
   - Voix neuronale française Piper (`fr_FR-siwis-medium`), synthétisée sur la machine : aucun service en ligne, le modèle est téléchargé une fois dans `scripts/.voices/`.
   - 154 fichiers audios générés : 100 questions distinctes (`"2 fois 7"`, `"7 fois 2"`), 42 réponses uniques (`"14"`, etc.) et 12 félicitations.
   - Les félicitations sont la liste `CHEERS` de `scripts/generate_audio.py` : modifier la liste puis lancer `make audio`.
   - Tous les fichiers sont pré-cachés par le Service Worker Workbox pour un fonctionnement complet en mode avion.

2. **Matrice 10×10 avec Suivi Séparé & Statuts d'Apprentissage** :
   - **Dissociation stricte de la commutativité** : $2 \times 7$ et $7 \times 2$ ont leur propre suivi, historique d'erreurs et temps moyen de réponse.
   - **4 Statuts visuels** :
     - ⚪ **Inconnu** : non encore abordé.
     - 🔵 **Découverte** : en cours d'écoute ou introduit récemment.
     - 🟠 **Révision** : erreur commise ou temps de réponse lent.
     - 🟢 **Maîtrisé** : réussi consécutivement avec rapidité.
   - Fiche détaillée consultable au toucher pour chaque calcul.

3. **Algorithme de Répétition Espacée avec Régulation de Surcharge (*Backpressure*)** :
   - Pool actif borné à $N$ multiplications.
   - **Protection anti-surcharge** : si la file de révision est encombrée, aucune nouvelle opération n'est injectée. L'apprenant consolide ses erreurs avant de progresser.
   - Respect strict de la durée de session (**$N$ minutes** garanties).

4. **3 Modes Dédiés** :
   - 🎧 **Mode 1 : Découverte (Écoute Passive)** : Question vocale $\rightarrow$ pause de réflexion $\rightarrow$ réponse vocale avec affichage synchronisé.
   - 🎯 **Mode 2 : Quiz Sans Enjeu** : Entraînement bienveillant, possibilité de recommencer à l'infini ou de dévoiler la réponse vocale.
   - ⚡ **Mode 3 : Time-Attack** : Chronomètre haute précision (ms), mesure des réflexes et alimentation automatique des révisions.

5. **PWA Mobile-First pour Android** :
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

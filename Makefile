.PHONY: help audio affiche install dev build preview test scenarios clean

help:
	@echo "Commandes disponibles :"
	@echo "  make audio    - Générer les voix avec Piper (questions, réponses, félicitations) depuis scripts/generate_audio.py"
	@echo "  make affiche  - Régénérer l'affiche A4 (public/affiche-multiplication.pdf et .png) depuis scripts/affiche/affiche.html"
	@echo "  make install  - Installer les dépendances npm"
	@echo "  make dev      - Lancer le serveur Vite de développement"
	@echo "  make build    - Compiler l'application TypeScript + SCSS + PWA"
	@echo "  make preview  - Prévisualiser le build de production"
	@echo "  make test     - Lancer les tests des règles de progression"
	@echo "  make scenarios - Jouer les scénarios d'élèves sur plusieurs jours et régénérer public/snapshots"
	@echo "  make clean    - Nettoyer les fichiers générés (dist)"

audio:
	uv run scripts/generate_audio.py

affiche:
	uv run scripts/build_affiche.py

install:
	npm install

dev:
	npm run dev

build:
	npm run build

preview:
	npm run preview

test:
	npm test

scenarios:
	npm run scenarios

clean:
	rm -rf dist

.PHONY: help audio install dev build preview clean

help:
	@echo "Commandes disponibles :"
	@echo "  make audio    - Générer les voix avec Piper (questions, réponses, félicitations) depuis scripts/generate_audio.py"
	@echo "  make install  - Installer les dépendances npm"
	@echo "  make dev      - Lancer le serveur Vite de développement"
	@echo "  make build    - Compiler l'application TypeScript + SCSS + PWA"
	@echo "  make preview  - Prévisualiser le build de production"
	@echo "  make clean    - Nettoyer les fichiers générés (dist)"

audio:
	uv run scripts/generate_audio.py

install:
	npm install

dev:
	npm run dev

build:
	npm run build

preview:
	npm run preview

clean:
	rm -rf dist

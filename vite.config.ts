import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };

const base = process.env.GITHUB_ACTIONS ? "/multiplication/" : "/";

const page = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  base,
  define: {
    // Affichée sur l'accueil : permet de voir qu'une mise à jour est bien arrivée
    __APP_VERSION__: JSON.stringify(version)
  },
  build: {
    rollupOptions: {
      // Trois pages autonomes à la racine (présentation, conditions, confidentialité) et l'application dans app/
      input: {
        presentation: page("./index.html"),
        conditions: page("./conditions.html"),
        confidentialite: page("./confidentialite.html"),
        app: page("./app/index.html")
      }
    }
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      // L'enregistrement et les mises à jour sont gérés par src/services/updateService.ts
      injectRegister: false,
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "audio/*.mp3", "audio/index.json", "icons/*.svg"],
      manifest: {
        name: "Multiplications Faciles",
        lang: "fr",
        short_name: "Multiplication",
        description: "Apprentissage des tables de multiplication avec répétition espacée et TTS vocal hors-ligne",
        theme_color: "#ffffff",
        background_color: "#f4f5f8",
        display: "standalone",
        orientation: "portrait",
        // L'application vivait à la racine : garder cet identifiant fait suivre les installations existantes vers app/
        id: base,
        start_url: `${base}app/`,
        scope: `${base}app/`,
        icons: [
          {
            src: `${base}icons/icon-192.svg`,
            sizes: "192x192",
            type: "image/svg+xml",
            purpose: "any"
          },
          {
            src: `${base}icons/icon-512.svg`,
            sizes: "512x512",
            type: "image/svg+xml",
            purpose: "any maskable"
          }
        ]
      },
      workbox: {
        // La nouvelle version prend la main dès qu'elle est téléchargée ; la page se recharge quand l'écran est libre
        skipWaiting: true,
        clientsClaim: true,
        // Chaque page est servie pour elle-même : pas de repli vers une page unique
        navigateFallback: null,
        globPatterns: ["**/*.{js,css,html,svg,png,ico,mp3,json,woff2,webp}"],
        // Les snapshots de test se chargent à la demande : inutile de les mettre en cache hors-ligne
        // Le moteur de reconnaissance vocale (5,8 Mo) ne sert qu'à qui répond à voix haute : gardé au premier usage, pas à l'installation.
        // Son modèle (42 Mo) n'est pas mis en cache ici : Vosk le garde lui-même, décompressé, dans IndexedDB
        globIgnores: ["**/snapshots/**", "google*.html", "**/assets/vosk-*.js", "models/**"],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: /\/assets\/vosk-[^/]+\.js$/,
            handler: "CacheFirst",
            options: { cacheName: "reconnaissance-vocale", expiration: { maxEntries: 2 } }
          }
        ]
      }
    })
  ]
});

import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as { version: string };

const base = process.env.GITHUB_ACTIONS ? "/multiplication/" : "/";

export default defineConfig({
  base,
  define: {
    // Affichée sur l'accueil : permet de voir qu'une mise à jour est bien arrivée
    __APP_VERSION__: JSON.stringify(version)
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      // L'enregistrement et les mises à jour sont gérés par src/services/updateService.ts
      injectRegister: false,
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "audio/*.mp3", "audio/index.json", "icons/*.svg"],
      manifest: {
        name: "Multiplications Faciles",
        short_name: "Multiplication",
        description: "Apprentissage des tables de multiplication avec répétition espacée et TTS vocal hors-ligne",
        theme_color: "#ffffff",
        background_color: "#f4f5f8",
        display: "standalone",
        orientation: "portrait",
        start_url: base,
        scope: base,
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
        globPatterns: ["**/*.{js,css,html,svg,png,ico,mp3,json,woff2,webp}"],
        // Les snapshots de test se chargent à la demande : inutile de les mettre en cache hors-ligne
        globIgnores: ["**/snapshots/**"],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024
      }
    })
  ]
});

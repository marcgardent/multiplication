import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const base = process.env.GITHUB_ACTIONS ? "/multiplication/" : "/";

export default defineConfig({
  base,
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.ico", "apple-touch-icon.png", "audio/*.mp3", "audio/index.json", "icons/*.svg"],
      manifest: {
        name: "Multiplications Faciles",
        short_name: "Multiplication",
        description: "Apprentissage des tables de multiplication avec répétition espacée et TTS vocal hors-ligne",
        theme_color: "#4f46e5",
        background_color: "#0f172a",
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
        globPatterns: ["**/*.{js,css,html,svg,png,ico,mp3,json}"],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024
      }
    })
  ]
});

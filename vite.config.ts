import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { VitePWA } from "vite-plugin-pwa";

/** The address the game is served from. Used for the link-preview image, which must be an absolute URL.
 *  Set SITE_URL when the real domain is ready: `SITE_URL=https://zeni.example npm run deploy`. */
const SITE_URL = (process.env.SITE_URL ?? "https://zeni.oluwafemicodes.workers.dev").replace(/\/$/, "");

/** Short git commit, so feedback and crash reports can say which build someone was running. */
function buildId(): string {
  try {
    const hash = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const dirty = execSync("git status --porcelain", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() !== "";
    return dirty ? `${hash}+` : hash; // "+" means built from uncommitted changes
  } catch {
    return "dev";
  }
}

/** Fills %SITE_URL% in index.html. */
const siteUrl = (): Plugin => ({
  name: "zeni-site-url",
  transformIndexHtml: (html) => html.replaceAll("%SITE_URL%", SITE_URL),
});

export default defineConfig({
  define: { __BUILD__: JSON.stringify(buildId()) },
  plugins: [
    siteUrl(),
    cloudflare(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icons/apple-touch-icon.png"],
      manifest: {
        name: "Zeni",
        short_name: "Zeni",
        description: "Flick coins across a round table. Hit exactly one coin to keep it.",
        display: "standalone",
        orientation: "portrait",
        background_color: "#1c120b",
        theme_color: "#1c120b",
        start_url: "/",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Online features live under /api and /ws; never serve those from the app shell.
        navigateFallbackDenylist: [/^\/api\//, /^\/ws\//, /^\/privacy\.html$/],
        globPatterns: ["**/*.{js,css,html,svg,png,webp}"],
        // The link-preview picture is for chat apps and social sites, not for the installed game.
        globIgnores: ["og.png"],
      },
    }),
  ],
});

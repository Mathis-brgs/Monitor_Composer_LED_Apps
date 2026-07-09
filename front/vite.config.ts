import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import solid from "vite-plugin-solid";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Config vite WEB-only (sans Electron) — pour la vérif Playwright/navigateur.
 * `pnpm dev:web` → sert le renderer seul (le vrai build reste electron-vite).
 */
export default defineConfig({
  root: ".",
  plugins: [solid()],
  resolve: {
    alias: {
      "@": r("./src"),
      "@core": r("./src/core"),
      "@domain": r("./src/domain"),
      "@assets": r("./src/assets"),
      "@views": r("./src/views"),
      "@ui": r("./src/ui"),
      "@styles": r("./src/styles"),
    },
  },
});

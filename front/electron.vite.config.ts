import { defineConfig } from "electron-vite";
import { fileURLToPath, URL } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { main: r("./electron/main.ts") } },
    },
  },
  preload: {
    build: {
      rollupOptions: { input: { preload: r("./electron/preload.ts") } },
    },
  },
  renderer: {
    root: ".",
    resolve: {
      alias: {
        "@": r("./src"),
        "@core": r("./src/core"),
        "@domain": r("./src/domain"),
        "@assets": r("./src/assets"),
        "@views": r("./src/views"),
      },
    },
    build: {
      target: "esnext",
      rollupOptions: { input: r("./index.html") },
    },
  },
});

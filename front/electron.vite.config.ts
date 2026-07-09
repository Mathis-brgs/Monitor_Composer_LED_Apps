import { defineConfig } from "electron-vite";
import { fileURLToPath, URL } from "node:url";
import solid from "vite-plugin-solid";

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
    build: {
      target: "esnext",
      rollupOptions: { input: r("./index.html") },
    },
  },
});

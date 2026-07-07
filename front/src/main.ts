import { App } from "@core/app.ts";
import { Preview2DView } from "@views/preview2d/Preview2DView.ts";
import { ConfigPanel } from "@views/editor/ui/ConfigPanel.ts";

const canvas = document.getElementById("view");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("#view : canvas introuvable");
}

App.create(canvas)
  .then((app) => {
    // MVP : aperçu 2D monté. editor / compositor / preview3d sont des coquilles prêtes.
    app.mountView(new Preview2DView(), document.body);

    // Initialiser le panneau de configuration flottant
    new ConfigPanel(app);
  })
  .catch((err: unknown) => {
    console.error(err);
    document.body.innerHTML =
      `<pre style="color:#f66;padding:24px;font:14px/1.5 monospace">` +
      `WebGPU indisponible ou erreur d'init.\n\n${String(err)}</pre>`;
  });

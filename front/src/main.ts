import { App } from "@core/app.ts";
import { Preview2DView } from "@views/preview2d/Preview2DView.ts";

const canvas = document.getElementById("view");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("#view : canvas introuvable");
}

App.create(canvas)
  .then((app) => {
    // MVP : aperçu 2D monté. editor / compositor / preview3d sont des coquilles prêtes.
    app.mountView(new Preview2DView(), document.body);
  })
  .catch((err: unknown) => {
    console.error(err);
    document.body.innerHTML =
      `<pre style="color:#f66;padding:24px;font:14px/1.5 monospace">` +
      `WebGPU indisponible ou erreur d'init.\n\n${String(err)}</pre>`;
  });

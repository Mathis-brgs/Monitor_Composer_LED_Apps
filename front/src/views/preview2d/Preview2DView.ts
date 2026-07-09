import type { AppContext } from "@core/AppContext.ts";
import type { View } from "@views/View.ts";
import { Preview2DScene } from "./webgpu/Preview2DScene.ts";

/** Aperçu 2D : dessine la sortie du moteur (grille LED) à l'écran et gère l'extinction au clic. */
export class Preview2DView implements View {
  readonly id = "preview2d";
  private _ctx: AppContext | null = null;
  private _scene: Preview2DScene | null = null;
  private _canvas: HTMLCanvasElement | null = null;
  private _overlayCanvas: HTMLCanvasElement | null = null;

  mount(ctx: AppContext, host: HTMLElement): void {
    this._ctx = ctx;
    this._scene = new Preview2DScene(ctx.engine.texture);

    // Créer un canvas 2D superposé pour afficher les pixels éteints (blackouts)
    this._overlayCanvas = document.createElement("canvas");
    this._overlayCanvas.style.position = "absolute";
    this._overlayCanvas.style.top = "0";
    this._overlayCanvas.style.left = "0";
    this._overlayCanvas.style.width = "100%";
    this._overlayCanvas.style.height = "100%";
    this._overlayCanvas.style.pointerEvents = "none";
    this._overlayCanvas.style.zIndex = "10";
    host.appendChild(this._overlayCanvas);

    // Écouter le clic sur le canvas WebGL principal
    const canvas = document.getElementById("view");
    if (canvas instanceof HTMLCanvasElement) {
      this._canvas = canvas;
      canvas.addEventListener("click", this._onCanvasClick);
    }
  }

  unmount(): void {
    if (this._canvas) {
      this._canvas.removeEventListener("click", this._onCanvasClick);
      this._canvas = null;
    }
    if (this._overlayCanvas) {
      this._overlayCanvas.remove();
      this._overlayCanvas = null;
    }
    this._ctx = null;
    this._scene = null;
  }

  render(): void {
    if (this._ctx && this._scene) {
      this._scene.render(this._ctx.renderer);
    }
    this._renderOverlay();
  }

  private readonly _onCanvasClick = (e: MouseEvent) => {
    if (!this._ctx || !this._canvas) return;

    const rect = this._canvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width;
    const ny = 1 - (e.clientY - rect.top) / rect.height; // y=0 en bas en WebGL

    const x = Math.floor(nx * 128);
    const y = Math.floor(ny * 128);

    if (x >= 0 && x < 128 && y >= 0 && y < 128) {
      const entities = this._ctx.engine.fixture.entities;
      const entity = entities.find((ent) => ent.x === x && ent.y === y);
      if (entity) {
        const id = entity.ehubId;
        const config = this._ctx.project.config;
        if (!config.drawings) {
          config.drawings = {};
        }

        const cur = config.drawings[id];
        if (!cur) {
          config.drawings[id] = "red";
        } else if (cur === "red") {
          config.drawings[id] = "blue";
        } else if (cur === "blue") {
          config.drawings[id] = "green";
        } else if (cur === "green") {
          config.drawings[id] = "white";
        } else {
          delete config.drawings[id];
        }
        console.log(`Dessin entité ${id} à (${x}, ${y}) :`, config.drawings[id] ?? "black (off)");
      }
    }
  };

  private _renderOverlay(): void {
    if (!this._ctx || !this._canvas || !this._overlayCanvas) return;

    const w = this._canvas.clientWidth;
    const h = this._canvas.clientHeight;

    // Resizer l'overlay s'il y a eu un changement de taille de la fenêtre
    if (this._overlayCanvas.width !== w || this._overlayCanvas.height !== h) {
      this._overlayCanvas.width = w;
      this._overlayCanvas.height = h;
    }

    const ctx2d = this._overlayCanvas.getContext("2d");
    if (!ctx2d) return;

    ctx2d.clearRect(0, 0, w, h);

    const drawings = this._ctx.project.config.drawings;
    if (drawings) {
      const stepX = w / 128;
      const stepY = h / 128;
      ctx2d.lineWidth = 1;

      const entities = this._ctx.engine.fixture.entities;
      for (const [idStr, color] of Object.entries(drawings)) {
        const id = Number(idStr);
        const entity = entities.find((e) => e.ehubId === id);
        if (entity) {
          const sx = entity.x * stepX;
          const sy = (127 - entity.y) * stepY; // y=0 en bas en WebGL

          if (color === "red") {
            ctx2d.fillStyle = "#ff0000";
            ctx2d.strokeStyle = "#ff3333";
          } else if (color === "blue") {
            ctx2d.fillStyle = "#0000ff";
            ctx2d.strokeStyle = "#3333ff";
          } else if (color === "green") {
            ctx2d.fillStyle = "#00ff00";
            ctx2d.strokeStyle = "#33ff33";
          } else if (color === "white") {
            ctx2d.fillStyle = "#ffffff";
            ctx2d.strokeStyle = "#cccccc";
          } else {
            continue;
          }

          ctx2d.fillRect(sx, sy, stepX, stepY);
          ctx2d.strokeRect(sx, sy, stepX, stepY);
        }
      }
    }
  }
}

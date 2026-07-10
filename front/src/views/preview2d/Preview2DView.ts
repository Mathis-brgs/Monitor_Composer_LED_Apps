import type { AppContext } from "@core/AppContext.ts";
import type { View } from "@views/View.ts";
import { Preview2DScene } from "./webgpu/Preview2DScene.ts";

/** Aperçu 2D : dessine la sortie du moteur (grille LED) à l'écran. */
export class Preview2DView implements View {
  readonly id = "preview2d";
  private _ctx: AppContext | null = null;
  private _scene: Preview2DScene | null = null;

  mount(ctx: AppContext, _host: HTMLElement): void {
    this._ctx = ctx;
    this._scene = new Preview2DScene(ctx.engine.texture);
  }

  unmount(): void {
    this._ctx = null;
    this._scene = null;
  }

  render(): void {
    if (this._ctx && this._scene) {
      this._scene.render(this._ctx.renderer);
    }
  }
}

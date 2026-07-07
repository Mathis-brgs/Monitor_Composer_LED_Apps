import type { AppContext } from "@core/AppContext.ts";
import type { View } from "@views/View.ts";
import { Preview3DScene } from "./webgpu/Preview3DScene.ts";

/** Aperçu 3D de l'installation. Coquille — le rendu 3D reste à construire. */
export class Preview3DView implements View {
  readonly id = "preview3d";
  private _ctx: AppContext | null = null;
  private _scene: Preview3DScene | null = null;

  mount(ctx: AppContext, _host: HTMLElement): void {
    this._ctx = ctx;
    this._scene = new Preview3DScene();
  }

  unmount(): void {
    this._ctx = null;
    this._scene = null;
  }

  render(): void {
    if (this._ctx && this._scene) this._scene.render(this._ctx.renderer);
  }
}

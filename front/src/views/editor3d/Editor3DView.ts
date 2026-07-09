import type { AppContext } from "@core/AppContext.ts";
import type { View } from "@views/View.ts";
import { Editor3DScene } from "./webgpu/Editor3DScene.ts";
import { HudOverlay } from "./ui/HudOverlay.ts";
import { ToolbarOverlay } from "./ui/ToolbarOverlay.ts";

/** Éditeur 3D : mur LED en perspective, sélection par collision, gizmos + barre d'outils + HUD (overlays). */
export class Editor3DView implements View {
  readonly id = "editor3d";
  private _scene: Editor3DScene | null = null;
  private _hud: HudOverlay | null = null;
  private _toolbar: ToolbarOverlay | null = null;

  mount(ctx: AppContext, host: HTMLElement): void {
    this._scene = new Editor3DScene(ctx.renderer, ctx.editor, ctx.engine.texture);
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    this._toolbar = new ToolbarOverlay(host, ctx.editor);
    this._hud = new HudOverlay(host, ctx.editor, this._scene);
  }

  unmount(): void {
    this._toolbar?.dispose();
    this._toolbar = null;
    this._hud?.dispose();
    this._hud = null;
    this._scene?.dispose();
    this._scene = null;
  }

  render(): void {
    this._scene?.render();
    this._hud?.update();
  }
}

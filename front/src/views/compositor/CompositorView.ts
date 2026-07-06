import type { AppContext } from "@core/AppContext.ts";
import type { View } from "@views/View.ts";
import { CompositorPanel } from "./ui/CompositorPanel.ts";

/** Compositor : graphe de couches (arrange la pile du moteur). Coquille — features à venir. */
export class CompositorView implements View {
  readonly id = "compositor";
  private _panel: CompositorPanel | null = null;

  mount(ctx: AppContext, host: HTMLElement): void {
    this._panel = new CompositorPanel(ctx);
    host.appendChild(this._panel.element);
  }

  unmount(): void {
    this._panel?.element.remove();
    this._panel = null;
  }
}

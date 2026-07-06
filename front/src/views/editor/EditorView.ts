import type { AppContext } from "@core/AppContext.ts";
import type { View } from "@views/View.ts";
import { EditorPanel } from "./ui/EditorPanel.ts";

/** Éditeur : timeline, inspector, création d'objets. Coquille — features à venir. */
export class EditorView implements View {
  readonly id = "editor";
  private _panel: EditorPanel | null = null;

  mount(ctx: AppContext, host: HTMLElement): void {
    this._panel = new EditorPanel(ctx);
    host.appendChild(this._panel.element);
  }

  unmount(): void {
    this._panel?.element.remove();
    this._panel = null;
  }
}

import type { AppContext } from "@core/AppContext.ts";

/** UI de l'éditeur (timeline / inspector / création d'objets). Coquille. */
export class EditorPanel {
  readonly element: HTMLElement;

  constructor(_ctx: AppContext) {
    this.element = document.createElement("div");
    this.element.dataset.view = "editor";
    // TODO: timeline (ctx.project.composition), inspector, création d'objets
  }
}

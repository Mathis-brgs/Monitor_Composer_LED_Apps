import type { AppContext } from "@core/AppContext.ts";

/** UI du compositor (graphe de couches / nœuds). Coquille. */
export class CompositorPanel {
  readonly element: HTMLElement;

  constructor(_ctx: AppContext) {
    this.element = document.createElement("div");
    this.element.dataset.view = "compositor";
    // TODO: graphe de couches (empilement, blend, params)
  }
}

import type { AppContext } from "@core/AppContext.ts";

/** UI de l'éditeur 3D (rail gizmos / scène / inspecteur d'objet). Coquille. */
export class Editor3DPanel {
  readonly element: HTMLElement;

  constructor(_ctx: AppContext) {
    this.element = document.createElement("div");
    this.element.dataset.view = "editor3d";
    // TODO: gizmos, sélection par collision, inspecteur d'objet
  }
}

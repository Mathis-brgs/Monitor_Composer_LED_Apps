/** UI de l'aperçu 2D. Coquille — à étoffer (zoom, grille, sélection d'entités). */
export class Preview2DPanel {
  readonly element: HTMLElement;

  constructor() {
    this.element = document.createElement("div");
    this.element.dataset.view = "preview2d";
    // TODO: contrôles d'aperçu (zoom, toggle grille…)
  }
}

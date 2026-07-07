/** UI de l'aperçu 3D. Coquille — caméra, gizmos, sélection à venir. */
export class Preview3DPanel {
  readonly element: HTMLElement;

  constructor() {
    this.element = document.createElement("div");
    this.element.dataset.view = "preview3d";
    // TODO: contrôles de caméra / affichage
  }
}

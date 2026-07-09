import { createPanel, type Panel } from "../Panel.ts";

/** Viewport 3D : héberge le canvas moteur (rendu WebGPU). Structure seule. */
export class ViewportPanel implements Panel {
  readonly id = "viewport";
  readonly element: HTMLElement;

  constructor(canvas: HTMLCanvasElement) {
    const { element, body } = createPanel({ title: "Viewport 3D", modifier: "viewport" });
    body.appendChild(canvas);
    this.element = element;
  }
}

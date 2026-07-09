import { createPanel, type Panel } from "../Panel.ts";

/** Prévisualisation : header (bascule 2D/3D) + canvas moteur + overlays d'info. */
export class PreviewPanel implements Panel {
  readonly id = "preview";
  readonly element: HTMLElement;

  constructor(canvas: HTMLCanvasElement) {
    const { element, header, body } = createPanel({ title: "Prévisualisation", modifier: "preview" });

    if (header) {
      const toggle = document.createElement("div");
      toggle.className = "preview-toggle";
      const d2 = document.createElement("div");
      d2.className = "preview-toggle__opt preview-toggle__opt--active";
      d2.textContent = "2D";
      const d3 = document.createElement("div");
      d3.className = "preview-toggle__opt";
      d3.textContent = "3D";
      toggle.append(d2, d3);

      const spacer = document.createElement("div");
      spacer.className = "panel__header-spacer";

      header.append(toggle, spacer, meta("Ajuster 100%"), meta("▪ Grille 128×128"));
    }

    body.classList.add("preview");
    body.appendChild(canvas);
    body.append(
      overlay("preview__ov--tl", "Res 128 × 128", "16 384 px · RGBW"),
      overlay("preview__ov--tr", "40.0 FPS", "WebGPU"),
      overlay("preview__ov--bl", "eHuB · Groupe 0–3"),
      overlay("preview__ov--br", "Face · 2D"),
    );

    this.element = element;
  }
}

function meta(text: string): HTMLElement {
  const el = document.createElement("span");
  el.className = "preview__meta";
  el.textContent = text;
  return el;
}

function overlay(pos: string, ...lines: string[]): HTMLElement {
  const el = document.createElement("div");
  el.className = `preview__ov ${pos}`;
  for (const line of lines) {
    const l = document.createElement("div");
    l.textContent = line;
    el.appendChild(l);
  }
  return el;
}

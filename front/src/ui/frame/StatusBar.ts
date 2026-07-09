import type { ProjectConfig } from "@domain/ProjectConfig.ts";

/** Barre de statut. Items statiques ; la cible réseau est lue depuis la config eHuB. */
export class StatusBar {
  readonly element: HTMLElement;

  constructor(config: ProjectConfig) {
    this.element = document.createElement("div");
    this.element.className = "status-bar";

    const net = `→ ${config.ehub.host}:${config.ehub.port} · UDP · eHuB · 40 Hz`;

    const spacer = document.createElement("div");
    spacer.className = "status-bar__spacer";

    this.element.append(
      item("0 objets · 0 helpers"),
      item("Gizmo : déplacer"),
      item("LED sélectionnées : 0"),
      spacer,
      item(net, "status-net"),
    );
  }
}

function item(text: string, extra?: string): HTMLElement {
  const el = document.createElement("span");
  el.className = extra ? `status-item ${extra}` : "status-item";
  el.textContent = text;
  return el;
}

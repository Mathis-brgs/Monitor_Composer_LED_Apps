import type { ProjectConfig } from "@domain/ProjectConfig.ts";

const MENUS = ["Fichier", "Édition", "Composition", "Objet", "Scène", "Affichage"] as const;

/** Barre d'application : wordmark LED + menus (statiques) + nom du projet. */
export class MenuBar {
  readonly element: HTMLElement;

  constructor(config: ProjectConfig) {
    this.element = document.createElement("div");
    this.element.className = "menu-bar";
    this.element.append(this._wordmark(), this._menus(), spacer("menu-bar__spacer"), this._project(config.name));
  }

  private _wordmark(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "wordmark";

    const dots = document.createElement("div");
    dots.className = "wordmark__dots";
    for (let i = 0; i < 4; i++) {
      const cell = document.createElement("i");
      // seules les cellules en diagonale sont allumées (cf. proto)
      cell.className = i === 0 || i === 3 ? "wordmark__cell wordmark__cell--on" : "wordmark__cell";
      dots.appendChild(cell);
    }

    const text = document.createElement("span");
    text.className = "wordmark__text";
    text.textContent = "LED";

    wrap.append(dots, text);
    return wrap;
  }

  private _menus(): HTMLElement {
    const nav = document.createElement("nav");
    nav.className = "menu-bar__menus";
    for (const label of MENUS) {
      const item = document.createElement("span");
      item.className = "menu-item";
      item.textContent = label;
      nav.appendChild(item);
    }
    return nav;
  }

  private _project(name: string): HTMLElement {
    const el = document.createElement("span");
    el.className = "menu-bar__project";
    const nameEl = document.createElement("span");
    nameEl.className = "menu-bar__project-name";
    nameEl.textContent = name;
    el.appendChild(nameEl);
    return el;
  }
}

function spacer(className: string): HTMLElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

import type { Editor, EditorTool } from "@core/Editor.ts";
import type { ShapeKind } from "@domain/Layer.ts";
import { createIcon } from "@ui/icons/Icon.ts";

const TOOLS: ReadonlyArray<{ icon: string; tool: EditorTool; title: string }> = [
  { icon: "cursor", tool: "select", title: "Sélection (Échap)" },
  { icon: "move", tool: "translate", title: "Déplacer (G)" },
  { icon: "rotate", tool: "rotate", title: "Tourner (R)" },
  { icon: "scale", tool: "scale", title: "Échelle (S)" },
];

const SHAPES: ReadonlyArray<{ icon: string; kind: ShapeKind; title: string }> = [
  { icon: "sphere", kind: "sphere", title: "Sphère" },
  { icon: "box", kind: "box", title: "Cube" },
  { icon: "cylinder", kind: "cylinder", title: "Cylindre" },
  { icon: "cone", kind: "cone", title: "Cône" },
  { icon: "plane", kind: "plane", title: "Plan" },
  { icon: "torus", kind: "torus", title: "Tore" },
];

/**
 * Barre d'outils flottante DANS le viewport 3D (overlay) : outils de manipulation
 * (curseur + gizmos) + création de primitives. Bascule d'affichage au clavier (T).
 */
export class ToolbarOverlay {
  private readonly _root: HTMLElement;
  private readonly _unsub: () => void;
  private readonly _onKey: (e: KeyboardEvent) => void;
  private _visible = true;

  constructor(host: HTMLElement, editor: Editor) {
    this._root = document.createElement("div");
    this._root.className = "viewport-toolbar";

    const toolButtons = TOOLS.map((t) => {
      const btn = toolButton(t.icon, t.title);
      btn.addEventListener("click", () => editor.setTool(t.tool));
      this._root.appendChild(btn);
      return { btn, tool: t.tool };
    });

    this._root.appendChild(divider());

    for (const shape of SHAPES) {
      const btn = toolButton(shape.icon, shape.title);
      btn.addEventListener("click", () => editor.addShape(shape.kind));
      this._root.appendChild(btn);
    }

    host.appendChild(this._root);

    const sync = (): void => {
      for (const { btn, tool } of toolButtons) btn.classList.toggle("rail__tool--active", editor.tool === tool);
    };
    sync();
    this._unsub = editor.subscribe(sync);

    // T = masquer / révéler la barre d'outils (ignore la saisie dans un champ).
    this._onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "t" || e.key === "T") this._toggle();
    };
    window.addEventListener("keydown", this._onKey);
  }

  dispose(): void {
    this._unsub();
    window.removeEventListener("keydown", this._onKey);
    this._root.remove();
  }

  private _toggle(): void {
    this._visible = !this._visible;
    this._root.classList.toggle("viewport-toolbar--hidden", !this._visible);
  }
}

function toolButton(icon: string, title: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rail__tool";
  btn.title = title;
  btn.appendChild(createIcon(icon, { size: 16 }));
  return btn;
}

function divider(): HTMLElement {
  const d = document.createElement("div");
  d.className = "rail__divider";
  return d;
}

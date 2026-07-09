import { Quaternion, Vector3 } from "three/webgpu";
import type { Editor } from "@core/Editor.ts";
import type { Editor3DScene, OrientAxis } from "../webgpu/Editor3DScene.ts";

const SVG_NS = "http://www.w3.org/2000/svg";
const GIZMO = 52;      // taille du gizmo d'orientation (px)
const GC = GIZMO / 2;  // centre
const GR = 17;         // longueur d'axe

interface AxisSpec { key: OrientAxis; vec: [number, number, number]; color: string; label?: string; }

const AXES: readonly AxisSpec[] = [
  { key: "x", vec: [1, 0, 0], color: "var(--axis-x)", label: "X" },
  { key: "y", vec: [0, 1, 0], color: "var(--axis-y)", label: "Y" },
  { key: "z", vec: [0, 0, 1], color: "var(--axis-z)", label: "Z" },
  { key: "-x", vec: [-1, 0, 0], color: "var(--axis-x)" },
  { key: "-y", vec: [0, -1, 0], color: "var(--axis-y)" },
  { key: "-z", vec: [0, 0, -1], color: "var(--axis-z)" },
];

interface AxisEls { spec: AxisSpec; dot: SVGCircleElement; line?: SVGLineElement; text?: SVGTextElement; }

/**
 * HUD du viewport 3D (overlay DOM, non bloquant) : repères de coins, libellés d'état,
 * compteur de LEDs sélectionnées (temps réel) et gizmo d'orientation cliquable (snap de vue).
 * D'après la maquette Figma (frame 60:502).
 */
export class HudOverlay {
  private readonly _root: HTMLElement;
  private readonly _scene: Editor3DScene;
  private readonly _countEl: HTMLElement;
  private readonly _camInfoEl: HTMLElement;
  private readonly _axes: AxisEls[] = [];
  private readonly _unsub: () => void;
  private readonly _inv = new Quaternion();
  private readonly _v = new Vector3();

  constructor(host: HTMLElement, editor: Editor, scene: Editor3DScene) {
    this._scene = scene;

    this._root = el("div", "hud");

    for (const pos of ["tl", "tr", "bl", "br"] as const) {
      this._root.appendChild(el("span", `hud__corner hud__corner--${pos}`));
    }

    const tl = el("div", "hud__block hud__block--tl");
    tl.append(text("div", "hud__title", "128 × 128"), text("div", "hud__sub", "SÉLECTION PAR COLLISION"));

    const tr = el("div", "hud__block hud__block--tr");
    this._countEl = text("div", "hud__count", "0");
    tr.append(text("div", "hud__sub", "LED SÉLECTIONNÉES"), this._countEl);

    this._camInfoEl = text("div", "hud__block hud__block--br", "PERSPECTIVE · 50 MM");

    this._root.append(tl, tr, this._camInfoEl, this._buildGizmo());
    host.appendChild(this._root);

    const refresh = (): void => this._refreshCount(editor);
    refresh();
    this._unsub = editor.subscribe(refresh);
  }

  /** appelé chaque frame : oriente le gizmo selon la caméra + focale live. */
  update(): void {
    const cam = this._scene.camera;
    this._inv.copy(cam.quaternion).invert();
    for (const a of this._axes) {
      this._v.set(a.spec.vec[0], a.spec.vec[1], a.spec.vec[2]).applyQuaternion(this._inv);
      const sx = GC + this._v.x * GR;
      const sy = GC - this._v.y * GR;
      const front = this._v.z >= 0;
      a.dot.setAttribute("cx", sx.toFixed(2));
      a.dot.setAttribute("cy", sy.toFixed(2));
      a.dot.style.opacity = front ? "1" : "0.4";
      if (a.line) { a.line.setAttribute("x2", sx.toFixed(2)); a.line.setAttribute("y2", sy.toFixed(2)); a.line.style.opacity = front ? "0.9" : "0.3"; }
      if (a.text) { a.text.setAttribute("x", sx.toFixed(2)); a.text.setAttribute("y", (sy + 0.5).toFixed(2)); a.text.style.opacity = front ? "1" : "0"; }
    }
    const focal = 36 / (2 * Math.tan((cam.fov * Math.PI) / 360));
    this._camInfoEl.textContent = `PERSPECTIVE · ${Math.round(focal)} MM`;
  }

  dispose(): void {
    this._unsub();
    this._root.remove();
  }

  // ————————————————————————————————— Interne —————————————————————————————————

  private _refreshCount(editor: Editor): void {
    this._countEl.textContent = editor.selectedLedCount().toLocaleString("fr-FR");
  }

  private _buildGizmo(): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "hud__gizmo");
    svg.setAttribute("viewBox", `0 0 ${GIZMO} ${GIZMO}`);
    // axes négatifs d'abord (dessous), puis positifs (au-dessus, avec label)
    for (const spec of [...AXES].sort((a, b) => (a.label ? 1 : 0) - (b.label ? 1 : 0))) {
      const els: AxisEls = { spec, dot: circle(spec.label ? 6 : 3.5, spec.color, !!spec.label) };
      if (spec.label) {
        els.line = line(spec.color);
        els.text = label(spec.label);
        svg.append(els.line, els.dot, els.text);
      } else {
        svg.appendChild(els.dot);
      }
      const snap = (): void => this._scene.snapView(spec.key);
      els.dot.addEventListener("pointerdown", (e) => { e.stopPropagation(); snap(); });
      this._axes.push(els);
    }
    return svg;
  }
}

// ————————————————————————————————— Helpers DOM —————————————————————————————————

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function text(tag: string, className: string, content: string): HTMLElement {
  const node = el(tag, className);
  node.textContent = content;
  return node;
}

function circle(r: number, color: string, filled: boolean): SVGCircleElement {
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("r", String(r));
  c.setAttribute("cx", String(GC));
  c.setAttribute("cy", String(GC));
  if (filled) {
    c.setAttribute("fill", color);
  } else {
    c.setAttribute("fill", "none");
    c.setAttribute("stroke", color);
    c.setAttribute("stroke-width", "1.4");
  }
  c.style.cursor = "pointer";
  return c;
}

function line(color: string): SVGLineElement {
  const l = document.createElementNS(SVG_NS, "line");
  l.setAttribute("x1", String(GC));
  l.setAttribute("y1", String(GC));
  l.setAttribute("stroke", color);
  l.setAttribute("stroke-width", "1.6");
  l.setAttribute("stroke-linecap", "round");
  return l;
}

function label(t: string): SVGTextElement {
  const el = document.createElementNS(SVG_NS, "text");
  el.textContent = t;
  el.setAttribute("text-anchor", "middle");
  el.setAttribute("dominant-baseline", "middle");
  el.setAttribute("class", "hud__gizmo-label");
  return el;
}

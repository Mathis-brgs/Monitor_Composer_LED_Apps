import type { Clock } from "@core/Clock.ts";
import type { Editor } from "@core/Editor.ts";
import type { AudioEngine } from "@core/AudioEngine.ts";
import type { Panel, PanelContext } from "./Panel.ts";
import {
  type LayoutNode,
  type LeafNode,
  type PanelId,
  type SplitChild,
  type SplitNode,
} from "./layouts.ts";
import { SPACE_LAYOUTS, type SpaceId } from "./spaces.ts";
import { createOutlinerPanel } from "./panels/OutlinerPanel.tsx";
import { ViewportPanel } from "./panels/ViewportPanel.ts";
import { PreviewPanel } from "./panels/PreviewPanel.ts";
import { createInspectorPanel } from "./panels/InspectorPanel.tsx";
import { createTimelinePanel } from "./panels/TimelinePanel.tsx";

const PANEL_FACTORIES: Record<PanelId, (ctx: PanelContext) => Panel> = {
  outliner: (ctx) => createOutlinerPanel(ctx.editor),
  viewport: (ctx) => new ViewportPanel(ctx.canvas),
  preview: (ctx) => new PreviewPanel(ctx.canvas),
  inspector: (ctx) => createInspectorPanel(ctx.editor),
  timeline: (ctx) => createTimelinePanel(ctx.clock, ctx.editor, ctx.audio),
};

const STORAGE_PREFIX = "led.layout.";
const MIN_PX = 96;

/**
 * Rend un arbre d'agencement (splits redimensionnables → panneaux) et gère les
 * interactions : glisser un gutter pour resize, glisser un en-tête pour permuter.
 * Le canvas moteur est partagé et réattaché à chaque rendu (jamais recréé).
 * L'agencement de chaque espace est persistant (localStorage).
 */
export class Workspace {
  readonly element: HTMLElement;
  private readonly _canvas: HTMLCanvasElement;
  private readonly _clock: Clock;
  private readonly _editor: Editor;
  private readonly _audio: AudioEngine;
  private _spaceId: SpaceId | null = null;
  private _tree: LayoutNode | null = null;
  private _panels: Panel[] = [];
  private _dropEl: HTMLElement | null = null;

  constructor(canvas: HTMLCanvasElement, clock: Clock, editor: Editor, audio: AudioEngine) {
    this._canvas = canvas;
    this._clock = clock;
    this._editor = editor;
    this._audio = audio;
    this.element = document.createElement("div");
    this.element.className = "workspace";
    this._initDragToRearrange();
  }

  /** Bascule sur l'espace donné : charge son agencement sauvegardé, sinon clone le modèle. */
  setSpace(spaceId: SpaceId): void {
    if (spaceId === this._spaceId) return;
    this._spaceId = spaceId;
    this._tree = this._load(spaceId) ?? clone(SPACE_LAYOUTS[spaceId]);
    this._render();
  }

  // ————————————————————————————————— Rendu —————————————————————————————————

  private _render(): void {
    if (!this._tree) return;
    this._disposePanels(); // libère les panneaux (racines Solid + abonnements) avant de recréer
    const root = this._renderNode(this._tree);
    root.style.flex = "1";
    root.style.minWidth = "0";
    root.style.minHeight = "0";
    this.element.replaceChildren(root);
  }

  private _disposePanels(): void {
    for (const panel of this._panels) panel.unmount?.();
    this._panels = [];
  }

  private _renderNode(node: LayoutNode): HTMLElement {
    return node.type === "leaf" ? this._renderLeaf(node.panel) : this._renderSplit(node);
  }

  private _renderLeaf(panelId: PanelId): HTMLElement {
    const panel = PANEL_FACTORIES[panelId]({ canvas: this._canvas, clock: this._clock, editor: this._editor, audio: this._audio });
    panel.element.dataset.panel = panel.id;
    this._panels.push(panel);
    return panel.element;
  }

  private _renderSplit(node: SplitNode): HTMLElement {
    const el = document.createElement("div");
    el.className = `split split--${node.dir}`;
    const childEls = node.children.map((child) => {
      const cEl = this._renderNode(child.node);
      applyFlex(cEl, child);
      return cEl;
    });
    node.children.forEach((_child, i) => {
      if (i > 0) el.appendChild(this._gutter(node, i, childEls));
      el.appendChild(childEls[i]);
    });
    return el;
  }

  // ————————————————————————————— Resize (gutter) —————————————————————————————

  private _gutter(node: SplitNode, i: number, childEls: HTMLElement[]): HTMLElement {
    const g = document.createElement("div");
    g.className = `gutter gutter--${node.dir === "row" ? "v" : "h"}`;
    const resizable = node.children[i - 1].fixed === undefined && node.children[i].fixed === undefined;
    if (!resizable) {
      g.classList.add("gutter--static");
      return g;
    }
    g.addEventListener("pointerdown", (e) => this._startResize(e, g, node, i, childEls));
    return g;
  }

  private _startResize(
    e: PointerEvent,
    gutter: HTMLElement,
    node: SplitNode,
    i: number,
    childEls: HTMLElement[],
  ): void {
    e.preventDefault();
    const horizontal = node.dir === "row";
    const prev = node.children[i - 1];
    const next = node.children[i];
    const prevEl = childEls[i - 1];
    const nextEl = childEls[i];
    const startPos = horizontal ? e.clientX : e.clientY;
    const prevPx0 = measure(prevEl, horizontal);
    const nextPx0 = measure(nextEl, horizontal);
    const pxSum = prevPx0 + nextPx0;
    const weightSum = prev.size + next.size;

    gutter.setPointerCapture(e.pointerId);
    gutter.classList.add("gutter--active");

    const move = (ev: PointerEvent): void => {
      const delta = (horizontal ? ev.clientX : ev.clientY) - startPos;
      const prevPx = clamp(prevPx0 + delta, MIN_PX, pxSum - MIN_PX);
      const frac = prevPx / pxSum;
      prev.size = weightSum * frac;
      next.size = weightSum * (1 - frac);
      prevEl.style.flexGrow = String(prev.size);
      nextEl.style.flexGrow = String(next.size);
    };
    const up = (ev: PointerEvent): void => {
      gutter.releasePointerCapture(ev.pointerId);
      gutter.classList.remove("gutter--active");
      gutter.removeEventListener("pointermove", move);
      gutter.removeEventListener("pointerup", up);
      this._persist();
    };
    gutter.addEventListener("pointermove", move);
    gutter.addEventListener("pointerup", up);
  }

  // ———————————————————————— Permutation (drag & drop) ————————————————————————

  private _initDragToRearrange(): void {
    let dragged: PanelId | null = null;

    this.element.addEventListener("dragstart", (e) => {
      const header = (e.target as HTMLElement).closest<HTMLElement>(".panel__header");
      const id = header?.closest<HTMLElement>(".panel")?.dataset.panel as PanelId | undefined;
      if (!id) return;
      dragged = id;
      e.dataTransfer?.setData("text/plain", id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });

    this.element.addEventListener("dragover", (e) => {
      const target = dropTarget(e);
      if (!dragged || !target || target === dragged) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      this._highlight(target);
    });

    this.element.addEventListener("drop", (e) => {
      const target = dropTarget(e);
      if (dragged && target && target !== dragged) {
        e.preventDefault();
        this._swap(dragged, target);
      }
      dragged = null;
      this._clearHighlight();
    });

    this.element.addEventListener("dragend", () => {
      dragged = null;
      this._clearHighlight();
    });
  }

  private _swap(a: PanelId, b: PanelId): void {
    if (!this._tree) return;
    const leaves: LeafNode[] = [];
    collectLeaves(this._tree, leaves);
    const la = leaves.find((l) => l.panel === a);
    const lb = leaves.find((l) => l.panel === b);
    if (!la || !lb) return;
    la.panel = b;
    lb.panel = a;
    this._render();
    this._persist();
  }

  private _highlight(id: PanelId): void {
    const el = this.element.querySelector<HTMLElement>(`.panel[data-panel="${id}"]`);
    if (el === this._dropEl) return;
    this._clearHighlight();
    this._dropEl = el;
    el?.classList.add("panel--drop");
  }

  private _clearHighlight(): void {
    this._dropEl?.classList.remove("panel--drop");
    this._dropEl = null;
  }

  // ————————————————————————————— Persistance —————————————————————————————

  private _persist(): void {
    if (!this._spaceId || !this._tree) return;
    try {
      localStorage.setItem(STORAGE_PREFIX + this._spaceId, JSON.stringify(this._tree));
    } catch {
      // stockage indisponible : on ignore (l'agencement reste en mémoire)
    }
  }

  private _load(spaceId: SpaceId): LayoutNode | null {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + spaceId);
      if (!raw) return null;
      const tree = JSON.parse(raw) as LayoutNode;
      return sameLeafSet(tree, SPACE_LAYOUTS[spaceId]) ? tree : null;
    } catch {
      return null;
    }
  }
}

// ————————————————————————————————— Helpers —————————————————————————————————

function applyFlex(el: HTMLElement, child: SplitChild): void {
  if (child.fixed !== undefined) {
    el.style.flex = `0 0 ${child.fixed}px`;
  } else {
    el.style.flexGrow = String(child.size);
    el.style.flexShrink = "1";
    el.style.flexBasis = "0";
  }
  el.style.minWidth = "0";
  el.style.minHeight = "0";
}

function measure(el: HTMLElement, horizontal: boolean): number {
  const rect = el.getBoundingClientRect();
  return horizontal ? rect.width : rect.height;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

function dropTarget(e: DragEvent): PanelId | null {
  const id = (e.target as HTMLElement).closest<HTMLElement>(".panel")?.dataset.panel as
    | PanelId
    | undefined;
  return id ?? null;
}

function collectLeaves(node: LayoutNode, out: LeafNode[]): void {
  if (node.type === "leaf") out.push(node);
  else if (node.type === "split") for (const child of node.children) collectLeaves(child.node, out);
}

function clone(node: LayoutNode): LayoutNode {
  return JSON.parse(JSON.stringify(node)) as LayoutNode;
}

/** Vrai si l'agencement sauvegardé a exactement le même jeu de panneaux que le modèle courant. */
function sameLeafSet(saved: LayoutNode, model: LayoutNode): boolean {
  let a: Set<PanelId>;
  try {
    a = leafPanels(saved);
  } catch {
    return false;
  }
  const b = leafPanels(model);
  if (a.size !== b.size) return false;
  for (const id of b) if (!a.has(id)) return false;
  return true;
}

function leafPanels(node: LayoutNode): Set<PanelId> {
  const leaves: LeafNode[] = [];
  collectLeaves(node, leaves);
  return new Set(leaves.map((l) => l.panel));
}

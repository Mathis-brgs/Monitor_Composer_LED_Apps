import type { Engine } from "./engine/Engine.ts";
import {
  makeGroup, makeShape, makeShaderLayer, findLayer, findGroup, findParent, groupChildren,
  type Document, type Layer, type GroupLayer, type ShapeLayer, type ShaderLayer,
  type RGB, type Vec3, type ShapeKind, type ShaderId, type BlendMode,
} from "@domain/Layer.ts";

/** Patch de transform : chaque canal (position/rotation/échelle) partiellement modifiable. */
export interface TransformPatch { position?: Partial<Vec3>; rotation?: Partial<Vec3>; scale?: Partial<Vec3>; }

/** Outil actif de l'éditeur 3D : curseur de sélection ou l'un des trois modes de gizmo. */
export type EditorTool = "select" | "translate" | "rotate" | "scale";
import { createLayer } from "./engine/layers/index.ts";
import type { Layer as EngineLayer } from "./engine/layers/Layer.ts";
import { Scene3DLayer } from "./engine/layers/Scene3D.layer.ts";
import { SolidLayer } from "./engine/layers/Solid.layer.ts";
import { countLit, type ShapeInput } from "./engine/shapes.ts";

export type EditorListener = () => void;

/** Libellé par défaut d'une primitive créée depuis le rail. */
const SHAPE_LABEL: Record<ShapeKind, string> = {
  sphere: "Sphère", box: "Cube", cylinder: "Cylindre", cone: "Cône", plane: "Plan", torus: "Tore",
};

/** Document seed : reprend les 3 calques shader + 2 objets 3D de l'état d'origine. */
function seedDocument(): Document {
  const root = makeGroup("root", "Composition");

  const sweep = makeShaderLayer("sweep-1", "sweep", "Balayage");
  sweep.blend = "add";
  sweep.opacity = 0.8;

  const plasma = makeShaderLayer("plasma-1", "plasma", "Plasma");
  plasma.params = { speed: 0.42, detail: 0.7, contrast: 0.55, hue: 0.57 };

  const solid = makeShaderLayer("solid-1", "solid", "Couleur unie");
  solid.color = { r: 0.11, g: 0.055, b: 0.024 }; // #1c0e06

  const sphere = makeShape("sphere-1", "sphere", "Sphère 01");
  sphere.transform = { position: { x: -0.28, y: 0.12, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.34, y: 0.34, z: 0.34 } };
  sphere.color = { r: 1, g: 0.541, b: 0.239 };

  const box = makeShape("box-1", "box", "Cube 01");
  box.transform = { position: { x: 0.42, y: -0.14, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.26, y: 0.26, z: 0.26 } };
  box.color = { r: 1, g: 0.541, b: 0.239 };

  root.children.push(sweep, plasma, solid, sphere, box);
  return { root, activeGroupId: "root", selectedId: "plasma-1" };
}

/**
 * Store du document (arbre unifié) + miroir moteur. L'app le modifie ; le moteur en
 * est le reflet (uniforms + reconstruction de la pile du groupe actif). `core` agnostique
 * de l'UI ; convention subscribe/notify (compatible pont Solid `fromStore`).
 */
export class Editor {
  private _doc = seedDocument();
  private readonly _listeners = new Set<EditorListener>();
  private readonly _shaderLive = new Map<string, EngineLayer>();
  private _scene3d: Scene3DLayer | null = null;
  private _engine: Engine | null = null;
  private _counter = 0;
  private _tool: EditorTool = "select";

  // ————————————————————————————————— Lecture —————————————————————————————————

  get rootId(): string { return this._doc.root.id; }
  get activeGroupId(): string { return this._doc.activeGroupId; }
  get selectedId(): string | null { return this._doc.selectedId; }
  get tool(): EditorTool { return this._tool; }

  /** enfants du groupe actif (ce qu'affichent Compositor/Scène/Editor 3D). */
  get children(): readonly Layer[] { return groupChildren(this._doc, this._doc.activeGroupId); }

  /** nœud sélectionné (n'importe où dans l'arbre). */
  get selected(): Layer | null {
    return this._doc.selectedId ? findLayer(this._doc.root, this._doc.selectedId) : null;
  }

  getDocument(): Document {
    return this._doc;
  }

  loadDocument(doc: Document): void {
    this._doc = doc;
    this._push();
    this._emit();
  }

  // ————————————————————————————————— Moteur ——————————————————————————————————

  /** Branche le moteur : crée le calque scène3d + pousse la pile du groupe actif. */
  attach(engine: Engine): void {
    this._engine = engine;
    this._scene3d = new Scene3DLayer("scene3d");
    this._push();
  }

  // —————————————————————————————— Navigation ——————————————————————————————

  select(id: string | null): void {
    if (id === this._doc.selectedId) return;
    this._doc.selectedId = id;
    this._emit();
  }

  /** Outil actif (curseur / gizmo). Partagé par le rail et l'éditeur 3D. */
  setTool(tool: EditorTool): void {
    if (tool === this._tool) return;
    this._tool = tool;
    this._emit();
  }

  enterGroup(id: string): void {
    if (!findGroup(this._doc.root, id)) return;
    this._doc.activeGroupId = id;
    this._doc.selectedId = null;
    this._push();
    this._emit();
  }

  exitGroup(): void {
    const parent = findParent(this._doc.root, this._doc.activeGroupId);
    if (!parent) return;
    this._doc.activeGroupId = parent.id;
    this._doc.selectedId = null;
    this._push();
    this._emit();
  }

  // ———————————————————————————————— Création ————————————————————————————————

  addShape(kind: ShapeKind): string {
    this._counter += 1;
    const n = String(this._counter).padStart(2, "0");
    const shape = makeShape(`${kind}-${this._counter}-${n}`, kind, `${SHAPE_LABEL[kind]} ${n}`);
    // pose décalée pour éviter le recouvrement
    shape.transform = {
      position: {
        x: ((this._counter % 3) - 1) * 0.32,
        y: ((Math.floor(this._counter / 3) % 3) - 1) * 0.3,
        z: 0,
      },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0.3, y: 0.3, z: 0.3 },
    };
    shape.color = { r: 1, g: 0.541, b: 0.239 };
    this._activeGroup().children.push(shape);
    this._doc.selectedId = shape.id;
    this._push();
    this._emit();
    return shape.id;
  }

  addShaderLayer(shader: ShaderId): string {
    this._counter += 1;
    const id = `${shader}-${this._counter}`;
    const label = shader === "solid" ? "Couleur unie" : shader === "plasma" ? "Plasma" : "Balayage";
    const layer = makeShaderLayer(id, shader, label);
    this._activeGroup().children.unshift(layer); // ajouté au-dessus
    this._doc.selectedId = id;
    this._push();
    this._emit();
    return id;
  }

  addGroup(): string {
    this._counter += 1;
    const id = `group-${this._counter}`;
    const group = makeGroup(id, `Groupe ${String(this._counter).padStart(2, "0")}`);
    this._activeGroup().children.unshift(group);
    this._doc.selectedId = id;
    this._push();
    this._emit();
    return id;
  }

  // ———————————————————————————————— Mutation ————————————————————————————————

  setVisible(id: string, visible: boolean): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    layer.visible = visible;
    this._push();
    this._emit();
  }

  setOpacity(id: string, opacity: number): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    layer.opacity = opacity;
    const live = this._shaderLive.get(id);
    if (live) live.opacity = opacity;
    if (layer.type === "shape") this._recomputeScene(); // opacité LED = luminosité (temps réel)
    this._emit();
  }

  setBlend(id: string, blend: BlendMode): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    layer.blend = blend;
    this._push();
    this._emit();
  }

  /** Paramètre d'effet en direct (uniform) — n'émet pas (seuls canvas + contrôle réagissent). */
  setParam(id: string, key: string, value: number): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || layer.type !== "shader") return;
    layer.params[key] = value;
    this._shaderLive.get(id)?.setParam(key, value);
  }

  setTransform(id: string, patch: TransformPatch): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    const t = layer.transform;
    layer.transform = {
      position: { ...t.position, ...patch.position },
      rotation: { ...t.rotation, ...patch.rotation },
      scale: { ...t.scale, ...patch.scale },
    };
    if (layer.type === "shape") this._recomputeScene();
    this._emit();
  }

  setName(id: string, name: string): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    layer.name = name;
    this._emit();
  }

  setShowHelper(id: string, show: boolean): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || layer.type !== "shape") return;
    layer.showHelper = show;
    this._emit();
  }

  setColor(id: string, color: RGB): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    if (layer.type === "shape") {
      layer.color = color;
      this._recomputeScene();
    } else if (layer.type === "shader") {
      layer.color = color;
      const live = this._shaderLive.get(id);
      if (live instanceof SolidLayer) live.setColor(color.r, color.g, color.b);
    }
    this._emit();
  }

  subscribe(listener: EditorListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  // ————————————————————————————————— Interne —————————————————————————————————

  private _activeGroup(): GroupLayer {
    return findGroup(this._doc.root, this._doc.activeGroupId) ?? this._doc.root;
  }

  private _toInput(s: ShapeLayer): ShapeInput {
    return { kind: s.shape, position: s.transform.position, rotation: s.transform.rotation, scale: s.transform.scale, color: s.color, opacity: s.opacity };
  }

  private _shapeInputs(): ShapeInput[] {
    return this._activeGroup().children
      .filter((l): l is ShapeLayer => l.type === "shape" && l.visible)
      .map((s) => this._toInput(s));
  }

  /** Nombre de LEDs allumées par l'objet sélectionné (0 si non-shape / masqué) — pour le HUD. */
  selectedLedCount(): number {
    const sel = this.selected;
    if (!sel || sel.type !== "shape" || !sel.visible) return 0;
    return countLit([this._toInput(sel)], 128, 128);
  }

  /** recalcule la DataTexture depuis les shapes du groupe actif (sans reconstruire la pile). */
  private _recomputeScene(): void {
    this._scene3d?.setShapes(this._shapeInputs());
  }

  /** reconstruit la pile moteur du groupe actif : calques shader + un calque scène3d agrégé. */
  private _push(): void {
    const engine = this._engine;
    const scene3d = this._scene3d;
    if (!engine || !scene3d) return;

    scene3d.setShapes(this._shapeInputs());

    const stack: EngineLayer[] = [];
    let sceneAdded = false;
    for (const child of this._activeGroup().children) {
      if (child.type === "shader") {
        stack.push(this._ensureShader(child));
      } else if (child.type === "shape") {
        if (!sceneAdded) { stack.push(scene3d); sceneAdded = true; }
      }
      // group/image/video : non rendus en tranche 1 (navigables seulement)
    }
    // ordre d'affichage (haut = avant) → ordre moteur inversé (le haut rend en dernier)
    engine.setLayers([...stack].reverse());
  }

  /** engine layer d'un calque shader (créé une fois, réutilisé), synchronisé sur le modèle. */
  private _ensureShader(model: ShaderLayer): EngineLayer {
    let live = this._shaderLive.get(model.id);
    if (!live) {
      live = createLayer(model.shader, model.id);
      this._shaderLive.set(model.id, live);
    }
    live.enabled = model.visible;
    live.opacity = model.opacity;
    live.blend = model.blend;
    for (const key in model.params) live.setParam(key, model.params[key]);
    if (live instanceof SolidLayer) live.setColor(model.color.r, model.color.g, model.color.b);
    return live;
  }

  private _emit(): void {
    for (const listener of this._listeners) listener();
  }
}

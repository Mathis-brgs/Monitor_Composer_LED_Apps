export interface RGB { r: number; g: number; b: number; }
export type BlendMode = "normal" | "add";
export type ShaderId = "solid" | "plasma" | "sweep";
export type ShapeKind = "sphere" | "box" | "cylinder" | "cone" | "plane" | "torus";

export interface Vec3 { x: number; y: number; z: number; }
/** Transform façon Blender : position, rotation (Euler XYZ en radians), échelle — par axe. */
export interface Transform { position: Vec3; rotation: Vec3; scale: Vec3; }

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  transform: Transform;
}

export interface ShaderLayer extends LayerBase { type: "shader"; shader: ShaderId; params: Record<string, number>; color: RGB; }

/** Remplissage d'une shape : couleur unie, dégradé linéaire (angle en radians), ou média (data URL, embarqué dans le projet). */
export type Fill =
  | { type: "solid"; color: RGB }
  | { type: "gradient"; from: RGB; to: RGB; angle: number }
  | { type: "image"; dataUrl: string }
  | { type: "video"; dataUrl: string };

export interface ShapeLayer extends LayerBase { type: "shape"; shape: ShapeKind; fill: Fill; /** afficher le wireframe (helper d'édition) dans l'Editor 3D */ showHelper: boolean; }
export interface GroupLayer extends LayerBase { type: "group"; children: Layer[]; }
export interface ImageLayer extends LayerBase { type: "image"; assetId: string; }
export interface VideoLayer extends LayerBase { type: "video"; assetId: string; }
export type Layer = ShaderLayer | ShapeLayer | GroupLayer | ImageLayer | VideoLayer;

/** Couleur représentative d'un fill (wireframe/vignette) : couleur unie, moyenne pour un dégradé, blanc pour un média. */
export function fillPreviewColor(fill: Fill): RGB {
  switch (fill.type) {
    case "solid": return fill.color;
    case "gradient": return { r: (fill.from.r + fill.to.r) / 2, g: (fill.from.g + fill.to.g) / 2, b: (fill.from.b + fill.to.b) / 2 };
    case "image":
    case "video": return { r: 1, g: 1, b: 1 };
  }
}

/** Document = arbre (racine) + groupe où l'on se trouve + sélection. */
export interface Document { root: GroupLayer; activeGroupId: string; selectedId: string | null; }

const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
const ORIGIN = (): Transform => ({ position: vec3(), rotation: vec3(), scale: vec3(0.3, 0.3, 0.3) });
const WHITE = (): RGB => ({ r: 1, g: 1, b: 1 });

function base(id: string, name: string): LayerBase {
  return { id, name, visible: true, opacity: 1, blend: "normal", transform: ORIGIN() };
}

export function makeGroup(id: string, name: string): GroupLayer {
  return { ...base(id, name), type: "group", children: [] };
}
export function makeShape(id: string, shape: ShapeKind, name: string): ShapeLayer {
  return { ...base(id, name), type: "shape", shape, fill: { type: "solid", color: WHITE() }, showHelper: true };
}
export function makeShaderLayer(id: string, shader: ShaderId, name: string): ShaderLayer {
  return { ...base(id, name), type: "shader", shader, params: {}, color: WHITE() };
}

/** Recherche en profondeur d'un nœud par id (null si absent). */
export function findLayer(root: GroupLayer, id: string): Layer | null {
  for (const child of root.children) {
    if (child.id === id) return child;
    if (child.type === "group") {
      const found = findLayer(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** Groupe par id (racine incluse), null si absent ou nœud non-groupe. */
export function findGroup(root: GroupLayer, id: string): GroupLayer | null {
  if (root.id === id) return root;
  const node = findLayer(root, id);
  return node && node.type === "group" ? node : null;
}

/** Groupe parent d'un nœud (null pour la racine ou si absent). */
export function findParent(root: GroupLayer, id: string): GroupLayer | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    if (child.type === "group") {
      const p = findParent(child, id);
      if (p) return p;
    }
  }
  return null;
}

/** Enfants du groupe donné (dans le document). */
export function groupChildren(doc: Document, groupId: string): readonly Layer[] {
  return findGroup(doc.root, groupId)?.children ?? [];
}

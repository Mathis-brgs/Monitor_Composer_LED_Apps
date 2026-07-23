import type { RGB, ShapeKind, Vec3 } from "@domain/Layer.ts";

/**
 * Remplissage résolu (prêt pour le rasterizeur, pas de dépendance async) : couleur
 * unie, dégradé linéaire (coordonnées locales, angle en radians), ou bitmap déjà
 * décodé (image statique ou frame vidéo courante — même représentation une fois
 * en pixels).
 */
export type ShapeFill =
  | { kind: "solid"; color: RGB }
  | { kind: "gradient"; from: RGB; to: RGB; angle: number }
  | { kind: "bitmap"; data: Uint8ClampedArray; width: number; height: number };

export interface ShapeInput {
  kind: ShapeKind;
  position: Vec3;
  rotation?: Vec3;  // Euler XYZ (rad) ; absent/nul = pas de rotation
  scale: Vec3;      // demi-dimensions (box) ou rayons (sphère → ellipsoïde), unités mur [-1, 1]
  fill: ShapeFill;
  opacity?: number; // 0..1 ; module la luminosité de la LED (absent = 1)
}

// Tore unité : rayon majeur (centre de l'anneau) + mineur (tube), anneau dans le plan XY.
const TORUS_R = 0.7;
const TORUS_T = 0.3;
const PLANE_HALF_Z = 0.04; // épaisseur locale du plan (dalle fine)

/**
 * Applique R^T (rotation inverse) au vecteur q. R suit l'ordre Euler XYZ de Three
 * (Matrix4.makeRotationFromEuler) pour que le collider colle exactement au wireframe.
 */
function invRotate(r: Vec3, x: number, y: number, z: number): [number, number, number] {
  const a = Math.cos(r.x), b = Math.sin(r.x);
  const c = Math.cos(r.y), d = Math.sin(r.y);
  const e = Math.cos(r.z), f = Math.sin(r.z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  const m00 = c * e,       m01 = -c * f,      m02 = d;
  const m10 = af + be * d, m11 = ae - bf * d, m12 = -b * c;
  const m20 = bf - ae * d, m21 = be + af * d, m22 = a * c;
  return [
    m00 * x + m10 * y + m20 * z,
    m01 * x + m11 * y + m21 * z,
    m02 * x + m12 * y + m22 * z,
  ];
}

/** Coordonnées locales (monde → local : translation, rotation inverse, échelle) d'un point pour une shape. */
function localCoords(s: ShapeInput, x: number, y: number, z: number): [number, number, number] {
  let qx = x - s.position.x;
  let qy = y - s.position.y;
  let qz = z - s.position.z;
  const r = s.rotation;
  if (r && (r.x !== 0 || r.y !== 0 || r.z !== 0)) [qx, qy, qz] = invRotate(r, qx, qy, qz);
  return [qx / s.scale.x, qy / s.scale.y, qz / s.scale.z];
}

/** Vrai si le point local (lx,ly,lz) est dans la shape. */
function containsLocal(s: ShapeInput, lx: number, ly: number, lz: number): boolean {
  switch (s.kind) {
    case "sphere":
      return lx * lx + ly * ly + lz * lz < 1;
    case "box":
      return Math.abs(lx) < 1 && Math.abs(ly) < 1 && Math.abs(lz) < 1;
    case "cylinder": // axe Y, rayon dans XZ
      return Math.abs(ly) < 1 && lx * lx + lz * lz < 1;
    case "cone": { // axe Y, rayon décroissant vers l'apex (y=+1)
      if (Math.abs(ly) >= 1) return false;
      const r = (1 - ly) * 0.5;
      return lx * lx + lz * lz < r * r;
    }
    case "plane": // dalle fine dans le plan XY
      return Math.abs(lx) < 1 && Math.abs(ly) < 1 && Math.abs(lz) < PLANE_HALF_Z;
    case "torus": { // anneau dans le plan XY (face au mur)
      const q = Math.hypot(lx, ly) - TORUS_R;
      return q * q + lz * lz < TORUS_T * TORUS_T;
    }
    case "triangle": // dalle fine dans le plan XY, sommets (0,1) (-1,-1) (1,-1) — même convention que le wireframe (Editor3DScene)
      return Math.abs(lz) < PLANE_HALF_Z && triangleContains(lx, ly);
  }
}

function edgeSign(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

/** Point dans le triangle unité (sommets (0,1), (-1,-1), (1,-1)) — test par signe des 3 arêtes. */
function triangleContains(lx: number, ly: number): boolean {
  const d1 = edgeSign(lx, ly, 0, 1, -1, -1);
  const d2 = edgeSign(lx, ly, -1, -1, 1, -1);
  const d3 = edgeSign(lx, ly, 1, -1, 0, 1);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Couleur résolue d'un fill au point local (lx,ly) — [-1,1] ≈ étendue de la shape. */
function resolveFillColor(fill: ShapeFill, lx: number, ly: number): RGB {
  switch (fill.kind) {
    case "solid":
      return fill.color;
    case "gradient": {
      const dx = Math.cos(fill.angle), dy = Math.sin(fill.angle);
      const t = clamp01((lx * dx + ly * dy + 1) / 2);
      return {
        r: fill.from.r + (fill.to.r - fill.from.r) * t,
        g: fill.from.g + (fill.to.g - fill.from.g) * t,
        b: fill.from.b + (fill.to.b - fill.from.b) * t,
      };
    }
    case "bitmap": {
      const u = clamp01((lx + 1) / 2);
      const v = clamp01((1 - ly) / 2); // ligne 0 du bitmap = haut de l'image
      const px = Math.min(fill.width - 1, Math.floor(u * fill.width));
      const py = Math.min(fill.height - 1, Math.floor(v * fill.height));
      const o = (py * fill.width + px) * 4;
      return { r: fill.data[o] / 255, g: fill.data[o + 1] / 255, b: fill.data[o + 2] / 255 };
    }
  }
}

/**
 * Rend les shapes en RGBA8 (longueur w*h*4). Pour chaque LED (grille [-1,1]), le
 * dernier shape qui la contient donne sa couleur (avant-plan gagne) ; sinon alpha 0.
 * Logique pure (testable sans GPU) — la version 3D et la DataTexture la partagent.
 */
export function rasterizeShapes(shapes: readonly ShapeInput[], w: number, h: number): Uint8Array {
  const buf = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) {
    // ligne 0 = haut du mur : compense le sens de la texture composite (sinon Y inversé au rendu)
    const y = 1 - (j / (h - 1)) * 2;
    for (let i = 0; i < w; i++) {
      const x = (i / (w - 1)) * 2 - 1;
      let hit: ShapeInput | null = null;
      let hlx = 0, hly = 0;
      for (const s of shapes) {
        const [lx, ly, lz] = localCoords(s, x, y, 0);
        if (containsLocal(s, lx, ly, lz)) { hit = s; hlx = lx; hly = ly; } // dernier gagne
      }
      if (!hit) continue;
      const a = hit.opacity ?? 1; // opacité = luminosité de la LED (le mur 3D ignore l'alpha)
      const color = resolveFillColor(hit.fill, hlx, hly);
      const k = (j * w + i) * 4;
      buf[k] = Math.round(color.r * 255 * a);
      buf[k + 1] = Math.round(color.g * 255 * a);
      buf[k + 2] = Math.round(color.b * 255 * a);
      buf[k + 3] = 255;
    }
  }
  return buf;
}

/** Nombre de LEDs (grille w*h) couvertes par au moins une shape — pour le compteur HUD. */
export function countLit(shapes: readonly ShapeInput[], w: number, h: number): number {
  let n = 0;
  for (let j = 0; j < h; j++) {
    const y = 1 - (j / (h - 1)) * 2;
    for (let i = 0; i < w; i++) {
      const x = (i / (w - 1)) * 2 - 1;
      for (const s of shapes) {
        const [lx, ly, lz] = localCoords(s, x, y, 0);
        if (containsLocal(s, lx, ly, lz)) { n++; break; }
      }
    }
  }
  return n;
}

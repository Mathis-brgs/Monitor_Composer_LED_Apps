import type { RGB, ShapeKind, Vec3 } from "@domain/Layer.ts";

export interface ShapeInput {
  kind: ShapeKind;
  position: Vec3;
  rotation?: Vec3;  // Euler XYZ (rad) ; absent/nul = pas de rotation
  scale: Vec3;      // demi-dimensions (box) ou rayons (sphère → ellipsoïde), unités mur [-1, 1]
  color: RGB;
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

/** Vrai si la LED (x,y,z) est dans la shape (monde → local : translation, rotation inverse, échelle). */
function contains(s: ShapeInput, x: number, y: number, z: number): boolean {
  let qx = x - s.position.x;
  let qy = y - s.position.y;
  let qz = z - s.position.z;
  const r = s.rotation;
  if (r && (r.x !== 0 || r.y !== 0 || r.z !== 0)) [qx, qy, qz] = invRotate(r, qx, qy, qz);
  const lx = qx / s.scale.x;
  const ly = qy / s.scale.y;
  const lz = qz / s.scale.z;
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
      for (const s of shapes) if (contains(s, x, y, 0)) hit = s; // dernier gagne
      if (!hit) continue;
      const a = hit.opacity ?? 1; // opacité = luminosité de la LED (le mur 3D ignore l'alpha)
      const k = (j * w + i) * 4;
      buf[k] = Math.round(hit.color.r * 255 * a);
      buf[k + 1] = Math.round(hit.color.g * 255 * a);
      buf[k + 2] = Math.round(hit.color.b * 255 * a);
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
        if (contains(s, x, y, 0)) { n++; break; }
      }
    }
  }
  return n;
}

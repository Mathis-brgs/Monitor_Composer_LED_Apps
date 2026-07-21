export type Interp = "linear" | "hold" | "bezier" | "ease-in" | "ease-out";

/** Une clé : valeur d'un canal scalaire à un frame, + interpolation VERS la clé suivante. */
export interface Keyframe {
  readonly frame: number;
  readonly value: number;
  readonly interp: Interp;
  readonly cp?: readonly [number, number, number, number]; // [x1, y1, x2, y2]
}

/** Un canal scalaire animé d'un calque. `channel` = "opacity" | "position.x" | "color.r" | "param.speed" ... */
export interface Track {
  readonly layerId: string;
  readonly channel: string;
  keyframes: Keyframe[]; // triés par frame croissant
}

/** Le montage animé : les tracks de la composition active (durée portée par le Clock). */
export interface Composition {
  tracks: Track[];
}

export const EMPTY_COMPOSITION: Composition = { tracks: [] };

/** Vrai si l'objet a la forme d'une Composition (garde de désérialisation). */
export function isComposition(x: unknown): x is Composition {
  return typeof x === "object" && x !== null && Array.isArray((x as { tracks?: unknown }).tracks);
}

/** Résout X(t) = x par dichotomie pour trouver t, puis calcule Y(t). */
export function sampleCubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let low = 0;
  let high = 1;
  let t = 0.5;
  for (let i = 0; i < 16; i++) {
    const xt = 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
    if (Math.abs(xt - x) < 1e-4) break;
    if (xt < x) {
      low = t;
    } else {
      high = t;
    }
    t = (low + high) / 2;
  }
  return 3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t;
}

/** Calcule la dérivée analytique dY/dX pour X(t) = x. */
export function getCubicBezierVelocity(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (x <= 0) {
    const dX_dt = 3 * x1;
    if (dX_dt === 0) return 0;
    return (3 * y1) / dX_dt;
  }
  if (x >= 1) {
    const dX_dt = 3 * (1 - x2);
    if (dX_dt === 0) return 0;
    return (3 * (1 - y2)) / dX_dt;
  }
  let low = 0;
  let high = 1;
  let t = 0.5;
  for (let i = 0; i < 16; i++) {
    const xt = 3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t;
    if (Math.abs(xt - x) < 1e-4) break;
    if (xt < x) low = t;
    else high = t;
    t = (low + high) / 2;
  }
  const dX_dt = 3 * (1 - 4 * t + 3 * t * t) * x1 + 3 * (2 * t - 3 * t * t) * x2 + 3 * t * t;
  const dY_dt = 3 * (1 - 4 * t + 3 * t * t) * y1 + 3 * (2 * t - 3 * t * t) * y2 + 3 * t * t;
  if (Math.abs(dX_dt) < 1e-5) return 0;
  return dY_dt / dX_dt;
}

/** Valeur d'un canal au frame donné. `kfs` doit être non vide et trié. Clamp aux extrêmes. */
export function sampleKeyframes(kfs: readonly Keyframe[], frame: number): number {
  const first = kfs[0];
  if (frame <= first.frame) return first.value;
  const last = kfs[kfs.length - 1];
  if (frame >= last.frame) return last.value;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (frame >= a.frame && frame < b.frame) {
      if (a.interp === "hold") return a.value;
      const raw = (frame - a.frame) / (b.frame - a.frame);
      let t = raw;
      if (a.interp === "bezier") {
        if (a.cp) {
          t = sampleCubicBezier(a.cp[0], a.cp[1], a.cp[2], a.cp[3], raw);
        } else {
          t = raw * raw * (3 - 2 * raw); // smoothstep
        }
      } else if (a.interp === "ease-in") {
        t = raw * raw; // quadratic ease-in
      } else if (a.interp === "ease-out") {
        t = raw * (2 - raw); // quadratic ease-out
      }
      return a.value + (b.value - a.value) * t;
    }
  }
  return last.value;
}

/** Insère la clé (ou remplace celle du même frame), en gardant le tableau trié. Renvoie un nouveau tableau. */
export function upsertKeyframe(kfs: readonly Keyframe[], kf: Keyframe): Keyframe[] {
  const out = kfs.filter((k) => k.frame !== kf.frame);
  out.push(kf);
  out.sort((a, b) => a.frame - b.frame);
  return out;
}

/** Retire la clé au frame donné (no-op si absente). Renvoie un nouveau tableau. */
export function removeKeyframe(kfs: readonly Keyframe[], frame: number): Keyframe[] {
  return kfs.filter((k) => k.frame !== frame);
}

/** Déplace la clé du frame `from` vers `to` (garde valeur+interp), re-trié. No-op si absente. */
export function moveKeyframe(kfs: readonly Keyframe[], from: number, to: number): Keyframe[] {
  const k = kfs.find((x) => x.frame === from);
  if (!k) return kfs.slice();
  return upsertKeyframe(kfs.filter((x) => x.frame !== from), { frame: to, value: k.value, interp: k.interp, cp: k.cp });
}

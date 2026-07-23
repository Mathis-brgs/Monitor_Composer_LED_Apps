import { makeGroup, type GroupLayer, type RGB, type Vec3 } from "./Layer.ts";

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

/** Nature d'une composition : principale, précomp (2D imbriquée) ou prérendu (scène 3D → RT). */
export type CompKind = "main" | "precomp" | "prerender";

/** Caméra + réglages de rendu d'un prérendu (scène 3D rendue dans une RenderTarget). */
export interface PrerenderScene {
  camera: {
    kind: "perspective" | "orthographic";
    fov?: number;
    position: Vec3;
    target: Vec3;
    near: number;
    far: number;
  };
  background: RGB;
  /** Résolution de la RT ; absent = taille de la fixture. */
  resolution?: { w: number; h: number };
}

/**
 * Composition = unité de timeline autonome et imbricable (façon comp After Effects).
 * Détient son arbre de calques (`root`), son animation (`tracks`) et sa durée propre.
 * `kind` distingue la comp principale, une précomp (2D) et un prérendu (scène 3D).
 */
export interface Composition {
  id: string;
  name: string;
  kind: CompKind;
  durationFrames: number;
  /** fps propre (absent = fps du projet). */
  fps?: number;
  root: GroupLayer;
  tracks: Track[];
  /** Prérendu seulement : caméra + réglages 3D. */
  scene?: PrerenderScene;
}

/** Durée par défaut d'une composition (frames) — aligne le Clock par défaut. */
export const DEFAULT_DURATION_FRAMES = 192;

/** Construit une composition ; `root` par défaut = un groupe vide propre à la comp. */
export function makeComposition(
  id: string,
  name: string,
  kind: CompKind,
  opts: { durationFrames?: number; fps?: number; root?: GroupLayer; tracks?: Track[]; scene?: PrerenderScene } = {},
): Composition {
  return {
    id,
    name,
    kind,
    durationFrames: opts.durationFrames ?? DEFAULT_DURATION_FRAMES,
    fps: opts.fps,
    root: opts.root ?? makeGroup(`${id}:root`, name),
    tracks: opts.tracks ?? [],
    scene: opts.scene,
  };
}

export function findComposition(comps: Record<string, Composition>, id: string): Composition | undefined {
  return comps[id];
}

/** Scène de prérendu par défaut : caméra perspective face au centre, fond noir. */
export function defaultPrerenderScene(): PrerenderScene {
  return {
    camera: { kind: "perspective", fov: 50, position: { x: 0, y: 0, z: 2 }, target: { x: 0, y: 0, z: 0 }, near: 0.1, far: 100 },
    background: { r: 0, g: 0, b: 0 },
  };
}

/** Garde de désérialisation : l'objet a-t-il la forme d'une entité Composition (id + root + tracks) ? */
export function isComposition(x: unknown): x is Composition {
  if (typeof x !== "object" || x === null) return false;
  const c = x as Partial<Composition>;
  return typeof c.id === "string" && Array.isArray(c.tracks) && typeof c.root === "object" && c.root !== null;
}

/** Garde souple : l'objet porte-t-il des `tracks` (ancien format `{ tracks }` ou entité) ? */
export function hasTracks(x: unknown): x is { tracks: Track[] } {
  return typeof x === "object" && x !== null && Array.isArray((x as { tracks?: unknown }).tracks);
}

/**
 * Sépare des tracks selon un ensemble d'ids de calques (précompose) : `inside` = tracks des
 * calques déplacés, `outside` = celles qui restent. Nouveaux tableaux (pas de mutation).
 */
export function partitionTracks(tracks: readonly Track[], ids: ReadonlySet<string>): { inside: Track[]; outside: Track[] } {
  const inside: Track[] = [];
  const outside: Track[] = [];
  for (const t of tracks) (ids.has(t.layerId) ? inside : outside).push(t);
  return { inside, outside };
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

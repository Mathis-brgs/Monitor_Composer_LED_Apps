import { makeGroup, type GroupLayer, type RGB, type Vec3 } from "./Layer.ts";

export type Interp = "linear" | "hold" | "bezier";

/** Une clé : valeur d'un canal scalaire à un frame, + interpolation VERS la clé suivante. */
export interface Keyframe {
  readonly frame: number;
  readonly value: number;
  readonly interp: Interp;
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
      // bézier (auto-ease) = smoothstep ; les tangentes éditables viendront avec le graph editor (slice 5)
      const t = a.interp === "bezier" ? raw * raw * (3 - 2 * raw) : raw;
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
  return upsertKeyframe(kfs.filter((x) => x.frame !== from), { frame: to, value: k.value, interp: k.interp });
}

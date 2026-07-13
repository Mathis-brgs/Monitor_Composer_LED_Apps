export type Interp = "linear" | "hold";

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

/** Le montage animé : les tracks de la composition active (durée portée par le Clock). */
export interface Composition {
  tracks: Track[];
}

export const EMPTY_COMPOSITION: Composition = { tracks: [] };

/** Vrai si l'objet a la forme d'une Composition (garde de désérialisation). */
export function isComposition(x: unknown): x is Composition {
  return typeof x === "object" && x !== null && Array.isArray((x as { tracks?: unknown }).tracks);
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
      const t = (frame - a.frame) / (b.frame - a.frame);
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

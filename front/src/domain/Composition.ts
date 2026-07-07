export interface Keyframe {
  readonly time: number;
  readonly value: number;
}

export interface Track {
  readonly id: string;
  /** cible animée (id d'objet/couche + propriété) */
  readonly target: string;
  readonly keyframes: Keyframe[];
}

export interface Sequence {
  readonly id: string;
  readonly duration: number;
  readonly tracks: Track[];
}

/** Le montage : séquences / pistes / keyframes. Modèle pur ; l'édition viendra dans l'éditeur. */
export interface Composition {
  readonly sequences: Sequence[];
}

export const EMPTY_COMPOSITION: Composition = { sequences: [] };

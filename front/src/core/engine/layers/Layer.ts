import { uniform } from "three/tsl";
import type { ShaderNodeObject } from "three/tsl";
import type { Node } from "three/webgpu";

/** Type d'un nœud TSL chaînable (générique : accepte n'importe quel type de nœud). */
export type TSLNode = ShaderNodeObject<Node>;

export type BlendMode = "normal" | "add";

export const LAYER_ID = {
  SOLID: "solid",
  PLASMA: "plasma",
  SWEEP: "sweep",
  SCENE3D: "scene3d",
} as const;
export type LayerId = (typeof LAYER_ID)[keyof typeof LAYER_ID];

/** Uniforms partagés fournis aux couches (temps de show, résolution). */
export interface LayerContext {
  readonly time: TSLNode;
  readonly resolution: TSLNode;
}

/**
 * Unité atomique de création (= un `.node.ts` du boilerplate) : un effet = un job.
 * `build()` retourne une couleur RGBA (nœud TSL vec4). On compose en empilant.
 * `opacity` est un uniform (modifiable en direct sans reconstruire la pile).
 */
export abstract class Layer {
  abstract readonly kind: LayerId;
  enabled = true;
  blend: BlendMode = "normal";

  private readonly _opacity = uniform(1);

  constructor(readonly id: string) {}

  get opacity(): number {
    return this._opacity.value as number;
  }
  set opacity(value: number) {
    this._opacity.value = value;
  }

  /** Nœud opacité (uniform live) consommé par le compositor. */
  get opacityNode(): TSLNode {
    return this._opacity as unknown as TSLNode;
  }

  /** Paramètre d'effet en direct — surchargé par les couches qui en exposent. */
  setParam(_key: string, _value: number): void {}

  abstract build(ctx: LayerContext): TSLNode;
}

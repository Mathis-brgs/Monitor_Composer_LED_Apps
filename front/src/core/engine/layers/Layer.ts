import type { ShaderNodeObject } from "three/tsl";
import type { Node } from "three/webgpu";

/** Type d'un nœud TSL chaînable (générique : accepte n'importe quel type de nœud). */
export type TSLNode = ShaderNodeObject<Node>;

export type BlendMode = "normal" | "add";

export const LAYER_ID = {
  SOLID: "solid",
  PLASMA: "plasma",
  SWEEP: "sweep",
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
 */
export abstract class Layer {
  abstract readonly kind: LayerId;
  enabled = true;
  opacity = 1;
  blend: BlendMode = "normal";

  constructor(readonly id: string) {}

  abstract build(ctx: LayerContext): TSLNode;
}

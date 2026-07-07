import { float, uv, vec4 } from "three/tsl";
import { Layer, LAYER_ID, type LayerContext, type TSLNode } from "./Layer.ts";

/** Balayage horizontal — utile pour vérifier le mapping/câblage. */
export class SweepLayer extends Layer {
  readonly kind = LAYER_ID.SWEEP;

  build(ctx: LayerContext): TSLNode {
    const p = uv();
    const pos = ctx.time.mul(0.25).fract();
    const inten = float(1).sub(p.x.sub(pos).abs().mul(10)).saturate();
    return vec4(inten, inten.mul(0.7), inten.mul(0.15), 1);
  }
}

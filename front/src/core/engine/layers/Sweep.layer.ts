import { uv, vec3, vec4 } from "three/tsl";
import { Layer, LAYER_ID, type LayerContext, type TSLNode } from "./Layer.ts";

/** Balayage — bande gaussienne diagonale du proto (couleur ember pv.sweep, blend additif). */
export class SweepLayer extends Layer {
  readonly kind = LAYER_ID.SWEEP;

  build(ctx: LayerContext): TSLNode {
    const px = uv().x.mul(128);
    const py = uv().y.mul(128);
    const t = ctx.time;

    const spos = t.mul(0.07).fract().mul(1.4).sub(0.2);
    const dd = px.add(py).div(254);
    const diff = dd.sub(spos);
    const band = diff.mul(diff).div(0.044).negate().exp(); // exp(-diff² / (2·0.022))

    return vec4(vec3(1.0, 0.9098, 0.8078).mul(band), 1);
  }
}

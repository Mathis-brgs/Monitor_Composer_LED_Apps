import { uv, vec4 } from "three/tsl";
import { Layer, LAYER_ID, type LayerContext, type TSLNode } from "./Layer.ts";

const TAU = 6.28318;

/** Plasma animé (somme de sinus) — l'anim du proto, en TSL. */
export class PlasmaLayer extends Layer {
  readonly kind = LAYER_ID.PLASMA;

  build(ctx: LayerContext): TSLNode {
    const p = uv();
    const t = ctx.time;

    const v = p.x
      .mul(20)
      .add(t.mul(2))
      .sin()
      .add(p.y.mul(20).sub(t.mul(1.5)).sin())
      .add(p.x.add(p.y).mul(15).add(t).sin());

    const n = v.mul(0.16667).add(0.5);
    const r = n.mul(TAU).sin().mul(0.5).add(0.5);
    const g = n.mul(TAU).add(2.094).sin().mul(0.5).add(0.5);
    const b = n.mul(TAU).add(4.188).sin().mul(0.5).add(0.5);

    return vec4(r, g, b, 1);
  }
}

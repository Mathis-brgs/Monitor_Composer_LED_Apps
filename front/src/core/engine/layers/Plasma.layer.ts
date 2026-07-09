import { length, mix, uniform, uv, vec2, vec3, vec4 } from "three/tsl";
import { Layer, LAYER_ID, type LayerContext, type TSLNode } from "./Layer.ts";

/**
 * Plasma animé — formule exacte du proto (4 sinus dont un radial), couleur en lerp
 * ember pv.a→pv.b. Les paramètres modulent autour du point du proto :
 * vitesse .42 / détail .7 / contraste .55 reproduisent le rendu d'origine.
 */
export class PlasmaLayer extends Layer {
  readonly kind = LAYER_ID.PLASMA;

  private readonly _speed = uniform(0.42);
  private readonly _detail = uniform(0.7);
  private readonly _contrast = uniform(0.55);

  setParam(key: string, value: number): void {
    if (key === "speed") this._speed.value = value;
    else if (key === "detail") this._detail.value = value;
    else if (key === "contrast") this._contrast.value = value;
  }

  build(ctx: LayerContext): TSLNode {
    const t = ctx.time;
    const timeMul = this._speed.mul(2.381); // .42 → 1.0
    const freqMul = this._detail.mul(1.4286); // .7 → 1.0
    const gain = this._contrast.mul(1.818); // .55 → 1.0

    // coords pixel 0..128 (le proto travaille en pixels)
    const px = uv().x.mul(128);
    const py = uv().y.mul(128);

    const s1 = px.mul(freqMul.mul(0.09)).add(t.mul(timeMul.mul(1.2))).sin();
    const s2 = py.mul(freqMul.mul(0.08)).sub(t.mul(timeMul.mul(0.9))).sin();
    const s3 = px.add(py).mul(freqMul.mul(0.05)).add(t.mul(timeMul.mul(1.6))).sin();
    const dist = length(vec2(px.sub(64), py.sub(64)));
    const s4 = dist.mul(freqMul.mul(0.11)).sub(t.mul(timeMul.mul(2.0))).sin();

    const field = s1.add(s2).add(s3).add(s4).mul(0.25); // /4 → [-1,1]
    const v01 = field.mul(0.5).add(0.5); // → 0..1
    const v = v01.sub(0.5).mul(gain).add(0.5).saturate(); // contraste

    // ember pv.a (orange) → pv.b (rose-rouge)
    const colA = vec3(1.0, 0.5412, 0.2392);
    const colB = vec3(1.0, 0.2902, 0.3529);
    return vec4(mix(colA, colB, v), 1);
  }
}

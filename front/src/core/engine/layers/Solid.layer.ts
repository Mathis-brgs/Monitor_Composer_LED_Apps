import { Color } from "three/webgpu";
import { uniform, vec4 } from "three/tsl";
import { Layer, LAYER_ID, type LayerContext, type TSLNode } from "./Layer.ts";

/** Couleur unie (uniform modifiable en direct via l'interface). */
export class SolidLayer extends Layer {
  readonly kind = LAYER_ID.SOLID;
  readonly colorU = uniform(new Color(0xff3366));

  build(_ctx: LayerContext): TSLNode {
    return vec4(this.colorU, 1);
  }
}

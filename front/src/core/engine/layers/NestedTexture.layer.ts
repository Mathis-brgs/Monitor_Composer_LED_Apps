import { texture, uv, vec2, vec4 } from "three/tsl";
import type { Texture } from "three/webgpu";
import { Layer, LAYER_ID, type LayerContext, type TSLNode } from "./Layer.ts";

/**
 * Calque « composition imbriquée » : échantillonne la texture (RenderTarget) d'une comp enfant
 * (précomp / prérendu) rendue à part, comme le fait `VideoWallLayer` pour un flux vidéo.
 * La comp enfant est rendue dans sa RT AVANT la comp parente (voir `Engine.update`).
 */
export class NestedTextureLayer extends Layer {
  readonly kind = LAYER_ID.NESTED;
  private _tex: Texture | null = null;
  private _flipV = true;

  /** Associe la texture de sortie de la comp enfant (idempotent). */
  setTexture(tex: Texture): void {
    this._tex = tex;
  }

  /** Flip vertical de l'échantillonnage. Vrai pour une précomp 2D (LayerStack) ; FAUX pour un prérendu
   *  (la scène 3D rendue en RT n'a pas l'inversion V du compositor 2D → la flipper la mettrait à l'envers). */
  setFlipV(v: boolean): void {
    this._flipV = v;
  }

  build(_ctx: LayerContext): TSLNode {
    if (!this._tex) return vec4(0, 0, 0, 0) as unknown as TSLNode; // transparent tant qu'aucune RT
    const coord = this._flipV ? vec2(uv().x, uv().y.oneMinus()) : uv();
    return texture(this._tex, coord) as unknown as TSLNode;
  }
}

import { texture, uv, vec4 } from "three/tsl";
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

  /** Associe la texture de sortie de la comp enfant (idempotent). */
  setTexture(tex: Texture): void {
    this._tex = tex;
  }

  build(_ctx: LayerContext): TSLNode {
    if (!this._tex) return vec4(0, 0, 0, 0) as unknown as TSLNode; // transparent tant qu'aucune RT
    return texture(this._tex, uv()) as unknown as TSLNode;
  }
}

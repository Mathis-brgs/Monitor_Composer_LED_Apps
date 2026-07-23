import { VideoTexture } from "three/webgpu";
import { texture, uv, vec4 } from "three/tsl";
import { Layer, LAYER_ID, type LayerContext, type TSLNode } from "./Layer.ts";

/**
 * Vidéo plein-cadre sur le mur : échantillonne un `VideoTexture` (mis à jour par le
 * GPU à chaque frame) sur toute la surface. La lecture (`<video>`) et la synchro au
 * playhead sont pilotées par l'Editor ; ici on ne fait que présenter la texture.
 */
export class VideoWallLayer extends Layer {
  readonly kind = LAYER_ID.VIDEO;
  private _tex: VideoTexture | null = null;
  private _el: HTMLVideoElement | null = null;

  /** Associe l'élément vidéo source (idempotent). */
  setVideo(el: HTMLVideoElement): void {
    if (this._el === el) return;
    this._tex?.dispose();
    this._el = el;
    this._tex = new VideoTexture(el);
    // three.js applique flipY=true par défaut (convention GL bas-gauche) ; le
    // compositeur attend lui une origine haut-gauche (cf. rasterizeShapes, qui
    // pré-compense côté CPU pour les DataTexture) — d'où l'image inversée sans ça.
    this._tex.flipY = false;
  }

  build(_ctx: LayerContext): TSLNode {
    if (!this._tex) return vec4(0, 0, 0, 0) as unknown as TSLNode; // transparent tant qu'aucune vidéo
    return texture(this._tex, uv()) as unknown as TSLNode;
  }
}

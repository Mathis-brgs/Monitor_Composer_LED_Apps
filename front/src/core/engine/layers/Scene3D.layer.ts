import { DataTexture, NearestFilter, RGBAFormat, UnsignedByteType } from "three/webgpu";
import { texture, uv } from "three/tsl";
import { Layer, LAYER_ID, type LayerContext, type TSLNode } from "./Layer.ts";
import { rasterizeShapes, type ShapeInput } from "../shapes.ts";

/**
 * Calque « scène 3D » : les shapes du groupe allument les LEDs (couleur par objet).
 * Le calcul (collision) se fait côté CPU dans une DataTexture RGBA, échantillonnée
 * par le compositor comme n'importe quel autre calque. Recalcul au changement de shape.
 */
export class Scene3DLayer extends Layer {
  readonly kind = LAYER_ID.SCENE3D;
  private readonly _tex: DataTexture;
  private readonly _w: number;
  private readonly _h: number;

  constructor(id: string, width = 128, height = 128) {
    super(id);
    this._w = width;
    this._h = height;
    this._tex = new DataTexture(new Uint8Array(width * height * 4), width, height, RGBAFormat, UnsignedByteType);
    this._tex.magFilter = NearestFilter;
    this._tex.minFilter = NearestFilter;
    this._tex.generateMipmaps = false;
    this._tex.needsUpdate = true;
  }

  /** recalcule la texture depuis les shapes du groupe (appelé au changement de shape). */
  setShapes(shapes: readonly ShapeInput[]): void {
    const rgba = rasterizeShapes(shapes, this._w, this._h);
    (this._tex.image.data as Uint8Array).set(rgba);
    this._tex.needsUpdate = true;
  }

  build(_ctx: LayerContext): TSLNode {
    // cast : ShaderNodeObject<T> est invariant en T ; on expose le type chaînable générique.
    return texture(this._tex, uv()) as unknown as TSLNode;
  }
}

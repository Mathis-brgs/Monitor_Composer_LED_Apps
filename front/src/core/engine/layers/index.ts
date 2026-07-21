import { Layer, LAYER_ID, type LayerId } from "./Layer.ts";
import { SolidLayer } from "./Solid.layer.ts";
import { PlasmaLayer } from "./Plasma.layer.ts";
import { SweepLayer } from "./Sweep.layer.ts";
import { Scene3DLayer } from "./Scene3D.layer.ts";
import { VideoWallLayer } from "./Video.layer.ts";
import { NestedTextureLayer } from "./NestedTexture.layer.ts";

/** Registre explicite des couches disponibles (pas d'auto-discovery). */
const FACTORIES: Record<LayerId, (id: string) => Layer> = {
  [LAYER_ID.SOLID]: (id) => new SolidLayer(id),
  [LAYER_ID.PLASMA]: (id) => new PlasmaLayer(id),
  [LAYER_ID.SWEEP]: (id) => new SweepLayer(id),
  [LAYER_ID.SCENE3D]: (id) => new Scene3DLayer(id),
  [LAYER_ID.VIDEO]: (id) => new VideoWallLayer(id),
  [LAYER_ID.NESTED]: (id) => new NestedTextureLayer(id),
};

export function createLayer(kind: LayerId, id: string): Layer {
  return FACTORIES[kind](id);
}

export { Layer, LAYER_ID, type LayerId } from "./Layer.ts";
export type { BlendMode, LayerContext, TSLNode } from "./Layer.ts";

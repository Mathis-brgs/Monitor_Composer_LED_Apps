import {
  AdditiveBlending,
  Mesh,
  MeshBasicNodeMaterial,
  NearestFilter,
  NormalBlending,
  OrthographicCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  Vector2,
} from "three/webgpu";
import { float, uniform } from "three/tsl";
import type { Layer, LayerContext, TSLNode } from "./layers/Layer.ts";

/**
 * Compositor : empile les couches actives sur des quads plein écran et les rend
 * dans une render target de la taille de la fixture. Chaque pixel de la RT = une entité.
 */
export class LayerStack {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
  readonly target: RenderTarget;

  private readonly _timeU = uniform(0);
  private readonly _ctx: LayerContext;
  private readonly _meshes: Mesh[] = [];

  constructor(width: number, height: number) {
    this.target = new RenderTarget(width, height, { depthBuffer: false });
    this.target.texture.minFilter = NearestFilter;
    this.target.texture.magFilter = NearestFilter;
    this.target.texture.generateMipmaps = false;
    // casts : ShaderNodeObject<T> est invariant en T ; on expose le type chaînable générique.
    this._ctx = {
      time: this._timeU as unknown as TSLNode,
      resolution: uniform(new Vector2(width, height)) as unknown as TSLNode,
    };
  }

  setLayers(layers: Layer[]): void {
    for (const m of this._meshes) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as MeshBasicNodeMaterial).dispose();
    }
    this._meshes.length = 0;

    layers
      .filter((l) => l.enabled)
      .forEach((layer, i) => {
        const material = new MeshBasicNodeMaterial();
        material.colorNode = layer.build(this._ctx);
        material.opacityNode = float(layer.opacity);
        material.transparent = true;
        material.depthTest = false;
        material.depthWrite = false;
        material.blending = layer.blend === "add" ? AdditiveBlending : NormalBlending;

        const mesh = new Mesh(new PlaneGeometry(1, 1), material);
        mesh.renderOrder = i;
        this.scene.add(mesh);
        this._meshes.push(mesh);
      });
  }

  setTime(seconds: number): void {
    this._timeU.value = seconds;
  }
}

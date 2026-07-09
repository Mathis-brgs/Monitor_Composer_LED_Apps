import {
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  type Texture,
  type WebGPURenderer,
} from "three/webgpu";
import { ledColorNode } from "@core/engine/led.ts";

/**
 * Aperçu 2D « réel » du mur : chaque LED = un point rond lumineux (shader partagé)
 * sur fond noir. Ratio carré préservé.
 */
export class Preview2DScene {
  private readonly _scene = new Scene();
  private readonly _camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
  private readonly _mesh: Mesh;
  private _aspect = 0;

  constructor(source: Texture) {
    const material = new MeshBasicNodeMaterial();
    material.colorNode = ledColorNode(source);
    this._mesh = new Mesh(new PlaneGeometry(1, 1), material);
    this._scene.add(this._mesh);
  }

  render(renderer: WebGPURenderer): void {
    const el = renderer.domElement;
    const aspect = el.clientHeight > 0 ? el.clientWidth / el.clientHeight : 1;
    if (aspect !== this._aspect) {
      this._aspect = aspect;
      // mur 128×128 = carré : on rétrécit l'axe le plus long pour éviter l'étirement
      if (aspect >= 1) this._mesh.scale.set(1 / aspect, 1, 1);
      else this._mesh.scale.set(1, aspect, 1);
    }
    renderer.setRenderTarget(null);
    renderer.render(this._scene, this._camera);
  }
}

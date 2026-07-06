import {
  Mesh,
  MeshBasicNodeMaterial,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  type Texture,
  type WebGPURenderer,
} from "three/webgpu";
import { texture, uv } from "three/tsl";

/** Affiche une texture (la RT du moteur) plein écran — aperçu 2D du mur (gros pixels). */
export class Preview2DScene {
  private readonly _scene = new Scene();
  private readonly _camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);

  constructor(source: Texture) {
    const material = new MeshBasicNodeMaterial();
    material.colorNode = texture(source, uv());
    this._scene.add(new Mesh(new PlaneGeometry(1, 1), material));
  }

  render(renderer: WebGPURenderer): void {
    renderer.setRenderTarget(null);
    renderer.render(this._scene, this._camera);
  }
}

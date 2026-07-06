import { PerspectiveCamera, Scene, type WebGPURenderer } from "three/webgpu";

/** Rendu 3D de l'installation (entités en sphères dans l'espace). Coquille. */
export class Preview3DScene {
  private readonly _scene = new Scene();
  private readonly _camera = new PerspectiveCamera(50, 1, 0.1, 1000);

  // TODO: instancier les entités de la fixture en 3D + caméra orbitale

  render(renderer: WebGPURenderer): void {
    renderer.setRenderTarget(null);
    renderer.render(this._scene, this._camera);
  }
}

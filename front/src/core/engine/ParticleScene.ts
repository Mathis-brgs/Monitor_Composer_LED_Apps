import {
  Color,
  Group,
  NearestFilter,
  OrthographicCamera,
  RenderTarget,
  Scene,
  type WebGPURenderer,
} from "three/webgpu";
import type { ParticlesLayer } from "@domain/Layer.ts";
import { ParticleSystem, type ResolvedSim } from "./ParticleSystem.ts";

/**
 * Producteur de particules pour le compositing mur : un `ParticleSystem` rendu par une caméra ortho de
 * face dans sa propre RenderTarget. Structurellement compatible `NestedSource` (scene/camera/target/prepare)
 * → consommé par `Engine.setNested` comme un `LayerStack` / `Prerender3DScene`. Sa texture est réinjectée
 * dans le parent par un `NestedTextureLayer` (compositing additif).
 *
 * Repère de simulation = espace mur [-1,1] (X droite, Y haut) ; l'émetteur suit `transform.position` du calque.
 */
export class ParticleScene {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, -10, 10);
  readonly target: RenderTarget;
  private readonly _system = new ParticleSystem();

  constructor(width = 128, height = 128) {
    this.target = new RenderTarget(width, height, { depthBuffer: false });
    this.target.texture.minFilter = NearestFilter;
    this.target.texture.magFilter = NearestFilter;
    this.target.texture.generateMipmaps = false;
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);
    // Fond noir opaque : le compositing additif (blend "add") du calque parent le rend neutre.
    this.scene.background = new Color(0, 0, 0);
    this.scene.add(this._system.object);
  }

  setConfig(layer: ParticlesLayer, sim: ResolvedSim): void {
    this._system.setConfig(layer, sim);
  }

  /** Jumeau à ajouter à la scène de l'éditeur 3D pour voir les particules en géométrie. */
  get viewer(): Group {
    return this._system.getViewer();
  }

  /** Dispatch du compute avant le rendu — appelé par `Engine.update`. */
  prepare(renderer: WebGPURenderer): void {
    this._system.compute(renderer);
  }

  dispose(): void {
    this._system.dispose();
    this.target.dispose();
  }
}

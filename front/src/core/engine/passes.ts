import type { WebGPURenderer } from "three/webgpu";
import type { LayerStack } from "./LayerStack.ts";

/** Une passe de rendu = un job. */
export interface RenderPass {
  render(renderer: WebGPURenderer): void;
}

/** Rend la pile de couches dans la render target du moteur. */
export class CompositePass implements RenderPass {
  constructor(private readonly _stack: LayerStack) {}

  render(renderer: WebGPURenderer): void {
    renderer.setRenderTarget(this._stack.target);
    renderer.render(this._stack.scene, this._stack.camera);
    renderer.setRenderTarget(null);
  }
}

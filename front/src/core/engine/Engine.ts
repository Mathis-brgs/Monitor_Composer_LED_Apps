import type { Texture, WebGPURenderer } from "three/webgpu";
import type { Fixture } from "@domain/Fixture.ts";
import type { Transport } from "../transport.ts";
import { LayerStack } from "./LayerStack.ts";
import { CompositePass } from "./passes.ts";
import { EhubOutput } from "./EhubOutput.ts";
import { createLayer } from "./layers/index.ts";
import { LAYER_ID, type Layer } from "./layers/Layer.ts";

/**
 * Moteur headless : compose les couches → render target 128×128 → readback →
 * state → eHuB. Tourne indépendamment de l'UI (l'envoi au mur ne s'arrête pas
 * quand on change de vue).
 */
export class Engine {
  readonly stack: LayerStack;
  private readonly _composite: CompositePass;
  private readonly _output: EhubOutput;

  constructor(
    private readonly _renderer: WebGPURenderer,
    fixture: Fixture,
    transport: Transport,
    _project: Project,
  ) {
    this.stack = new LayerStack(fixture.width, fixture.height);
    this.stack.setLayers([createLayer(LAYER_ID.PLASMA, "plasma-1")]); // contenu par défaut (provisoire)
    this._composite = new CompositePass(this.stack);
    this._output = new EhubOutput(_renderer, this.stack.target, fixture, transport);
  }

  /** remplace la pile de couches (piloté par l'éditeur). */
  setLayers(layers: Layer[]): void {
    this.stack.setLayers(layers);
  }

  /** chaque frame : fixe le temps de composition (piloté par l'horloge) et compose dans la RT */
  update(time: number): void {
    this.stack.setTime(time);
    this._composite.render(this._renderer);
  }

  /** ~40 Hz (découplé) : readback RT → eHuB → transport */
  async output(): Promise<void> {
    await this._output.tick();
  }

  /** texture de sortie (RT) — consommée par les previews */
  get texture(): Texture {
    return this.stack.target.texture;
  }
}

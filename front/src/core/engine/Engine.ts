import type { Texture, WebGPURenderer } from "three/webgpu";
import type { Fixture } from "@domain/Fixture.ts";
import type { MaterialMode } from "@domain/Layer.ts";
import type { Transport } from "../transport.ts";
import { LayerStack } from "./LayerStack.ts";
import { CompositePass } from "./passes.ts";
import { EhubOutput } from "./EhubOutput.ts";
import { MaterialBaker } from "./MaterialBaker.ts";
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
  private _nested: LayerStack[] = [];
  private readonly _materialBaker = new MaterialBaker();

  constructor(
    private readonly _renderer: WebGPURenderer,
    readonly fixture: Fixture,
    transport: Transport,
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

  /** Compositors des comps imbriquées (précomps/prérendus), ordonnés du plus profond au moins profond. */
  setNested(nested: LayerStack[]): void {
    this._nested = nested;
  }

  /** chaque frame : rend d'abord les comps imbriquées dans leurs RT, puis compose la comp active. */
  update(time: number): void {
    for (const sub of this._nested) {
      this._renderer.setRenderTarget(sub.target);
      this._renderer.render(sub.scene, sub.camera);
    }
    this._renderer.setRenderTarget(null);
    this.stack.setTime(time);
    this._composite.render(this._renderer);
  }

  /** ~40 Hz (découplé) : readback RT → eHuB → transport */
  async output(): Promise<void> {
    await this._output.tick();
  }

  /** Éteint le mur (frame noire), utilisé à la sortie du mode LIVE. */
  async blackout(): Promise<void> {
    await this._output.sendBlackout();
  }

  /** envoie la config des plages de contrôleurs au routage Go */
  async sendConfig(): Promise<void> {
    await this._output.sendConfig();
  }

  /** canaux DMX bruts courants (spots/lyres) : envoyés au prochain tick, en plus des entités LED. */
  setFixtureChannels(values: ReadonlyMap<number, number>): void {
    this._output.setFixtureChannels(values);
  }

  /** texture de sortie (RT) — consommée par les previews */
  get texture(): Texture {
    return this.stack.target.texture;
  }

  /** Bake un matériau personnalisé (fragment WGSL) en bitmap — voir `MaterialBaker`. */
  async bakeMaterial(fragment: string, mode: MaterialMode, time: number): Promise<Uint8ClampedArray | null> {
    return this._materialBaker.bake(this._renderer, fragment, mode, time);
  }
}

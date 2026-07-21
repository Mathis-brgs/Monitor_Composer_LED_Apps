import { Mesh, MeshBasicNodeMaterial, NearestFilter, OrthographicCamera, PlaneGeometry, RenderTarget, Scene, type WebGPURenderer } from "three/webgpu";
import { float, mul, uv, wgslFn } from "three/tsl";
import type { MaterialMode } from "@domain/Layer.ts";

/** Résolution du bake : alignée sur `VIDEO_SAMPLE_SIZE` (Editor.ts) et la RT du moteur (Scene3D). */
const SIZE = 128;

/**
 * Bake hors-écran d'un matériau personnalisé (fragment WGSL, via `wgslFn` de TSL) en bitmap
 * RGBA — réutilise le renderer WebGPU PARTAGÉ de l'app (voir `core/device.ts`, un seul device
 * pour tout le logiciel) : rend un quad plein cadre dans une render target dédiée puis relit
 * les pixels, exactement comme `CompositePass`/`EhubOutput` le font déjà pour la sortie mur.
 * Le bitmap résultant est ensuite consommé comme un fill `bitmap` classique (même chemin
 * qu'image/vidéo) — voir `Editor._resolveFill`.
 *
 * Contrat du fragment attendu par l'utilisateur (une seule fonction WGSL, nom libre) :
 * `fn monMateriau(uv: vec2<f32>, time: f32) -> vec3<f32> { ... }`
 *
 * Deux précautions de concurrence, car `Editor` peut demander plusieurs bakes (shapes/presets
 * différents) dans le même tick :
 * - une NOUVELLE `MeshBasicNodeMaterial` est créée à CHAQUE bake (jamais réutilisée) : sinon
 *   deux bakes qui se chevauchent réécrivent le même `colorNode` partagé pendant que l'autre
 *   attend sa compilation → cross-talk entre matériaux (symptôme observé : plusieurs shapes
 *   affichent toutes le même preset). Un fragment invalide ne peut plus "empoisonner" un
 *   matériau réutilisé non plus : l'instance ratée est jetée après l'échec.
 * - les bakes sont mis en FILE (chaînage de promesses) : `render`/`readRenderTargetPixelsAsync`
 *   partagent la même render target, donc deux bakes concurrents pourraient lire le rendu l'un
 *   de l'autre sans cette sérialisation.
 *
 * ⚠ Non vérifié en conditions réelles (aucun outil de rendu/navigateur disponible pour tester) :
 * orientation verticale du readback (même incertitude documentée dans `EhubOutput.ts`).
 */
export class MaterialBaker {
  private readonly _scene = new Scene();
  private readonly _camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
  private readonly _target: RenderTarget;
  private readonly _geometry = new PlaneGeometry(1, 1);
  private _queue: Promise<unknown> = Promise.resolve();

  constructor() {
    this._target = new RenderTarget(SIZE, SIZE, { depthBuffer: false });
    this._target.texture.minFilter = NearestFilter;
    this._target.texture.magFilter = NearestFilter;
    this._target.texture.generateMipmaps = false;
  }

  readonly size = SIZE;

  /** File le bake derrière tout bake en cours (voir avertissement de concurrence ci-dessus). */
  async bake(renderer: WebGPURenderer, fragment: string, mode: MaterialMode, time: number): Promise<Uint8ClampedArray | null> {
    const run = this._queue.then(() => this._doBake(renderer, fragment, mode, time));
    this._queue = run.then(() => undefined, () => undefined); // ne jamais casser la chaîne sur un échec
    return run;
  }

  /** Compile + rend + relit une frame avec un matériau JETABLE. `null` si le WGSL utilisateur
   *  échoue à compiler/rendre (l'appelant garde alors le dernier bitmap valide en cache). */
  private async _doBake(renderer: WebGPURenderer, fragment: string, mode: MaterialMode, time: number): Promise<Uint8ClampedArray | null> {
    const material = new MeshBasicNodeMaterial();
    const mesh = new Mesh(this._geometry, material);
    this._scene.add(mesh);
    try {
      const fn = wgslFn(fragment);
      const color = fn({ uv: uv(), time: float(time) });
      material.colorNode = mode === "emission" ? mul(color, 1.6) : color;

      // Le pipeline du colorNode doit être compilé avant le rendu : sans ça, la 1re lecture
      // après un changement de fragment peut tomber sur la render target encore vide (noire).
      await renderer.compileAsync(this._scene, this._camera);

      renderer.setRenderTarget(this._target);
      renderer.render(this._scene, this._camera);
      renderer.setRenderTarget(null);

      const rgba = (await renderer.readRenderTargetPixelsAsync(this._target, 0, 0, SIZE, SIZE)) as Uint8Array;
      return new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    } catch (err) {
      console.error("MaterialBaker: échec de compilation/rendu du fragment WGSL", err);
      return null;
    } finally {
      this._scene.remove(mesh);
      material.dispose();
    }
  }

  dispose(): void {
    this._geometry.dispose();
    this._target.dispose();
  }
}

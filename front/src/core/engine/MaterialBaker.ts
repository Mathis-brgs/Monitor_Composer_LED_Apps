import { Mesh, MeshBasicNodeMaterial, NearestFilter, OrthographicCamera, PlaneGeometry, RenderTarget, Scene, type WebGPURenderer } from "three/webgpu";
import * as TSL from "three/tsl";
import type { MaterialMode } from "@domain/Layer.ts";

/** Résolution du bake : alignée sur `VIDEO_SAMPLE_SIZE` (Editor.ts) et la RT du moteur (Scene3D). */
const SIZE = 128;

// Tout l'espace de noms TSL (uv, vec3, mul, sin, mix, mx_noise_float, …) exposé tel quel au
// fragment utilisateur : même API que Plasma.layer.ts/Sweep.layer.ts, pas un sous-ensemble
// choisi à la main — donc du "vrai" TSL, pas du WGSL brut.
const TSL_NAMES = Object.keys(TSL);
const TSL_VALUES = Object.values(TSL);

/**
 * Bake hors-écran d'un matériau personnalisé (fragment en TSL — même langage que les autres
 * calques du moteur, PAS du WGSL brut) en bitmap RGBA — réutilise le renderer WebGPU PARTAGÉ de
 * l'app (voir `core/device.ts`, un seul device pour tout le logiciel) : rend un quad plein cadre
 * dans une render target dédiée puis relit les pixels, exactement comme
 * `CompositePass`/`EhubOutput` le font déjà pour la sortie mur. Le bitmap résultant est ensuite
 * consommé comme un fill `bitmap` classique (même chemin qu'image/vidéo) — voir
 * `Editor._resolveFill`.
 *
 * Contrat du fragment attendu par l'utilisateur : un corps de fonction JS qui utilise les
 * fonctions TSL en scope (`uv()`, `vec3()`, `.mul()`, `sin()`, etc. — voir `Plasma.layer.ts`
 * pour le style) et se termine par `return` d'un node couleur (vec3/vec4). `time` (uniform TSL)
 * est aussi en scope. Exécuté via `new Function` (JS, pas eval) — mêmes implications de
 * confiance que le système de scripts envisagé plus tôt dans le projet, mais un fragment ne
 * fait QUE construire un graphe de nodes TSL, il n'a accès ni au DOM ni à l'Editor.
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

  /** Exécute le corps JS/TSL de l'utilisateur (voir contrat en tête de fichier) et renvoie le
   *  node résultant. Lève en cas d'erreur de syntaxe/exécution — laissé à l'appelant. */
  private _evalFragment(code: string, time: number): unknown {
    // eslint-disable-next-line no-new-func -- exécution volontaire du TSL saisi par l'utilisateur
    const fn = new Function(...TSL_NAMES, "time", code);
    return fn(...TSL_VALUES, TSL.float(time));
  }

  /** Compile + rend + relit une frame avec un matériau JETABLE. `null` si le TSL utilisateur
   *  échoue à s'exécuter/compiler/rendre (l'appelant garde alors le dernier bitmap valide en cache). */
  private async _doBake(renderer: WebGPURenderer, fragment: string, mode: MaterialMode, time: number): Promise<Uint8ClampedArray | null> {
    const material = new MeshBasicNodeMaterial();
    const mesh = new Mesh(this._geometry, material);
    this._scene.add(mesh);
    try {
      const color = this._evalFragment(fragment, time) as Parameters<typeof TSL.mul>[0];
      material.colorNode = (mode === "emission" ? TSL.mul(color, 1.6) : color) as never;

      // Le pipeline du colorNode doit être compilé avant le rendu : sans ça, la 1re lecture
      // après un changement de fragment peut tomber sur la render target encore vide (noire).
      await renderer.compileAsync(this._scene, this._camera);

      renderer.setRenderTarget(this._target);
      renderer.render(this._scene, this._camera);
      renderer.setRenderTarget(null);

      const rgba = (await renderer.readRenderTargetPixelsAsync(this._target, 0, 0, SIZE, SIZE)) as Uint8Array;
      return new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength);
    } catch (err) {
      console.error("MaterialBaker: échec du fragment TSL utilisateur", err);
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

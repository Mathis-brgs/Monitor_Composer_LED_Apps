import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Points,
  PointsNodeMaterial,
  Vector3,
  type ComputeNode,
  type WebGPURenderer,
} from "three/webgpu";
import * as TSL from "three/tsl";
import {
  Fn,
  clamp,
  float,
  hash,
  instanceIndex,
  instancedArray,
  mix,
  uniform,
  vec3,
  vertexIndex,
} from "three/tsl";
import { DEFAULT_PARTICLE_SIM, type ParticlesLayer, type SimParamDef } from "@domain/Layer.ts";
import type { TSLNode } from "./layers/Layer.ts";

/** Simulation résolue (code + défs de params) issue du preset référencé par le calque — voir `Editor._resolveSim`. */
export interface ResolvedSim { code: string; params: SimParamDef[]; }

const TAU = Math.PI * 2;
const MAX_DT = 0.05;   // clamp du pas de temps (lag / onglet en arrière-plan)
const FIT = 0.62;      // sim ≈ [-1.5,1.5] → tient dans le repère mur [-1,1]

// Tout l'espace de noms TSL exposé au corps de simulation utilisateur (même approche que `MaterialBaker`).
const TSL_NAMES = Object.keys(TSL);
const TSL_VALUES = Object.values(TSL);
// Variables intégrées en scope de la sim (ajoutées APRÈS les noms TSL ; doublons → le dernier gagne,
// `new Function` étant non-strict — voir `MaterialBaker`). Les params custom sont ajoutés ensuite par nom.
const SIM_BUILTINS = ["pos", "info", "time", "idx", "snoise"] as const;

/**
 * Système de particules GPU réutilisable (agnostique scène/caméra) : simulation par **compute shader TSL
 * personnalisable** (corps `sim` compilé via `new Function`, comme le `fragment` d'un material — voir
 * `MaterialBaker`) + un `Group` (`object`) contenant les `Points` additifs. Buffers `positions`/`info` en
 * `instancedArray` ; positions initialisées en anneau, `info` = données statiques par particule. Piloté en
 * temps réel interne (anime en continu).
 *
 * `getViewer()` renvoie un jumeau (mêmes buffers) pour l'éditeur 3D. `object` pour le rendu moteur (RT).
 */
export class ParticleSystem {
  readonly object = new Group();

  private readonly _sizeU = uniform(2.5);
  private readonly _elapsedU = uniform(0);
  private readonly _emitterOriginU = uniform(new Vector3());
  private readonly _colorU = uniform(new Color(1, 0.6, 0.2));
  private readonly _colorEndU = uniform(new Color(0.8, 0.1, 0.3));
  // Paramètres custom déclarés par la sim : un uniform par nom, en scope de la sim (recréés au changement de set).
  private _paramNames: string[] = [];
  private _paramU = new Map<string, ReturnType<typeof uniform>>();
  private _sig = "";

  private _init: ComputeNode | null = null;
  private _update: ComputeNode | null = null;
  private _viewer: Group | null = null;
  private _objPoints: Points | null = null;
  private _viewPoints: Points | null = null;
  private _geo: BufferGeometry | null = null;
  private _positions: ReturnType<typeof instancedArray> | null = null;

  private _sim = "";
  private _needsInit = false;
  private _lastT = 0;
  private _elapsed = 0;

  /** Jumeau à ajouter à la scène de l'éditeur 3D (mêmes buffers compute que `object`). */
  getViewer(): Group {
    if (!this._viewer) {
      this._viewer = new Group();
      if (this._geo && this._positions) {
        this._viewPoints = new Points(this._geo, this._material(this._positions));
        this._viewPoints.frustumCulled = false;
        this._viewer.add(this._viewPoints);
      }
    }
    return this._viewer;
  }

  /** Applique la config : reconstruit le compute au changement de nombre / sim / set de params ; sinon uniforms.
   *  `sim` = simulation résolue depuis le preset référencé par le calque (`Editor._resolveSim`). */
  setConfig(layer: ParticlesLayer, sim: ResolvedSim): void {
    const count = Math.max(1, Math.floor(layer.count));
    const names = sim.params.map((p) => p.name);
    const sig = `${count}|${sim.code}|${names.join(",")}`;
    if (sig !== this._sig) {
      this._sig = sig;
      this._sim = sim.code;
      this._paramNames = names;
      this._paramU = new Map(names.map((n) => [n, uniform(0)]));
      this._rebuild(count);
    }
    this._sizeU.value = layer.size;
    const defaults = new Map(sim.params.map((p) => [p.name, p.value]));
    for (const n of this._paramNames) { const u = this._paramU.get(n); if (u) u.value = layer.simValues[n] ?? defaults.get(n) ?? 0; }
    (this._emitterOriginU.value as Vector3).set(layer.transform.position.x, layer.transform.position.y, layer.transform.position.z);
    (this._colorU.value as Color).setRGB(layer.color.r, layer.color.g, layer.color.b);
    (this._colorEndU.value as Color).setRGB(layer.colorEnd.r, layer.colorEnd.g, layer.colorEnd.b);
  }

  /** Avance le temps (réel) et dispatche le compute — à appeler avant le rendu de la scène hôte. */
  compute(renderer: WebGPURenderer): void {
    const now = performance.now() / 1000;
    if (this._lastT === 0) this._lastT = now;
    const dt = Math.min(Math.max(now - this._lastT, 0), MAX_DT);
    this._lastT = now;
    this._elapsed += dt;
    this._elapsedU.value = this._elapsed;
    if (this._needsInit && this._init) {
      renderer.compute(this._init);
      this._needsInit = false;
    }
    if (this._update) renderer.compute(this._update);
  }

  dispose(): void {
    if (this._objPoints) (this._objPoints.material as PointsNodeMaterial).dispose();
    if (this._viewPoints) (this._viewPoints.material as PointsNodeMaterial).dispose();
    this._geo?.dispose();
  }

  // ————————————————————————————————— interne —————————————————————————————————

  /** (re)construit buffers + compute (init + sim utilisateur) + mesh au changement de nombre/sim. */
  private _rebuild(count: number): void {
    const positions = instancedArray(count, "vec3");
    const info = instancedArray(count, "vec3");
    this._positions = positions;

    // init : anneau r=0.5 (comme la data texture de réf) + `info` statique (x,y ∈ [0.5,1.5])
    this._init = Fn(() => {
      const idx = instanceIndex.toFloat();
      const theta = hash(idx).mul(TAU);
      positions.element(instanceIndex).assign(vec3(theta.cos().mul(0.5), theta.sin().mul(0.5), 0));
      info.element(instanceIndex).assign(vec3(hash(idx.add(11.1)).add(0.5), hash(idx.add(22.2)).add(0.5), 1));
    })().compute(count);

    // update : sim personnalisable (fallback donut si le TSL utilisateur ne compile pas)
    this._update = this._buildUpdate(this._sim, positions, info, count)
      ?? this._buildUpdate(DEFAULT_PARTICLE_SIM, positions, info, count);

    this._needsInit = true;
    this._rebuildMesh(count, positions);
  }

  /** Compile le corps de sim utilisateur en un compute (chaque particule → nouvelle position). `null` si le
   *  TSL est invalide (l'appelant retombe alors sur `DEFAULT_PARTICLE_SIM`). Voir `MaterialBaker`. */
  private _buildUpdate(
    code: string,
    positions: ReturnType<typeof instancedArray>,
    info: ReturnType<typeof instancedArray>,
    count: number,
  ): ComputeNode | null {
    try {
      // eslint-disable-next-line no-new-func -- exécution volontaire du TSL saisi par l'utilisateur (comme MaterialBaker)
      const userSim = new Function(...TSL_NAMES, ...SIM_BUILTINS, ...this._paramNames, code) as (...args: unknown[]) => TSLNode;
      return Fn(() => {
        const idx = instanceIndex.toFloat();
        const pos = positions.element(instanceIndex);
        const inf = info.element(instanceIndex);
        const params = this._paramNames.map((n) => this._paramU.get(n));
        const next = userSim(...TSL_VALUES, pos, inf, this._elapsedU, idx, TSL.mx_noise_vec3, ...params);
        positions.element(instanceIndex).assign(next);
      })().compute(count) as unknown as ComputeNode;
    } catch (err) {
      console.error("ParticleSystem: simulation TSL invalide → fallback donut", err);
      return null;
    }
  }

  /** Matériau de points additif : position = buffer (×FIT + origine) indexé par `vertexIndex` ; couleur = dégradé radial. */
  private _material(positions: ReturnType<typeof instancedArray>): PointsNodeMaterial {
    const material = new PointsNodeMaterial();
    // `instanceIndex` vaut 0 pour des Points non-instanciés → indexer par `vertexIndex` (1 sommet/particule).
    const p = positions.element(vertexIndex);
    material.positionNode = p.mul(FIT).add(this._emitterOriginU) as unknown as TSLNode;
    const rr = clamp(p.xy.length().mul(0.7), 0, 1); // centre → bord
    material.colorNode = mix(this._colorEndU, this._colorU, rr) as unknown as TSLNode;
    material.opacityNode = float(0.85) as unknown as TSLNode;
    material.sizeNode = this._sizeU as unknown as TSLNode;
    material.sizeAttenuation = false; // taille écran constante (sinon atténuation perspective en sous-pixel)
    material.transparent = true;
    material.depthTest = false;
    material.depthWrite = false;
    material.blending = AdditiveBlending;
    return material;
  }

  /** Recrée géométrie + `Points` (moteur, et jumeau viewer si présent) liés aux nouveaux buffers. */
  private _rebuildMesh(count: number, positions: ReturnType<typeof instancedArray>): void {
    if (this._objPoints) { this.object.remove(this._objPoints); (this._objPoints.material as PointsNodeMaterial).dispose(); }
    if (this._viewPoints && this._viewer) { this._viewer.remove(this._viewPoints); (this._viewPoints.material as PointsNodeMaterial).dispose(); }
    this._geo?.dispose();

    this._geo = new BufferGeometry();
    this._geo.setAttribute("position", new Float32BufferAttribute(new Float32Array(count * 3), 3));

    this._objPoints = new Points(this._geo, this._material(positions));
    this._objPoints.frustumCulled = false;
    this.object.add(this._objPoints);

    if (this._viewer) {
      this._viewPoints = new Points(this._geo, this._material(positions));
      this._viewPoints.frustumCulled = false;
      this._viewer.add(this._viewPoints);
    }
  }
}

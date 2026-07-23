import { Euler, Matrix4, Object3D, Quaternion, Vector3 } from "three/webgpu";
import type { Engine } from "./engine/Engine.ts";
import {
  makeShape, makeShaderLayer, makeSpot, makeLyre, makeAudio, makeVideo, makePrecomp, makeParticles, findLayer, findGroup, findParent, groupChildren, collectSubtreeIds,
  fixtureDmxChannels, layerActiveAt, mediaClipActiveAt, mediaSourceFrameAt, mediaFadeGain, mediaGroupActiveAt, precompActiveAt, precompChildFrame,
  defaultSimParams, defaultSimPreset, DEFAULT_PARTICLE_SIM, DEFAULT_SIM_ID,
  SPOT_DEFAULT_BASE, SPOT_CHANNEL_COUNT, LYRE_DEFAULT_BASES, LYRE_CHANNEL_COUNT,
  type Document, type Layer, type GroupLayer, type ShapeLayer, type ShaderLayer, type SpotLayer, type LyreLayer, type VideoLayer, type ParticlesLayer,
  type RGB, type Vec3, type Transform, type ShapeKind, type ShaderId, type BlendMode, type Fill, type Clip, type MediaClip, type SpotChannels, type LyreChannels,
  type MaterialPreset, type MaterialMode, type SimPreset, type SimParamDef,
} from "@domain/Layer.ts";

/** Patch de transform : chaque canal (position/rotation/échelle) partiellement modifiable. */
export interface TransformPatch { position?: Partial<Vec3>; rotation?: Partial<Vec3>; scale?: Partial<Vec3>; }

/** Outil actif de l'éditeur 3D : curseur de sélection ou l'un des trois modes de gizmo. */
export type EditorTool = "select" | "translate" | "rotate" | "scale";

/** Mode d'affichage du viewport 3D : wireframe · solide (helper seulement sur la sélection) · aucun helper. */
export type RenderMode = "wireframe" | "solid" | "none";
import { createLayer } from "./engine/layers/index.ts";
import { LAYER_ID, type Layer as EngineLayer } from "./engine/layers/Layer.ts";
import { Scene3DLayer } from "./engine/layers/Scene3D.layer.ts";
import { SolidLayer } from "./engine/layers/Solid.layer.ts";
import { VideoWallLayer } from "./engine/layers/Video.layer.ts";
import { NestedTextureLayer } from "./engine/layers/NestedTexture.layer.ts";
import { LayerStack } from "./engine/LayerStack.ts";
import { Prerender3DScene } from "./engine/Prerender3DScene.ts";
import { ParticleScene } from "./engine/ParticleScene.ts";
import type { ResolvedSim } from "./engine/ParticleSystem.ts";
import type { NestedSource } from "./engine/Engine.ts";
import { countLit, type ShapeFill, type ShapeInput } from "./engine/shapes.ts";
import { computePrerenderedFrames } from "./precomps/prerenderRegistry.ts";
import { Animator } from "./Animator.ts";
import { makeComposition, defaultPrerenderScene, partitionTracks, sampleKeyframes, type Composition, type Interp, type Track } from "@domain/Composition.ts";
import type { Clock } from "./Clock.ts";

/** Un point du chemin d'animation (motion path) : position monde du calque à un frame keyframé. */
export interface MotionPoint { frame: number; x: number; y: number; z: number; }

/** Pixels décodés d'une image (ou d'une frame vidéo) — mis en cache hors du document (non sérialisable). */
interface DecodedBitmap { data: Uint8ClampedArray; width: number; height: number; }

/** Snapshot d'historique (undo/redo) : tout ce qui définit l'état éditable. */
interface HistorySnapshot { compositions: Record<string, Composition>; nav: NavFrame[] }
/** Rafales groupées en un seul pas d'historique si elles se suivent à moins de 400ms. */
const HISTORY_DEBOUNCE_MS = 400;
/** Profondeur max de l'historique — borne la mémoire (snapshots pleins, voir `HistorySnapshot`). */
const HISTORY_LIMIT = 50;
/** Résolution de secours tant qu'une image/vidéo n'est pas encore décodée : noir
 *  (pas de flash blanc sur le vrai mur pendant le chargement) — le wireframe/helper
 *  reste visible dans l'éditeur 3D pour situer la forme en attendant. */
const FALLBACK_FILL: ShapeFill = { kind: "solid", color: { r: 0, g: 0, b: 0 } };
/** Taille d'échantillonnage d'une frame vidéo : alignée sur la résolution max du mur (128×128),
 *  sinon le rendu est visiblement pixelisé dès qu'une forme couvre une bonne partie du mur. */
const VIDEO_SAMPLE_SIZE = 128;
/** Fragment TSL par défaut d'un nouveau preset de matériau (dégradé UV simple, sert d'exemple). */
const DEFAULT_MATERIAL_FRAGMENT = `const u = uv();
return vec3(u.x, u.y, sin(time).mul(0.5).add(0.5));`;
/** Bitmap magenta plein cadre : signale un échec de bake de matériau (TSL invalide) de façon
 *  visible, plutôt qu'un noir indiscernable d'un chargement normal. */
function magentaBitmap(size: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < data.length; i += 4) { data[i] = 255; data[i + 1] = 0; data[i + 2] = 255; data[i + 3] = 255; }
  return data;
}

export type EditorListener = () => void;

/** Libellé par défaut d'une primitive créée depuis le rail. */
const SHAPE_LABEL: Record<ShapeKind, string> = {
  sphere: "Sphère", box: "Cube", cylinder: "Cylindre", cone: "Cône", plane: "Plan", torus: "Tore", triangle: "Triangle",
};

/** Un niveau de la pile de navigation de comps : quelle comp, + l'état d'édition à y restaurer. */
interface NavFrame { compId: string; groupId: string; selectedId: string | null; frame: number; }

/**
 * Renderer dédié à une comp imbriquée + le calque parent qui échantillonne sa RT.
 * Précomp (2D) : `stack` (LayerStack) + `scene3d` (raster CPU des shapes). Prérendu (3D) : `prerender`
 * (scène caméra). Exclusifs selon `Composition.kind` ; `source()` renvoie celui qui alimente la RT.
 */
interface SubRenderer {
  nested: NestedTextureLayer;
  sig: string;
  stack?: LayerStack;
  scene3d?: Scene3DLayer;
  prerender?: Prerender3DScene;
  particles?: ParticleScene;
}

/**
 * Store du document (arbre unifié) + miroir moteur. L'app le modifie ; le moteur en
 * est le reflet (uniforms + reconstruction de la pile du groupe actif). `core` agnostique
 * de l'UI ; convention subscribe/notify (compatible pont Solid `fromStore`).
 */
export class Editor {
  private readonly _listeners = new Set<EditorListener>();
  private readonly _shaderLive = new Map<string, EngineLayer>();
  private readonly _videoLive = new Map<string, EngineLayer>();
  private _scene3d: Scene3DLayer | null = null;
  private _engine: Engine | null = null;
  private _clock: Clock | null = null;   // horloge injectée : la durée suit la comp active
  private _counter = 0;
  private _tool: EditorTool = "select";
  private _viewportMode: RenderMode = "wireframe"; // mode d'affichage de l'éditeur 3D
  private _frame = 0;              // dernier frame évalué (instant courant pour l'auto-key)
  private _fps = 24;              // fps courant (mapping temporel des comps imbriquées)
  private _sceneDirty = false;     // un canal de shape a changé → 1 seul recompute par frame
  private _fixturesDirty = false;  // un canal fx (spot/lyre) a changé → 1 seul push par frame
  private _lastActiveSig = "";     // signature du set de calques actifs (clips) au dernier _push
  // compositors des comps imbriquées (précomps/prérendus), par id de comp (créés à la demande).
  private readonly _subs = new Map<string, SubRenderer>();
  private readonly _animator = new Animator((id, channel, value) => this._applyChannel(id, channel, value));

  // Compositions du projet (partagées par référence avec project.compositions).
  private _compositions: Record<string, Composition> = { main: makeComposition("main", "Composition", "main") };
  // Pile de navigation de comps (haut = contexte courant) ; snapshot d'édition à restaurer en sortie.
  private _nav: NavFrame[] = [{ compId: "main", groupId: this._compositions.main.root.id, selectedId: null, frame: 0 }];
  // Vue d'édition active : `_doc.root === activeComp().root` — tout le code d'arbre reste inchangé.
  private _doc: Document = { root: this._compositions.main.root, activeGroupId: this._compositions.main.root.id, selectedId: null };
  // Sélection multiple au niveau modèle : `_doc.selectedId` reste la sélection PRIMAIRE (Inspecteur/gizmo) ;
  // `_multi` est le set complet pour les actions groupées (précomposer, grouper, supprimer). Toujours cohérents :
  // une sélection simple = `{ selectedId }`, un `_multi` d'un seul élément.
  private _multi = new Set<string>();

  // Historique (undo/redo) : snapshots pleins de l'état éditable (compositions + navigation),
  // regroupés par rafale (debounce) — un drag continu s'annule en un seul Ctrl+Z.
  private _undoStack: HistorySnapshot[] = [];
  private _redoStack: HistorySnapshot[] = [];
  private _lastSnapshot: HistorySnapshot = this._snapshot();
  private _historyBurstOpen = false;
  private _historyTimer: ReturnType<typeof setTimeout> | null = null;
  private _restoringHistory = false; // suspend l'enregistrement pendant qu'on restaure un snapshot

  constructor() {
    this._animator.load(this._compositions.main);
  }

  // fills image/vidéo : décodage async + lecture, mis en cache hors du document (par id de shape)
  private readonly _imagePixels = new Map<string, DecodedBitmap>();
  private readonly _videoEls = new Map<string, HTMLVideoElement>();
  private _videoSampleCanvas: HTMLCanvasElement | null = null;
  // fill matériau : bitmap baké (par id de shape) — voir `_bakeMaterialFor`/`MaterialBaker`
  private readonly _materialPixels = new Map<string, DecodedBitmap>();
  // shapes en fill matériau actuellement en cours de bake — évite les bakes qui se chevauchent
  // (best-effort : on saute le tick si le précédent n'est pas fini, comme `EhubOutput._busy`)
  private readonly _materialBaking = new Set<string>();
  // fill "prerender" : séquence de bitmaps calculée une fois à l'avance (par id de shape) —
  // voir `setPrerenderedFrames`/`core/precomps/tunnelPrerendered.ts`
  private readonly _prerenderedFrames = new Map<string, Uint8ClampedArray[]>();
  // frame (index dans `_prerenderedFrames`) où la boucle démarre : les frames avant ne jouent
  // qu'une fois (intro/construction), celles à partir de là bouclent indéfiniment.
  private readonly _prerenderedLoopStart = new Map<string, number>();

  // Bibliothèque de simulations de particules : STABLE (hors `_doc`), partagée par toutes les
  // comps, sérialisée dans le projet.
  private _simulations: SimPreset[] = [defaultSimPreset()];

  // Bibliothèque de matériaux personnalisés : STABLE (hors `_doc`, même raison que `_simulations`
  // ci-dessus — vivait sur `_doc.materials` avant, réinitialisé à chaque nav entre comps ET jamais
  // sérialisé dans le projet, donc perdu au rechargement). Voir `Editor.loadMaterialPresets`/
  // `app.ts` (injection avant sauvegarde, même pattern que `listSimPresets`).
  private _materials: MaterialPreset[] = [];

  // ————————————————————————————————— Lecture —————————————————————————————————

  get rootId(): string { return this._doc.root.id; }
  get activeGroupId(): string { return this._doc.activeGroupId; }
  get selectedId(): string | null { return this._doc.selectedId; }
  /** Ids de la sélection multiple (inclut la primaire). Vide si rien de sélectionné. */
  get multiSelectedIds(): readonly string[] { return [...this._multi]; }
  get tool(): EditorTool { return this._tool; }
  get viewportMode(): RenderMode { return this._viewportMode; }

  /** enfants du groupe actif (ce qu'affichent Compositor/Scène/Editor 3D). */
  get children(): readonly Layer[] { return groupChildren(this._doc, this._doc.activeGroupId); }

  /** nœud sélectionné (n'importe où dans l'arbre). */
  get selected(): Layer | null {
    return this._doc.selectedId ? findLayer(this._doc.root, this._doc.selectedId) : null;
  }

  getDocument(): Document {
    return this._doc;
  }

  getComposition(): Composition {
    return this._animator.composition;
  }

  /** Toutes les compositions du projet (partagées par référence avec project.compositions). */
  getCompositions(): Record<string, Composition> {
    return this._compositions;
  }

  /** Injecte l'horloge : sa durée suit la comp active (reconfigurée à chaque enter/exit). */
  setClock(clock: Clock): void {
    this._clock = clock;
  }

  /** Charge tout le jeu de compositions (partagé avec le projet) et entre dans la comp principale. */
  loadCompositions(compositions: Record<string, Composition>, mainCompId: string): void {
    this._compositions = compositions;
    const main = compositions[mainCompId] ?? makeComposition(mainCompId || "main", "Composition", "main");
    if (!compositions[mainCompId]) compositions[mainCompId] = main;
    this._nav = [{ compId: mainCompId, groupId: main.root.id, selectedId: null, frame: 0 }];
    this._rehydratePrerenderedFills(compositions);
    this._enterContext(main, main.root.id, null, 0);
  }

  /**
   * Les frames d'un fill "prerender" ne sont PAS sérialisées (binaire, potentiellement
   * volumineux) — seuls `generator`/`options` le sont (voir `Fill` dans `domain/Layer.ts`). Sans
   * ce recalcul, une shape "prerender" rechargée depuis un projet resterait noire pour toujours
   * (`_prerenderedFrames` vide, jamais repeuplé). Parcourt TOUTES les comps (pas juste l'active),
   * un fill pré-rendu peut vivre dans n'importe laquelle.
   */
  private _rehydratePrerenderedFills(compositions: Record<string, Composition>): void {
    for (const comp of Object.values(compositions)) {
      for (const shape of this._collect((l): l is ShapeLayer => l.type === "shape" && l.fill.type === "prerender", comp.root)) {
        if (shape.fill.type !== "prerender" || !shape.fill.generator) continue;
        const result = computePrerenderedFrames(shape.fill.generator, shape.fill.options ?? {});
        if (!result) continue;
        this._prerenderedFrames.set(shape.id, result.frames);
        this._prerenderedLoopStart.set(shape.id, result.loopStart);
      }
    }
  }

  /** Comp courante (haut de la pile de navigation). */
  activeComp(): Composition {
    return this._compositions[this._top.compId] ?? this._compositions[Object.keys(this._compositions)[0]];
  }

  get activeCompId(): string { return this._top.compId; }

  /** Durée (frames) de la comp active — source de vérité de la règle de la timeline. */
  get activeCompDuration(): number { return this.activeComp().durationFrames; }

  /** Fil d'Ariane des comps (racine → comp courante), pour l'Outliner / la timeline. */
  get compTrail(): { id: string; name: string }[] {
    return this._nav.map((f) => ({ id: f.compId, name: this._compositions[f.compId]?.name ?? f.compId }));
  }

  private get _top(): NavFrame { return this._nav[this._nav.length - 1]; }

  // ————————————————————————————————— Moteur ——————————————————————————————————

  /** Branche le moteur : crée le calque scène3d + pousse la pile du groupe actif. */
  attach(engine: Engine): void {
    this._engine = engine;
    this._scene3d = new Scene3DLayer("scene3d");
    this._push();
  }

  // —————————————————————————————— Navigation ——————————————————————————————

  select(id: string | null): void {
    if (id && findLayer(this._doc.root, id)?.locked) return; // calque verrouillé → pas de sélection
    const multiCollapses = this._multi.size !== (id ? 1 : 0) || (id ? !this._multi.has(id) : false);
    if (id === this._doc.selectedId && !multiCollapses) return;
    this._doc.selectedId = id;
    this._multi = id ? new Set([id]) : new Set(); // une sélection simple réduit le multi à ce seul calque
    this._emit();
  }

  /** Sélection multiple (Outliner) : `ids` = set sélectionné, `primary` = sélection primaire (Inspecteur/gizmo). */
  selectMany(ids: readonly string[], primary: string | null): void {
    const usable = ids.filter((id) => !findLayer(this._doc.root, id)?.locked);
    this._multi = new Set(usable);
    this._doc.selectedId = primary && this._multi.has(primary) ? primary : (usable.length ? usable[usable.length - 1] : null);
    this._emit();
  }

  /** Outil actif (curseur / gizmo). Partagé par le rail et l'éditeur 3D. */
  setTool(tool: EditorTool): void {
    if (tool === this._tool) return;
    this._tool = tool;
    this._emit();
  }

  /** Mode d'affichage du viewport 3D (wireframe / solide / aucun helper). */
  setViewportMode(mode: RenderMode): void {
    if (mode === this._viewportMode) return;
    this._viewportMode = mode;
    this._emit();
  }

  /** Fait défiler les modes d'affichage du viewport 3D. */
  cycleViewportMode(): void {
    const order: RenderMode[] = ["wireframe", "solid", "none"];
    this.setViewportMode(order[(order.indexOf(this._viewportMode) + 1) % order.length]);
  }

  /** Une propriété (canal) est-elle animée ? (état du diamant inspecteur) */
  isAnimated(id: string, channel: string): boolean {
    return this._animator.isAnimated(id, channel);
  }

  /**
   * Active/désactive l'animation d'une propriété (groupe de canaux). Si au moins un
   * canal est animé → tout supprimer ; sinon → créer une track par canal avec une
   * clé = valeur courante, au frame courant.
   */
  toggleAnimated(id: string, channels: string[]): void {
    const anyOn = channels.some((c) => this._animator.isAnimated(id, c));
    for (const c of channels) {
      if (anyOn) this._animator.removeChannel(id, c);
      else this._animator.addChannel(id, c, this._frame, this._readChannel(id, c) ?? 0);
    }
    this._emit();
  }

  /** Déplace une clé (dope sheet). */
  moveKeyframe(id: string, channel: string, from: number, to: number): void {
    this._animator.moveKey(id, channel, from, to);
    this._emit();
  }

  /** Supprime une clé (dope sheet). */
  removeKeyframe(id: string, channel: string, frame: number): void {
    this._animator.removeKey(id, channel, frame);
    this._emit();
  }

  /** Pose une clé au frame donné sur un canal déjà animé (valeur = valeur courante). */
  addKeyframeAt(id: string, channel: string, frame: number): void {
    if (!this._animator.isAnimated(id, channel)) return;
    this._animator.autoKey(id, channel, frame, this._readChannel(id, channel) ?? 0);
    this._emit();
  }

  /** Fixe la valeur d'une clé existante (édition spatiale d'un point du motion path). No-op si le canal n'est pas animé. */
  setKeyframeValue(id: string, channel: string, frame: number, value: number): void {
    if (!this._animator.isAnimated(id, channel)) return;
    this._animator.autoKey(id, channel, frame, value);
    const layer = findLayer(this._doc.root, id);
    if (layer?.type === "shape") this._recomputeScene();
    this._emit();
  }

  /** Valeur courante d'un canal (valeur évaluée au frame courant) — pour l'affichage dans les pistes. */
  readChannel(id: string, channel: string): number | undefined {
    return this._readChannel(id, channel);
  }

  /**
   * Édite la valeur d'un canal depuis les pistes : route vers le setter dédié (qui gère la
   * valeur statique ET l'auto-key si la propriété est animée).
   */
  setChannelValue(id: string, channel: string, value: number): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    if (channel === "opacity") { this.setOpacity(id, value); return; }
    if (channel === "gain") { this.setAudioGain(id, value); return; }
    const dot = channel.indexOf(".");
    const group = channel.slice(0, dot);
    const key = channel.slice(dot + 1);
    if (group === "position" || group === "rotation" || group === "scale") {
      this.setTransform(id, { [group]: { [key]: value } } as TransformPatch);
    } else if (group === "param") {
      this.setParam(id, key, value);
    } else if (group === "simParam") {
      this.setParticleSimParam(id, key, value);
    } else if (group === "color") {
      if (layer.type === "shader") this.setColor(id, { ...layer.color, [key]: value } as RGB);
      else if (layer.type === "shape" && layer.fill.type === "solid") this.setFill(id, { type: "solid", color: { ...layer.fill.color, [key]: value } as RGB });
    } else if (group === "fx") {
      if (layer.type === "spot") this.setSpotChannels(id, { [key]: Math.round(value) } as Partial<SpotChannels>);
      else if (layer.type === "lyre") this.setLyreChannels(id, { [key]: Math.round(value) } as Partial<LyreChannels>);
    }
  }

  /** Valeur d'une clé (canal, frame) — undefined si absente. Pour l'édition de valeur dans la timeline. */
  keyframeValue(id: string, channel: string, frame: number): number | undefined {
    return this._keyframe(id, channel, frame)?.value;
  }

  /** Interpolation d'une clé (canal, frame) — undefined si absente. */
  keyframeInterp(id: string, channel: string, frame: number): Interp | undefined {
    return this._keyframe(id, channel, frame)?.interp;
  }

  /** Point de contrôle d'une clé Bézier (canal, frame) — undefined si absente. */
  keyframeCP(id: string, channel: string, frame: number): readonly [number, number, number, number] | undefined {
    return this._keyframe(id, channel, frame)?.cp;
  }

  /** Change l'interpolation d'une clé (linéaire / hold / bézier). */
  setKeyframeInterp(id: string, channel: string, frame: number, interp: Interp, cp?: readonly [number, number, number, number]): void {
    this._animator.setInterp(id, channel, frame, interp, cp);
    const layer = findLayer(this._doc.root, id);
    if (layer?.type === "shape") this._recomputeScene();
    this._emit();
  }

  /** Pose une clé complète (valeur + interp) sur un canal, créant la track au besoin (pour le coller). */
  putKeyframe(id: string, channel: string, frame: number, value: number, interp: Interp, cp?: readonly [number, number, number, number]): void {
    this._animator.putKey(id, channel, frame, value, interp, cp);
    const layer = findLayer(this._doc.root, id);
    if (layer?.type === "shape") this._recomputeScene();
    this._emit();
  }

  /** Pose un grand nombre de clés d'un coup (génération procédurale, ex. précompositions) sans
   *  recalculer la scène ni notifier à chaque clé — `putKeyframe` fait les deux à CHAQUE appel,
   *  ce qui gèle l'app au-delà de quelques centaines d'appels (rastérisation 3D + re-render UI
   *  par clé — déjà rencontré avec un générateur précédent). */
  putKeyframesBulk(entries: readonly { id: string; channel: string; frame: number; value: number; interp: Interp }[]): void {
    let touchedShape = false;
    for (const e of entries) {
      this._animator.putKey(e.id, e.channel, e.frame, e.value, e.interp);
      if (!touchedShape && findLayer(this._doc.root, e.id)?.type === "shape") touchedShape = true;
    }
    if (touchedShape) this._recomputeScene();
    this._emit();
  }

  private _keyframe(id: string, channel: string, frame: number) {
    const t = this._animator.composition.tracks.find((t) => t.layerId === id && t.channel === channel);
    return t?.keyframes.find((k) => k.frame === frame);
  }

  /**
   * Chemin d'animation (motion path) d'un calque : la position monde échantillonnée à chaque
   * frame keyframé de position.x/y/z. Vide si aucun de ces canaux n'est animé.
   */
  motionPath(id: string): MotionPoint[] {
    const tracks = this._animator.composition.tracks;
    const track = (channel: string): Track | undefined => tracks.find((t) => t.layerId === id && t.channel === channel);
    const tx = track("position.x");
    const ty = track("position.y");
    const tz = track("position.z");
    if (!tx && !ty && !tz) return [];
    const frames = new Set<number>();
    for (const t of [tx, ty, tz]) if (t) for (const k of t.keyframes) frames.add(k.frame);
    const layer = findLayer(this._doc.root, id);
    const base = layer?.transform.position ?? { x: 0, y: 0, z: 0 };
    const at = (t: Track | undefined, fallback: number, frame: number): number =>
      t && t.keyframes.length ? sampleKeyframes(t.keyframes, frame) : fallback;
    return [...frames].sort((a, b) => a - b).map((frame) => ({
      frame, x: at(tx, base.x, frame), y: at(ty, base.y, frame), z: at(tz, base.z, frame),
    }));
  }

  /** Entre dans une comp imbriquée (précomp/prérendu) : bascule vue + animation + horloge. */
  enterComp(compId: string): void {
    const comp = this._compositions[compId];
    if (!comp || compId === this._top.compId) return;
    if (this._nav.some((f) => f.compId === compId)) return; // anti-cycle : déjà dans la pile
    this._snapshotTop();
    this._nav.push({ compId, groupId: comp.root.id, selectedId: null, frame: 0 });
    this._enterContext(comp, comp.root.id, null, 0);
  }

  /** Remonte d'un niveau de comp (restaure l'état d'édition du parent). No-op à la racine. */
  exitComp(): void {
    if (this._nav.length <= 1) return;
    this._nav.pop();
    const t = this._top;
    this._enterContext(this._compositions[t.compId], t.groupId, t.selectedId, t.frame);
  }

  /** Entre dans la comp référencée par un calque precomp (no-op si le calque n'en est pas un). */
  enterCompOf(layerId: string): void {
    const l = findLayer(this._doc.root, layerId);
    if (l?.type === "precomp") this.enterComp(l.compId);
  }

  /** Remonte jusqu'à une comp donnée du fil d'Ariane (clic sur un ancêtre). */
  exitToComp(compId: string): void {
    if (compId === this._top.compId || !this._nav.some((f) => f.compId === compId)) return;
    while (this._nav.length > 1 && this._top.compId !== compId) this._nav.pop();
    const t = this._top;
    this._enterContext(this._compositions[t.compId], t.groupId, t.selectedId, t.frame);
  }

  private _snapshotTop(): void {
    const t = this._top;
    t.groupId = this._doc.activeGroupId;
    t.selectedId = this._doc.selectedId;
    if (this._clock) t.frame = this._clock.frame;
  }

  /** Bascule la vue active vers une comp : arbre + animation + durée d'horloge + playhead. */
  private _enterContext(comp: Composition, groupId: string, selectedId: string | null, frame: number): void {
    this._doc = { root: comp.root, activeGroupId: findGroup(comp.root, groupId) ? groupId : comp.root.id, selectedId };
    this._animator.load(comp);
    this._clock?.configure({ durationFrames: comp.durationFrames });
    this._clock?.seekFrame(frame);
    this._push();
    this._emit();
  }

  deleteLayer(id: string): void {
    const parent = findParent(this._doc.root, id);
    if (!parent) return;

    const idx = parent.children.findIndex((c) => c.id === id);
    if (idx !== -1) {
      parent.children.splice(idx, 1);
      
      // Libérer le calque shader du cache en RAM
      this._shaderLive.delete(id);
      this._animator.dropLayer(id);
      this._prerenderedFrames.delete(id); // séquence pré-rendue potentiellement volumineuse (N frames × 128×128×4)
      this._prerenderedLoopStart.delete(id);
      
      // Si la couche supprimée était sélectionnée, on réinitialise la sélection
      if (this._doc.selectedId === id) {
        this._doc.selectedId = null;
      }
      
      this._push();
      this._emit();
    }
  }

  deleteSelected(): void {
    const ids = this._multi.size ? [...this._multi] : (this._doc.selectedId ? [this._doc.selectedId] : []);
    for (const id of ids) this.deleteLayer(id);
    this._multi = new Set();
  }

  /** Duplique le calque sélectionné (sous-arbre + ses tracks), inséré après l'original, puis le sélectionne. */
  duplicateSelected(): string | null {
    const sel = this.selected;
    if (!sel) return null;
    const parent = findParent(this._doc.root, sel.id);
    if (!parent) return null;
    const idx = parent.children.findIndex((c) => c.id === sel.id);
    if (idx === -1) return null;

    const idMap = new Map<string, string>();
    const copy = this._cloneLayer(sel, idMap);

    // dupliquer les tracks du sous-arbre, ré-adressées vers les nouveaux ids
    const active = this.activeComp();
    const extra: Track[] = active.tracks
      .filter((t) => idMap.has(t.layerId))
      .map((t) => ({ layerId: idMap.get(t.layerId)!, channel: t.channel, keyframes: t.keyframes.map((k) => ({ ...k })) }));
    active.tracks = [...active.tracks, ...extra];

    parent.children.splice(idx + 1, 0, copy);
    this._doc.selectedId = copy.id;
    this._push();
    this._emit();
    return copy.id;
  }

  /** Clone profond d'un calque avec de nouveaux ids (récursif pour les groupes) ; remplit `idMap` (ancien→nouveau). */
  private _cloneLayer(layer: Layer, idMap: Map<string, string>): Layer {
    const copy = structuredClone(layer) as Layer;
    const reassign = (l: Layer): void => {
      this._counter += 1;
      const nid = `${l.type}-${this._counter}`;
      idMap.set(l.id, nid); // l.id = ancien id (préservé par le clone) → nouveau
      l.id = nid;
      if (l.type === "group") for (const c of l.children) reassign(c);
    };
    reassign(copy);
    copy.name = layer.name + " copie";
    return copy;
  }

  duplicateLayer(id: string): string | null {
    const layer = findLayer(this._doc.root, id);
    const parent = findParent(this._doc.root, id);
    if (!layer || !parent) return null;

    const clone = structuredClone(layer) as typeof layer;
    this._counter++;
    clone.id = `${layer.type}-copy-${this._counter}`;
    clone.name = `${layer.name} (copie)`;

    const idx = parent.children.findIndex((c) => c.id === id);
    if (idx !== -1) {
      parent.children.splice(idx + 1, 0, clone);
      this._animator.cloneLayer(id, clone.id);
      this._push();
      this._emit();
      return clone.id;
    }
    return null;
  }

  /**
   * Coupe un calque en deux au frame donné (façon "Split Layer" AE, ⌘⇧D) : duplique le calque
   * ET ses clés d'animation, l'original garde `[in, frame-1]`, le clone `[frame, out]`.
   * Non applicable aux groupes ni aux calques média (audio/vidéo ont leur propre rasoir sur
   * les `MediaClip` — voir `Layer.ts` `splitMediaClip`). Renvoie `false` en no-op (hors bornes,
   * verrouillé, type non supporté) pour que l'appelant sache que rien n'a été coupé.
   */
  splitLayer(id: string, frame: number, durationFrames: number): boolean {
    const layer = findLayer(this._doc.root, id);
    const parent = findParent(this._doc.root, id);
    if (!layer || !parent || layer.locked) return false;
    if (layer.type === "group" || layer.type === "audio" || layer.type === "video") return false;
    const clip = layer.clip ?? { in: 0, out: durationFrames };
    const f = Math.round(frame);
    if (f <= clip.in || f > clip.out) return false;

    this._counter += 1;
    const clone = structuredClone(layer) as typeof layer;
    clone.id = `${layer.type}-split-${this._counter}`;
    clone.name = `${layer.name} (2)`;
    clone.clip = { in: f, out: clip.out };
    layer.clip = { in: clip.in, out: f - 1 };

    this._animator.cloneLayer(id, clone.id);

    const idx = parent.children.findIndex((c) => c.id === id);
    parent.children.splice(idx + 1, 0, clone);

    this._doc.selectedId = clone.id;
    this._push();
    this._emit();
    return true;
  }

  // ———————————————————————————————— Création ————————————————————————————————

  addShape(kind: ShapeKind): string {
    this._counter += 1;
    const n = String(this._counter).padStart(2, "0");
    const shape = makeShape(`${kind}-${this._counter}-${n}`, kind, `${SHAPE_LABEL[kind]} ${n}`);
    // pose décalée pour éviter le recouvrement
    shape.transform = {
      position: {
        x: ((this._counter % 3) - 1) * 0.32,
        y: ((Math.floor(this._counter / 3) % 3) - 1) * 0.3,
        z: 0,
      },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0.3, y: 0.3, z: 0.3 },
    };
    shape.fill = { type: "solid", color: { r: 1, g: 0.541, b: 0.239 } };
    this._activeGroup().children.push(shape);
    this._doc.selectedId = shape.id;
    this._push();
    this._emit();
    return shape.id;
  }

  addShaderLayer(shader: ShaderId): string {
    this._counter += 1;
    const id = `${shader}-${this._counter}`;
    const label = shader === "solid" ? "Couleur unie" : shader === "plasma" ? "Plasma" : "Balayage";
    const layer = makeShaderLayer(id, shader, label);
    this._activeGroup().children.unshift(layer); // ajouté au-dessus
    this._doc.selectedId = id;
    this._push();
    this._emit();
    return id;
  }

  /**
   * Calques cibles d'une précomposition : les frères sélectionnés du parent de la sélection primaire,
   * en ordre d'arbre. Gère la sélection multiple (`_multi`) et la simple. Une sélection éparse sur
   * plusieurs parents est réduite au parent de la primaire (comme After Effects).
   */
  private _siblingTargets(): { parent: GroupLayer; ordered: Layer[]; idx: number } | null {
    const ids = this._multi.size ? [...this._multi] : (this._doc.selectedId ? [this._doc.selectedId] : []);
    const primary = this.selected ?? (ids[0] ? findLayer(this._doc.root, ids[0]) : null);
    if (!primary) return null;
    const parent = findParent(this._doc.root, primary.id);
    if (!parent) return null; // la racine ne se précompose/groupe pas
    const set = new Set(ids);
    const ordered = parent.children.filter((c) => set.has(c.id));
    if (ordered.length === 0) return null;
    const idx = parent.children.findIndex((c) => c.id === ordered[0].id);
    return { parent, ordered, idx };
  }

  /**
   * Précompose la sélection (un ou plusieurs calques frères) : les déplace avec leurs sous-arbres + tracks
   * dans une nouvelle composition, remplacés à leur place par une seule instance de précomp. Renvoie l'id.
   */
  precomposeSelection(): string | null {
    const t = this._siblingTargets();
    if (!t) return null;
    const { parent, ordered, idx } = t;

    this._counter += 1;
    const compId = `precomp-${this._counter}`;
    const name = `Précomp ${String(this._counter).padStart(2, "0")}`;
    const comp = makeComposition(compId, name, "precomp", { durationFrames: this.activeComp().durationFrames });

    // déplacer les calques (sous-arbres inclus, ordre préservé) dans la nouvelle comp
    for (const l of ordered) parent.children.splice(parent.children.findIndex((c) => c.id === l.id), 1);
    comp.root.children.push(...ordered);

    // repartitionner les tracks : union des sous-arbres de tous les calques déplacés
    const movedIds = new Set<string>();
    for (const l of ordered) for (const id of collectSubtreeIds(l)) movedIds.add(id);
    const active = this.activeComp();
    const { inside, outside } = partitionTracks(active.tracks, movedIds);
    comp.tracks = inside;
    active.tracks = outside;

    this._compositions[compId] = comp;

    // une seule instance à la place des calques, sélectionnée
    const inst = makePrecomp(`${compId}-inst`, name, compId);
    parent.children.splice(Math.min(idx, parent.children.length), 0, inst);
    this.select(inst.id);

    this._push();
    this._emit();
    return compId;
  }

  /** Ajoute une précomposition vide + son instance dans le groupe actif. */
  addPrecomp(): string {
    this._counter += 1;
    const compId = `precomp-${this._counter}`;
    const name = `Précomp ${String(this._counter).padStart(2, "0")}`;
    this._compositions[compId] = makeComposition(compId, name, "precomp", { durationFrames: this.activeComp().durationFrames });
    const inst = makePrecomp(`${compId}-inst`, name, compId);
    this._activeGroup().children.unshift(inst);
    this._doc.selectedId = inst.id;
    this._push();
    this._emit();
    return inst.id;
  }

  /** Ajoute un prérendu (composition kind "prerender" + scène 3D par défaut) + son instance. */
  addPrerender(): string {
    this._counter += 1;
    const compId = `prerender-${this._counter}`;
    const name = `Prérendu ${String(this._counter).padStart(2, "0")}`;
    this._compositions[compId] = makeComposition(compId, name, "prerender", {
      durationFrames: this.activeComp().durationFrames,
      scene: defaultPrerenderScene(),
    });
    const inst = makePrecomp(`${compId}-inst`, name, compId);
    this._activeGroup().children.unshift(inst);
    this._doc.selectedId = inst.id;
    this._push();
    this._emit();
    return inst.id;
  }

  /** Ajoute un système de particules (simulé sur GPU, composité en additif) dans le groupe actif. */
  addParticles(): string {
    this._counter += 1;
    const n = String(this._counter).padStart(2, "0");
    const layer = makeParticles(`particles-${this._counter}`, `Particules ${n}`);
    this._activeGroup().children.unshift(layer);
    this._doc.selectedId = layer.id;
    this._push();
    this._emit();
    return layer.id;
  }

  /** Modifie le nombre ou la taille d'un système de particules. */
  setParticleParam(id: string, key: "count" | "size", value: number): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || layer.type !== "particles") return;
    layer[key] = key === "count" ? Math.max(1, Math.round(value)) : value;
    this._push();
    this._emit();
  }

  /** Change une couleur (bord / centre) d'un système de particules. */
  setParticleColor(id: string, which: "color" | "colorEnd", rgb: RGB): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || layer.type !== "particles") return;
    layer[which] = rgb;
    this._push();
    this._emit();
  }

  /** Relie un calque à un preset de simulation : réinitialise ses `simValues` aux défauts du preset. */
  setParticleSimId(id: string, simId: string): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || layer.type !== "particles") return;
    const preset = this._simulations.find((p) => p.id === simId) ?? this._simulations[0];
    layer.simId = preset.id;
    const values: Record<string, number> = {};
    for (const p of preset.params) values[p.name] = p.value;
    layer.simValues = values;
    this._push();
    this._emit();
  }

  /** Valeur courante d'un paramètre du preset sur ce calque (en direct + auto-key `simParam.<name>` si animé). */
  setParticleSimParam(id: string, name: string, value: number): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || layer.type !== "particles") return;
    layer.simValues = { ...layer.simValues, [name]: value };
    this._push();
    if (this._animator.autoKey(id, "simParam." + name, this._frame, value)) { /* clé posée */ }
    this._emit();
  }

  // ————————————————————————————————— Simulations (bibliothèque) —————————————————————————————————

  /** Bibliothèque de simulations de particules (presets réutilisables entre calques, toutes comps confondues). */
  listSimPresets(): readonly SimPreset[] {
    return this._simulations;
  }

  /** Charge la bibliothèque (depuis un projet) ; garantit toujours la présence du preset donut par défaut. */
  loadSimPresets(presets: readonly SimPreset[] | undefined): void {
    const list = (presets ?? []).map((p) => ({ ...p, params: p.params.map((q) => ({ ...q })) }));
    if (!list.some((p) => p.id === DEFAULT_SIM_ID)) list.unshift(defaultSimPreset());
    this._simulations = list;
    this._emit();
  }

  /** Crée un nouveau preset de simulation (fichier réutilisable). Renvoie son id. */
  addSimPreset(name: string, code = DEFAULT_PARTICLE_SIM, params: SimParamDef[] = defaultSimParams()): string {
    this._counter += 1;
    const id = `sim-${this._counter}`;
    this._simulations = [...this._simulations, { id, name, code, params: params.map((p) => ({ ...p })) }];
    this._emit();
    return id;
  }

  /** Importe un preset depuis du code TSL (fichier) — sans params (l'utilisateur les déclare ensuite). */
  importSimPreset(name: string, code: string): string {
    return this.addSimPreset(name, code, []);
  }

  /** Édite un preset (nom/code/params). Les calques qui le référencent recompilent au prochain tick ;
   *  un changement de params réconcilie leurs `simValues` (défaut pour les nouveaux, purge des retirés). */
  updateSimPreset(id: string, patch: Partial<Omit<SimPreset, "id">>): void {
    const idx = this._simulations.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const updated: SimPreset = { ...this._simulations[idx], ...patch };
    this._simulations = this._simulations.map((p, i) => (i === idx ? updated : p));
    if (patch.params) this._reconcileSimValues(updated);
    this._push();
    this._emit();
  }

  /** Déclare un nouveau paramètre custom (nom unique) sur un preset — recompile ; sème sa valeur sur les calques. */
  addSimParam(presetId: string, name: string, value = 1, min = 0, max = 5): void {
    const preset = this._simulations.find((p) => p.id === presetId);
    if (!preset || !name || preset.params.some((p) => p.name === name)) return;
    this.updateSimPreset(presetId, { params: [...preset.params, { name, value, min, max }] });
  }

  /** Modifie les bornes/valeur par défaut d'un paramètre déclaré d'un preset. */
  updateSimParam(presetId: string, name: string, patch: Partial<{ min: number; max: number; value: number }>): void {
    const preset = this._simulations.find((p) => p.id === presetId);
    if (!preset) return;
    this.updateSimPreset(presetId, { params: preset.params.map((p) => (p.name === name ? { ...p, ...patch } : p)) });
  }

  /** Supprime un paramètre déclaré d'un preset — recompile ; retire sa valeur des calques. */
  removeSimParam(presetId: string, name: string): void {
    const preset = this._simulations.find((p) => p.id === presetId);
    if (!preset) return;
    this.updateSimPreset(presetId, { params: preset.params.filter((p) => p.name !== name) });
  }

  /** Résout le preset référencé par un calque (retombe sur le donut par défaut si l'id est inconnu). */
  private _resolveSim(layer: ParticlesLayer): ResolvedSim {
    const preset = this._simulations.find((p) => p.id === layer.simId) ?? this._simulations[0];
    return { code: preset.code, params: preset.params };
  }

  /** Aligne les `simValues` de tous les calques (toutes comps) référençant ce preset sur ses params :
   *  conserve les valeurs existantes, sème le défaut des nouveaux, purge les params retirés. */
  private _reconcileSimValues(preset: SimPreset): void {
    for (const comp of Object.values(this._compositions)) {
      for (const layer of this._collect((l): l is ParticlesLayer => l.type === "particles" && l.simId === preset.id, comp.root)) {
        const values: Record<string, number> = {};
        for (const p of preset.params) values[p.name] = layer.simValues[p.name] ?? p.value;
        layer.simValues = values;
      }
    }
  }

  /** Ajoute une piste audio (asset déjà décodé). `sourceFrames` = longueur de la source →
   *  un clip de montage couvrant toute la source. Non rendue sur le mur → pas de `_push`. */
  addAudio(assetId: string, name = "Piste audio", sourceFrames = 1): string {
    this._counter += 1;
    const id = `audio-${this._counter}`;
    const layer = makeAudio(id, name, assetId);
    layer.clips = [{ id: `${id}-c0`, sourceIn: 0, sourceOut: Math.max(1, Math.round(sourceFrames)), timelineIn: 0, speed: 1 }];
    this._activeGroup().children.unshift(layer);
    this._doc.selectedId = id;
    this._emit();
    return id;
  }

  /** Remplace la liste de clips de montage d'une piste audio (le montage est calculé côté UI
   *  via les ops pures `moveMediaClip`/`trimMediaIn|Out`/`splitMediaClip`). */
  setAudioClips(id: string, clips: MediaClip[]): void {
    const l = findLayer(this._doc.root, id);
    if (l?.type !== "audio") return;
    l.clips = clips;
    this._emit();
  }

  /** Volume d'une piste audio (gain ≥ 0). Auto-key si le volume est animé. Non rendu sur le mur → pas de `_push`. */
  setAudioGain(id: string, gain: number): void {
    const l = findLayer(this._doc.root, id);
    if (l?.type !== "audio") return;
    l.gain = Math.max(0, gain);
    this._animator.autoKey(id, "gain", this._frame, l.gain);
    this._emit();
  }

  /** Ajoute une vidéo plein-cadre diffusée sur le mur (`url` = object/data URL).
   *  `sourceFrames` = longueur de la source → un clip de montage couvrant toute la source. */
  addVideo(url: string, name = "Vidéo", sourceFrames = 1): string {
    this._counter += 1;
    const id = `video-${this._counter}`;
    const layer = makeVideo(id, name, url);
    layer.clips = [{ id: `${id}-c0`, sourceIn: 0, sourceOut: Math.max(1, Math.round(sourceFrames)), timelineIn: 0, speed: 1 }];
    this._activeGroup().children.unshift(layer);
    this._doc.selectedId = id;
    this._push();
    this._emit();
    return id;
  }

  /** Remplace la liste de clips de montage d'un calque vidéo (montage calculé côté UI). */
  setVideoClips(id: string, clips: MediaClip[]): void {
    const l = findLayer(this._doc.root, id);
    if (l?.type !== "video") return;
    l.clips = clips;
    this._push(); // re-gate le rendu (fenêtre active des clips)
    this._emit();
  }

  /** Durée de la source vidéo en frames (depuis l'élément décodé), 0 si inconnue. */
  videoDurationFrames(id: string, fps: number): number {
    const el = this._videoEls.get(id);
    return el && el.duration && isFinite(el.duration) ? Math.round(el.duration * fps) : 0;
  }

  /**
   * Nombre de spots/lyres illimité côté éditeur : le canal de base est juste une
   * suggestion de départ (doc prof), toujours modifiable ensuite (voir
   * `setFixtureBaseChannel`) si le patch DMX réel change — et supprimable comme
   * n'importe quel calque (`deleteLayer`/`deleteSelected`).
   */
  addSpot(): string {
    this._counter += 1;
    const base = this._nextFreeChannel(SPOT_CHANNEL_COUNT, SPOT_DEFAULT_BASE);
    const spot = makeSpot(`spot-${this._counter}`, "Projecteur", base);
    this._activeGroup().children.unshift(spot);
    this._doc.selectedId = spot.id;
    this._push();
    this._emit();
    return spot.id;
  }

  addLyre(): string {
    this._counter += 1;
    const existing = this._collect<LyreLayer>((l): l is LyreLayer => l.type === "lyre").length;
    const suggestion = LYRE_DEFAULT_BASES[existing] ?? LYRE_DEFAULT_BASES[LYRE_DEFAULT_BASES.length - 1];
    const base = this._nextFreeChannel(LYRE_CHANNEL_COUNT, suggestion);
    const lyre = makeLyre(`lyre-${this._counter}`, `Lyre ${existing + 1}`, base);
    this._activeGroup().children.unshift(lyre);
    this._doc.selectedId = lyre.id;
    this._push();
    this._emit();
    return lyre.id;
  }

  /** Reconfigure le canal DMX de base d'un spot/lyre (si le patch réel change de câblage/adressage). */
  setFixtureBaseChannel(id: string, baseChannel: number): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || (layer.type !== "spot" && layer.type !== "lyre")) return;
    layer.baseChannel = Math.max(1, Math.round(baseChannel));
    this._pushFixtures();
    this._emit();
  }

  /** Réordonne un calque par glisser-déposer dans l'Outliner (avant/après une cible, même parent). */
  moveLayer(draggedId: string, targetId: string, relativePos: "before" | "after"): void {
    if (draggedId === targetId) return;

    const parent = findParent(this._doc.root, draggedId);
    if (!parent) return;

    const draggedIdx = parent.children.findIndex((c) => c.id === draggedId);
    if (draggedIdx === -1) return;

    const targetIdx = parent.children.findIndex((c) => c.id === targetId);
    if (targetIdx === -1) return;

    const [layer] = parent.children.splice(draggedIdx, 1);
    let newIdx = parent.children.findIndex((c) => c.id === targetId);
    if (relativePos === "after") {
      newIdx += 1;
    }

    parent.children.splice(newIdx, 0, layer);
    this._push();
    this._emit();
  }

  // ———————————————————————————————— Mutation ————————————————————————————————

  setVisible(id: string, visible: boolean): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    layer.visible = visible;
    this._push();
    this._emit();
  }

  setOpacity(id: string, opacity: number): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    layer.opacity = opacity;
    const live = this._shaderLive.get(id);
    if (live) live.opacity = opacity;
    if (layer.type === "shape") this._recomputeScene(); // opacité LED = luminosité (temps réel)
    this._animator.autoKey(id, "opacity", this._frame, opacity);
    this._emit();
  }

  setBlend(id: string, blend: BlendMode): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    layer.blend = blend;
    this._push();
    this._emit();
  }

  /** Fenêtre d'activité (clip) d'un calque, en frames. Le bornage/matérialisation se fait côté UI (helpers purs). */
  setClip(id: string, clip: Clip): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    layer.clip = clip;
    this._push();
    this._emit();
  }

  /** Retire le clip d'un calque (retour pleine durée). */
  clearClip(id: string): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || !layer.clip) return;
    delete layer.clip;
    this._push();
    this._emit();
  }

  /** Solo : si ≥ 1 calque du groupe est en solo, seuls les solos rendent (mur + DMX). */
  setSolo(id: string, solo: boolean): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    layer.solo = solo || undefined;
    this._push();
    this._emit();
  }

  /** Association « groupé sous un média » : le calque n'est actif que dans la fenêtre du média parent. */
  setMediaGroup(id: string, mediaGroupId: string | undefined): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    layer.mediaGroupId = mediaGroupId || undefined;
    this._push();
    this._emit();
  }

  /** Verrou : le calque devient non sélectionnable / non éditable (désélectionné s'il l'était). */
  setLocked(id: string, locked: boolean): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    layer.locked = locked || undefined;
    if (locked && this._doc.selectedId === id) this._doc.selectedId = null;
    this._emit();
  }

  /** Couleur de label (hex) d'un calque, ou undefined pour l'enlever. */
  setLabel(id: string, color: string | undefined): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    layer.label = color || undefined;
    this._emit();
  }

  /** Transform monde d'un calque. Sans parenting = transform local (normalisé via quaternion). */
  worldTransform(id: string): Transform {
    const p = new Vector3(), q = new Quaternion(), s = new Vector3();
    this._worldMatrix(id).decompose(p, q, s);
    const e = new Euler().setFromQuaternion(q, "XYZ");
    return { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: e.x, y: e.y, z: e.z }, scale: { x: s.x, y: s.y, z: s.z } };
  }

  /** Écrit un transform exprimé en monde (= local sans parenting). Pour le gizmo. */
  setWorldTransform(id: string, world: Transform): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    const p = new Vector3(), q = new Quaternion(), s = new Vector3();
    this._matrixOf(world).decompose(p, q, s);
    const e = new Euler().setFromQuaternion(q, "XYZ");
    this.setTransform(id, { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: e.x, y: e.y, z: e.z }, scale: { x: s.x, y: s.y, z: s.z } });
  }

  /** Paramètre d'effet en direct (uniform) — n'émet pas (seuls canvas + contrôle réagissent). */
  setParam(id: string, key: string, value: number): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || layer.type !== "shader") return;
    layer.params[key] = value;
    this._shaderLive.get(id)?.setParam(key, value);
    if (this._animator.autoKey(id, "param." + key, this._frame, value)) this._emit();
  }

  setTransform(id: string, patch: TransformPatch): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    const t = layer.transform;
    layer.transform = {
      position: { ...t.position, ...patch.position },
      rotation: { ...t.rotation, ...patch.rotation },
      scale: { ...t.scale, ...patch.scale },
    };
    if (patch.position) for (const a of ["x", "y", "z"] as const) {
      if (patch.position[a] !== undefined) this._animator.autoKey(id, "position." + a, this._frame, patch.position[a]!);
    }
    if (patch.rotation) for (const a of ["x", "y", "z"] as const) {
      if (patch.rotation[a] !== undefined) this._animator.autoKey(id, "rotation." + a, this._frame, patch.rotation[a]!);
    }
    if (patch.scale) for (const a of ["x", "y", "z"] as const) {
      if (patch.scale[a] !== undefined) this._animator.autoKey(id, "scale." + a, this._frame, patch.scale[a]!);
    }
    if (layer.type === "shape") this._recomputeScene();
    this._emit();
  }

  setName(id: string, name: string): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    layer.name = name;
    // Instance de précomp/prérendu ↔ sa composition (1:1) : nom unifié (fil d'Ariane, sérialisation).
    if (layer.type === "precomp") {
      const comp = this._compositions[layer.compId];
      if (comp) comp.name = name;
    }
    this._emit();
  }

  /** Décalage/vitesse temporels d'une instance de précomp/prérendu (mapping vers sa timeline interne). */
  setPrecompTiming(id: string, patch: { timeOffset?: number; speed?: number }): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || layer.type !== "precomp") return;
    if (patch.timeOffset !== undefined) layer.timeOffset = Math.round(patch.timeOffset);
    if (patch.speed !== undefined) layer.speed = Math.max(0.01, patch.speed);
    this._emit();
  }

  /** Réglages caméra d'un prérendu (édite la scène de la COMPOSITION référencée, pas l'instance). */
  setPrerenderCamera(compId: string, patch: {
    kind?: "perspective" | "orthographic"; fov?: number; near?: number; far?: number;
    position?: Partial<Vec3>; target?: Partial<Vec3>;
  }): void {
    const comp = this._compositions[compId];
    if (!comp || comp.kind !== "prerender") return;
    const scene = (comp.scene ??= defaultPrerenderScene());
    const cam = scene.camera;
    if (patch.kind) cam.kind = patch.kind;
    if (patch.fov !== undefined) cam.fov = patch.fov;
    if (patch.near !== undefined) cam.near = Math.max(0.001, patch.near);
    if (patch.far !== undefined) cam.far = Math.max(cam.near + 0.001, patch.far);
    if (patch.position) cam.position = { ...cam.position, ...patch.position };
    if (patch.target) cam.target = { ...cam.target, ...patch.target };
    this._emit();
  }

  /** Couleur de fond d'un prérendu (opaque : c'est une source vidéo plein-cadre). */
  setPrerenderBackground(compId: string, background: RGB): void {
    const comp = this._compositions[compId];
    if (!comp || comp.kind !== "prerender") return;
    (comp.scene ??= defaultPrerenderScene()).background = background;
    this._emit();
  }

  setShowHelper(id: string, show: boolean): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || layer.type !== "shape") return;
    layer.showHelper = show;
    this._emit();
  }

  /** Couleur d'un calque shader (le fond "Couleur unie"). Pour une shape, voir `setFill`. */
  setColor(id: string, color: RGB): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || layer.type !== "shader") return;
    layer.color = color;
    const live = this._shaderLive.get(id);
    if (live instanceof SolidLayer) live.setColor(color.r, color.g, color.b);
    this._animator.autoKey(id, "color.r", this._frame, color.r);
    this._animator.autoKey(id, "color.g", this._frame, color.g);
    this._animator.autoKey(id, "color.b", this._frame, color.b);
    this._emit();
  }

  /** Remplissage d'une shape : couleur unie, dégradé, image ou vidéo (voir `Fill`). */
  setFill(id: string, fill: Fill): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || layer.type !== "shape") return;
    layer.fill = fill;

    if (fill.type === "video") this._ensureVideoPlayback(id, fill.dataUrl);
    else this._teardownVideo(id);

    if (fill.type === "image") this._decodeImage(id, fill.dataUrl);
    else this._imagePixels.delete(id);

    if (fill.type === "material") void this._bakeMaterialFor(id, fill.presetId);
    else this._materialPixels.delete(id);

    if (fill.type !== "prerender") { this._prerenderedFrames.delete(id); this._prerenderedLoopStart.delete(id); }

    if (fill.type === "solid") {
      this._animator.autoKey(id, "color.r", this._frame, fill.color.r);
      this._animator.autoKey(id, "color.g", this._frame, fill.color.g);
      this._animator.autoKey(id, "color.b", this._frame, fill.color.b);
    }
    this._recomputeScene();
    this._emit();
  }

  setSpotChannels(id: string, patch: Partial<SpotChannels>): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || layer.type !== "spot") return;
    layer.channels = { ...layer.channels, ...patch };
    for (const k in patch) {
      const v = patch[k as keyof SpotChannels];
      if (v !== undefined) this._animator.autoKey(id, "fx." + k, this._frame, v);
    }
    this._pushFixtures();
    this._emit();
  }

  setLyreChannels(id: string, patch: Partial<LyreChannels>): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || layer.type !== "lyre") return;
    layer.channels = { ...layer.channels, ...patch };
    for (const k in patch) {
      const v = patch[k as keyof LyreChannels];
      if (v !== undefined) this._animator.autoKey(id, "fx." + k, this._frame, v);
    }
    this._pushFixtures();
    this._emit();
  }

  /** appelé chaque frame moteur : évalue les keyframes puis (au besoin) re-rasterise/repousse. */
  tick(frame: number, playing = false, fps = 24): void {
    this._frame = frame;
    this._fps = fps;
    this._sceneDirty = false;
    this._fixturesDirty = false;
    this._animator.evaluate(frame);
    if (this._activeSignature() !== this._lastActiveSig) {
      this._push(); // franchissement de bord de clip → reconstruit la pile (+ `_syncNested`)
    } else {
      if (this._sceneDirty || this._videoEls.size > 0 || this._prerenderedFrames.size > 0) this._recomputeScene();
      if (this._fixturesDirty) this._pushFixtures();
      this._syncNested(); // maj des comps imbriquées (animation/temps) même sans rebuild de la pile active
    }
    this._syncVideos(frame, playing, fps);
    this._rebakeMaterials();
  }

  /**
   * Synchronise les `<video>` sur le playhead : play en lecture, seek en pause/scrub.
   * Couvre les 2 usages (calque vidéo plein-cadre avec montage, ET fill vidéo d'une
   * shape) — les deux doivent respecter la timeline, pas juste boucler en roue libre.
   */
  private _syncVideos(frame: number, playing: boolean, fps: number): void {
    const rate = fps > 0 ? fps : 24;
    for (const [id, el] of this._videoEls) {
      const layer = findLayer(this._doc.root, id);
      if (!layer) continue;

      if (layer.type === "video") {
        const clip = layer.clips?.find((c) => mediaClipActiveAt(c, frame));
        const active = layer.visible && (clip !== undefined || (!layer.clips && layerActiveAt(layer.clip, frame)));
        if (!active) { if (!el.paused) el.pause(); continue; }
        const targetSec = (clip ? mediaSourceFrameAt(clip, frame) : frame) / rate;
        this._driveVideoEl(el, targetSec, playing);
        // fondu du clip → opacité du layer moteur (mise à jour continue)
        const live = this._videoLive.get(id);
        if (live && clip) live.opacity = layer.opacity * mediaFadeGain(clip, frame);
        continue;
      }

      if (layer.type === "shape" && layer.fill.type === "video") {
        const active = layer.visible && layerActiveAt(layer.clip, frame);
        if (!active) { if (!el.paused) el.pause(); continue; }
        // pas de montage (MediaClip) pour un fill : lecture directe frame→temps, bouclée
        // sur la durée réelle de la source une fois connue (sinon avance en continu).
        const dur = el.duration && isFinite(el.duration) && el.duration > 0 ? el.duration : Infinity;
        const raw = frame / rate;
        const targetSec = isFinite(dur) ? raw % dur : raw;
        this._driveVideoEl(el, targetSec, playing);
      }
    }
  }

  /** Applique play/pause + position à un `<video>` (reslave en lecture, seek exact en pause). */
  private _driveVideoEl(el: HTMLVideoElement, targetSec: number, playing: boolean): void {
    if (playing) {
      if (el.paused) void el.play().catch(() => {});
      if (Math.abs(el.currentTime - targetSec) > 0.2) el.currentTime = targetSec; // reslave
    } else {
      if (!el.paused) el.pause();
      el.currentTime = targetSec; // scrub image par image
    }
  }

  subscribe(listener: EditorListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  // ————————————————————————————————— Interne —————————————————————————————————

  /** Écrit la valeur d'un canal scalaire dans le modèle + le moteur (appelé par l'Animator). */
  private _applyChannel(id: string, channel: string, value: number): void {
    const layer = this._findAnywhere(id); // cross-comp : les tracks des comps imbriquées ciblent leurs propres calques
    if (!layer) return;
    if (channel === "opacity") {
      layer.opacity = value;
      const live = this._shaderLive.get(id);
      if (live) live.opacity = value;
      if (layer.type === "precomp") { const s = this._subs.get(layer.compId); if (s) s.nested.opacity = value; }
      if (layer.type === "shape") this._sceneDirty = true;
      return;
    }
    if (channel === "gain") {
      if (layer.type === "audio") layer.gain = Math.max(0, value); // lu par l'AudioSync chaque frame
      return;
    }
    const dot = channel.indexOf(".");
    const group = channel.slice(0, dot);
    const key = channel.slice(dot + 1);
    if (group === "position" || group === "rotation" || group === "scale") {
      const axis = key as keyof Vec3;
      const t = layer.transform;
      const chan: Vec3 = { ...t[group], [axis]: value } as Vec3;
      layer.transform = { ...t, [group]: chan };
      if (layer.type === "shape") this._sceneDirty = true;
    } else if (group === "param" && layer.type === "shader") {
      layer.params[key] = value;
      this._shaderLive.get(id)?.setParam(key, value);
    } else if (group === "simParam" && layer.type === "particles") {
      layer.simValues = { ...layer.simValues, [key]: value }; // appliqué à l'uniform au prochain setConfig (chaque frame)
    } else if (group === "color") {
      const c = key as keyof RGB;
      if (layer.type === "shader") {
        layer.color = { ...layer.color, [c]: value } as RGB;
        const live = this._shaderLive.get(id);
        if (live instanceof SolidLayer) live.setColor(layer.color.r, layer.color.g, layer.color.b);
      } else if (layer.type === "shape" && layer.fill.type === "solid") {
        layer.fill = { type: "solid", color: { ...layer.fill.color, [c]: value } as RGB };
        this._sceneDirty = true;
      }
    } else if (group === "fx") {
      const v = Math.round(value);
      if (layer.type === "spot" && key in layer.channels) {
        layer.channels = { ...layer.channels, [key]: v };
        this._fixturesDirty = true;
      } else if (layer.type === "lyre" && key in layer.channels) {
        layer.channels = { ...layer.channels, [key]: v };
        this._fixturesDirty = true;
      }
    }
  }

  /** Lit la valeur courante d'un canal (pour la 1re clé). undefined si non applicable. */
  private _readChannel(id: string, channel: string): number | undefined {
    const layer = this._findAnywhere(id);
    if (!layer) return undefined;
    if (channel === "opacity") return layer.opacity;
    if (channel === "gain") return layer.type === "audio" ? layer.gain : undefined;
    const dot = channel.indexOf(".");
    const group = channel.slice(0, dot);
    const key = channel.slice(dot + 1);
    if (group === "position" || group === "rotation" || group === "scale") {
      return layer.transform[group][key as keyof Vec3];
    }
    if (group === "param" && layer.type === "shader") return layer.params[key];
    if (group === "simParam" && layer.type === "particles") return layer.simValues[key];
    if (group === "color") {
      const c = key as keyof RGB;
      if (layer.type === "shader") return layer.color[c];
      if (layer.type === "shape" && layer.fill.type === "solid") return layer.fill.color[c];
    }
    if (group === "fx" && (layer.type === "spot" || layer.type === "lyre") && key in layer.channels) {
      return (layer.channels as unknown as Record<string, number>)[key];
    }
    return undefined;
  }

  private _activeGroup(): GroupLayer {
    return findGroup(this._doc.root, this._doc.activeGroupId) ?? this._doc.root;
  }

  /** Matrice locale (TRS) d'un transform. */
  private _matrixOf(t: Transform): Matrix4 {
    return new Matrix4().compose(
      new Vector3(t.position.x, t.position.y, t.position.z),
      new Quaternion().setFromEuler(new Euler(t.rotation.x, t.rotation.y, t.rotation.z, "XYZ")),
      new Vector3(t.scale.x, t.scale.y, t.scale.z),
    );
  }

  /** Matrice monde d'un calque (= matrice locale, sans parenting). */
  private _worldMatrix(id: string): Matrix4 {
    return this._worldMatrixIn(this._doc.root, id);
  }

  /** Matrice locale d'un calque dans un arbre donné (pour rendre une comp imbriquée). */
  private _worldMatrixIn(root: GroupLayer, id: string): Matrix4 {
    const layer = findLayer(root, id);
    if (!layer) return new Matrix4();
    return this._matrixOf(layer.transform);
  }

  private _toInput(s: ShapeLayer): ShapeInput {
    return this._toInputIn(this._doc.root, s);
  }

  /** ShapeInput d'une shape dans un arbre donné (transform monde calculé dans cet arbre). */
  private _toInputIn(root: GroupLayer, s: ShapeLayer): ShapeInput {
    const p = new Vector3(), q = new Quaternion(), sc = new Vector3();
    this._worldMatrixIn(root, s.id).decompose(p, q, sc);
    const e = new Euler().setFromQuaternion(q, "XYZ");
    return {
      kind: s.shape,
      position: { x: p.x, y: p.y, z: p.z },
      rotation: { x: e.x, y: e.y, z: e.z },
      scale: { x: sc.x, y: sc.y, z: sc.z },
      fill: this._resolveFill(s),
      opacity: s.opacity,
    };
  }

  /** Résout le `Fill` (modèle, sérialisable) en `ShapeFill` (pixels prêts pour le rasterizeur). */
  private _resolveFill(s: ShapeLayer): ShapeFill {
    const fill = s.fill;
    switch (fill.type) {
      case "solid":
        return { kind: "solid", color: fill.color };
      case "gradient":
        return { kind: "gradient", from: fill.from, to: fill.to, angle: fill.angle };
      case "image": {
        const bmp = this._imagePixels.get(s.id);
        return bmp ? { kind: "bitmap", ...bmp } : FALLBACK_FILL;
      }
      case "video":
        return this._sampleVideoFrame(s.id) ?? FALLBACK_FILL;
      case "material": {
        const bmp = this._materialPixels.get(s.id);
        return bmp ? { kind: "bitmap", ...bmp } : FALLBACK_FILL;
      }
      case "prerender": {
        const frames = this._prerenderedFrames.get(s.id);
        if (!frames || frames.length === 0) return FALLBACK_FILL;
        const loopStart = Math.min(frames.length - 1, this._prerenderedLoopStart.get(s.id) ?? 0);
        const idx = this._frame < loopStart
          ? Math.max(0, this._frame)
          : loopStart + (((this._frame - loopStart) % (frames.length - loopStart)) + (frames.length - loopStart)) % (frames.length - loopStart);
        return { kind: "bitmap", data: frames[idx], width: this.materialBakeSize, height: this.materialBakeSize };
      }
    }
  }

  /** Fournit la séquence pré-calculée d'un fill "prerender" (voir `tunnelPrerendered.ts`).
   *  `loopStart` (index dans `frames`) sépare une intro jouée UNE FOIS (avant) d'une boucle
   *  infinie (à partir de là) — 0 = tout boucle dès le début. Aucun calcul par frame ensuite. */
  setPrerenderedFrames(shapeId: string, frames: Uint8ClampedArray[], loopStart = 0): void {
    this._prerenderedFrames.set(shapeId, frames);
    this._prerenderedLoopStart.set(shapeId, Math.max(0, loopStart));
    this._recomputeScene();
    this._emit();
  }

  // ————————————————————————————————— Matériaux ─────————————————————————————————

  /** Bibliothèque de matériaux (presets réutilisables entre shapes, toutes comps confondues). */
  listMaterialPresets(): readonly MaterialPreset[] {
    return this._materials;
  }

  /** Charge la bibliothèque (depuis un projet) — voir `loadSimPresets`, même pattern. */
  loadMaterialPresets(presets: readonly MaterialPreset[] | undefined): void {
    this._materials = (presets ?? []).map((p) => ({ ...p }));
    this._emit();
  }

  /** Crée un nouveau preset (fichier de matériau). Renvoie son id. */
  addMaterialPreset(name: string, mode: MaterialMode = "basic", fragment = DEFAULT_MATERIAL_FRAGMENT, vertex = ""): string {
    this._counter += 1;
    const id = `material-${this._counter}`;
    const preset: MaterialPreset = { id, name, mode, fragment, vertex };
    this._materials = [...this._materials, preset];
    this._emit();
    return id;
  }

  /** Édite un preset existant (nom/mode/fragment/vertex) et re-bake toutes les shapes qui l'utilisent. */
  updateMaterialPreset(id: string, patch: Partial<Omit<MaterialPreset, "id">>): void {
    const idx = this._materials.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const updated = { ...this._materials[idx], ...patch };
    this._materials = this._materials.map((p, i) => (i === idx ? updated : p));
    this._emit();
    for (const shape of this._collect((l): l is ShapeLayer => l.type === "shape" && l.fill.type === "material" && l.fill.presetId === id)) {
      void this._bakeMaterialFor(shape.id, id);
    }
  }

  /** Bake (async, best-effort) le preset d'une shape en bitmap CPU, mis en cache par id de shape.
   *  Un échec de bake (TSL invalide) affiche du magenta plutôt que du noir : sinon un matériau
   *  cassé est indiscernable d'un matériau qui charge encore — voir la console pour le détail
   *  de l'erreur (`MaterialBaker: échec du fragment TSL utilisateur`). */
  private async _bakeMaterialFor(shapeId: string, presetId: string): Promise<void> {
    const preset = this._materials.find((p) => p.id === presetId);
    if (!preset || !this._engine || this._materialBaking.has(shapeId)) return;
    this._materialBaking.add(shapeId);
    try {
      const rgba = (await this._engine.bakeMaterial(preset.fragment, preset.mode, this._frame / (this._fps > 0 ? this._fps : 24)))
        ?? magentaBitmap(this.materialBakeSize);
      // la shape peut avoir changé de fill (ou été supprimée) pendant le bake async — ignore si périmé
      const layer = findLayer(this._doc.root, shapeId);
      if (!layer || layer.type !== "shape" || layer.fill.type !== "material" || layer.fill.presetId !== presetId) return;
      this._materialPixels.set(shapeId, { data: rgba, width: this.materialBakeSize, height: this.materialBakeSize });
      this._recomputeScene();
      // PAS de `_emit()` ici : un bake ne change aucune donnée que la Timeline/Outliner/Inspecteur
      // affichent (juste un cache de bitmap interne) — `_recomputeScene()` suffit à faire vivre le
      // rendu (mur + viewport 3D, via la boucle de rendu continue). Un matériau animé se rebake à
      // CHAQUE tick (voir `_rebakeMaterials`) ; `_emit()` ferait tourner tous les panneaux réactifs
      // (Timeline notamment, coûteuse) des dizaines de fois par seconde pour rien — c'est ce qui
      // faisait "bugger"/ramer la timeline dès qu'un matériau animé était ajouté.
    } finally {
      this._materialBaking.delete(shapeId);
    }
  }

  /** Relance le bake de toutes les shapes en fill matériau — pour qu'un fragment utilisant
   *  `time` s'anime réellement au lieu de rester figé sur l'instant du dernier edit. Best-effort
   *  (une shape déjà en cours de bake est sautée ce tick, voir `_materialBaking`). */
  private _rebakeMaterials(): void {
    for (const shape of this._collect((l): l is ShapeLayer => l.type === "shape" && l.fill.type === "material")) {
      if (shape.fill.type === "material") void this._bakeMaterialFor(shape.id, shape.fill.presetId);
    }
  }

  /** Taille (côté, en px) du bitmap baké pour un matériau — voir `MaterialBaker`. */
  readonly materialBakeSize = 128;

  /** Décode une image (data URL) en pixels CPU via un canvas hors-écran, met en cache par id de shape. */
  private _decodeImage(id: string, dataUrl: string): void {
    if (!dataUrl) { this._imagePixels.delete(id); return; }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      this._imagePixels.set(id, { data, width, height });
      this._recomputeScene();
      this._emit();
    };
    img.src = dataUrl;
  }

  /** Crée/relance un <video> caché (loop, muet) pour une shape en fill vidéo. */
  private _ensureVideoPlayback(id: string, dataUrl: string): void {
    if (!dataUrl) { this._teardownVideo(id); return; }
    const existing = this._videoEls.get(id);
    if (existing && existing.src === dataUrl) return;
    existing?.pause();
    const el = document.createElement("video");
    el.src = dataUrl;
    el.loop = true;
    el.muted = true;
    el.playsInline = true;
    void el.play().catch(() => {}); // autoplay peut être refusé avant interaction — pas bloquant
    this._videoEls.set(id, el);
  }

  private _teardownVideo(id: string): void {
    const el = this._videoEls.get(id);
    if (!el) return;
    el.pause();
    this._videoEls.delete(id);
  }

  /** Dessine la frame vidéo courante dans un canvas partagé et relit les pixels (par id de shape). */
  private _sampleVideoFrame(id: string): ShapeFill | null {
    const el = this._videoEls.get(id);
    if (!el || el.readyState < 2 || el.videoWidth === 0) return null;
    const canvas = this._videoSampleCanvas ?? (this._videoSampleCanvas = document.createElement("canvas"));
    canvas.width = VIDEO_SAMPLE_SIZE;
    canvas.height = VIDEO_SAMPLE_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(el, 0, 0, VIDEO_SAMPLE_SIZE, VIDEO_SAMPLE_SIZE);
    const { data } = ctx.getImageData(0, 0, VIDEO_SAMPLE_SIZE, VIDEO_SAMPLE_SIZE);
    return { kind: "bitmap", data, width: VIDEO_SAMPLE_SIZE, height: VIDEO_SAMPLE_SIZE };
  }

  /** Un calque est-il actif au frame courant : sa propre fenêtre de clip ET son groupe média. */
  private _activeAt(layer: Layer): boolean {
    return this._activeAtIn(this._doc.root, layer, this._frame);
  }

  private _activeAtIn(root: GroupLayer, layer: Layer, frame: number): boolean {
    return layerActiveAt(layer.clip, frame) && mediaGroupActiveAt(root, layer, frame);
  }

  /** Cherche un calque dans TOUTES les comps (les tracks d'une comp imbriquée ciblent ses propres calques). */
  private _findAnywhere(id: string): Layer | null {
    const active = findLayer(this._doc.root, id);
    if (active) return active;
    for (const c of Object.values(this._compositions)) {
      if (c.root === this._doc.root) continue;
      const l = findLayer(c.root, id);
      if (l) return l;
    }
    return null;
  }

  /**
   * Jumeaux 3D des systèmes de particules de la comp active — à afficher dans l'éditeur 3D (les particules
   * vivent en espace [-1,1], comme le mur `HALF=1`). Prérendu : les systèmes de sa scène ; sinon : les
   * calques `particles` visibles de la comp (via leurs `ParticleScene`).
   */
  activeParticleViewers(): Object3D[] {
    const comp = this.activeComp();
    if (comp.kind === "prerender") {
      return this._subs.get(comp.id)?.prerender?.particleViewers() ?? [];
    }
    const out: Object3D[] = [];
    for (const layer of this._renderablesIn(comp.root)) {
      if (layer.type !== "particles" || !layer.visible) continue;
      const sub = this._subs.get(layer.id);
      if (sub?.particles) out.push(sub.particles.viewer);
    }
    return out;
  }

  /** Calques rendus (shader/shape/video/precomp) d'un arbre, groupes traversés, en ordre de composition. */
  private _renderablesIn(group: GroupLayer, out: Layer[] = []): Layer[] {
    for (const c of group.children) {
      if (c.type === "group") this._renderablesIn(c, out);
      else out.push(c);
    }
    return out;
  }

  private _anySoloIn(root: GroupLayer): boolean {
    return this._renderablesIn(root).some((c) => c.solo && c.type !== "audio");
  }

  private _shapeInputsIn(root: GroupLayer, frame: number): ShapeInput[] {
    const anySolo = this._anySoloIn(root);
    return this._renderablesIn(root)
      .filter((l): l is ShapeLayer => l.type === "shape" && l.visible && this._activeAtIn(root, l, frame) && (!anySolo || !!l.solo))
      .map((s) => this._toInputIn(root, s));
  }

  /** Signature du set de calques actifs d'une comp à un frame (rebuild de son stack si ça change). */
  private _compSigIn(comp: Composition, frame: number): string {
    let sig = "";
    for (const l of this._renderablesIn(comp.root)) if (this._activeAtIn(comp.root, l, frame)) sig += l.id + ",";
    return sig;
  }

  /** Un calque VISUEL du groupe actif est-il en solo ? (si oui, seuls les solos visuels rendent).
   *  L'audio est exclu : son solo/mute est géré par l'AudioSync, pas par le rendu mur/DMX. */
  private _anySolo(): boolean {
    return this._activeGroup().children.some((c) => c.solo && c.type !== "audio");
  }

  private _shapeInputs(): ShapeInput[] {
    const anySolo = this._anySolo();
    return this._activeGroup().children
      .filter((l): l is ShapeLayer => l.type === "shape" && l.visible && this._activeAt(l) && (!anySolo || !!l.solo))
      .map((s) => this._toInput(s));
  }

  /** Nombre de LEDs allumées par l'objet sélectionné (0 si non-shape / masqué) — pour le HUD. */
  selectedLedCount(): number {
    const sel = this.selected;
    if (!sel || sel.type !== "shape" || !sel.visible) return 0;
    return countLit([this._toInput(sel)], 128, 128);
  }

  /** recalcule la DataTexture depuis les shapes du groupe actif (sans reconstruire la pile). */
  private _recomputeScene(): void {
    this._scene3d?.setShapes(this._shapeInputs());
  }

  /** parcourt tout le document (pas seulement le groupe actif) et filtre par prédicat. */
  private _collect<T extends Layer>(pred: (l: Layer) => l is T, group: GroupLayer = this._doc.root): T[] {
    const out: T[] = [];
    for (const child of group.children) {
      if (pred(child)) out.push(child);
      if (child.type === "group") out.push(...this._collect(pred, child));
    }
    return out;
  }

  /** trouve un bloc de `size` canaux libres (pas de recouvrement avec un spot/lyre existant, tout le document), en partant de `suggestion`. */
  private _nextFreeChannel(size: number, suggestion: number): number {
    const ranges = this._collect<SpotLayer | LyreLayer>((l): l is SpotLayer | LyreLayer => l.type === "spot" || l.type === "lyre")
      .map((l) => ({ start: l.baseChannel, end: l.baseChannel + fixtureDmxChannels(l).length - 1 }));
    let candidate = suggestion;
    for (;;) {
      const overlap = ranges.find((r) => candidate <= r.end && candidate + size - 1 >= r.start);
      if (!overlap) return candidate;
      candidate = overlap.end + 1;
    }
  }

  /** canaux DMX bruts (spots/lyres du groupe actif) → entités eHuB (id = canal, R = valeur). */
  private _fixtureChannels(): Map<number, number> {
    const map = new Map<number, number>();
    const anySolo = this._anySolo();
    for (const l of this._activeGroup().children) {
      if ((l.type === "spot" || l.type === "lyre") && l.visible && this._activeAt(l) && (!anySolo || l.solo)) {
        for (const { channel, value } of fixtureDmxChannels(l)) map.set(channel, value);
      }
    }
    return map;
  }

  /** pousse les canaux DMX courants au moteur (indépendant de la pile de rendu — pas de sortie visuelle sur le mur). */
  private _pushFixtures(): void {
    this._engine?.setFixtureChannels(this._fixtureChannels());
  }

  /** reconstruit la pile moteur du groupe actif : calques shader + un calque scène3d agrégé. */
  private _push(): void {
    const engine = this._engine;
    const scene3d = this._scene3d;
    if (!engine || !scene3d) return;

    // Comp active = prérendu : le mur affiche sa sortie caméra (une seule couche = sa RT), pas la grille LED.
    if (this.activeComp().kind === "prerender") { this._pushPrerenderActive(); return; }

    this._syncNested(); // (re)construit les comps imbriquées et alimente leurs RT avant de composer

    const shapes = this._shapeInputs();
    scene3d.setShapes(shapes);
    this._pushFixtures();

    const anySolo = this._anySolo();
    const stack: EngineLayer[] = [];
    let sceneAdded = false;
    for (const child of this._activeGroup().children) {
      if (child.type === "shader") {
        if (this._activeAt(child) && (!anySolo || child.solo)) stack.push(this._ensureShader(child));
      } else if (child.type === "shape") {
        // un seul calque Scene3D agrégé (position de la 1re shape) tant qu'il reste des shapes actives
        if (!sceneAdded && shapes.length > 0) { stack.push(scene3d); sceneAdded = true; }
      } else if (child.type === "video") {
        const active = child.clips ? child.clips.some((c) => mediaClipActiveAt(c, this._frame)) : this._activeAt(child);
        if (child.visible && active && (!anySolo || child.solo)) stack.push(this._ensureVideo(child));
      } else if (child.type === "precomp") {
        // instance de précomp/prérendu : composite la RT de sa comp enfant (rendue par `_syncNested`)
        if (child.visible && this._activeAt(child) && precompActiveAt(child, this._frame) && (!anySolo || child.solo)) {
          const sub = this._subs.get(child.compId);
          if (sub) {
            sub.nested.enabled = true;
            sub.nested.opacity = child.opacity;
            sub.nested.blend = child.blend;
            stack.push(sub.nested);
          }
        }
      } else if (child.type === "particles") {
        // système de particules : composite la RT de sa scène GPU (rendue/simulée par `_syncNested`)
        if (child.visible && this._activeAt(child) && (!anySolo || child.solo)) {
          const sub = this._subs.get(child.id);
          if (sub) {
            sub.nested.enabled = true;
            sub.nested.opacity = child.opacity;
            sub.nested.blend = child.blend;
            stack.push(sub.nested);
          }
        }
      }
      // group/image/spot/lyre : non rendus sur le mur (navigables / repère visuel seulement)
    }
    // ordre d'affichage (haut = avant) → ordre moteur inversé (le haut rend en dernier)
    engine.setLayers([...stack].reverse());
    this._lastActiveSig = this._activeSignature();
  }

  /** Pile moteur quand on édite un prérendu : le mur = la RT de sa scène 3D caméra (aucune grille LED). */
  private _pushPrerenderActive(): void {
    const engine = this._engine;
    if (!engine) return;
    const ordered: NestedSource[] = [];
    const sub = this._updatePrerenderSub(this.activeComp(), this._frame, ordered);
    engine.setNested(ordered);
    if (sub) {
      sub.nested.enabled = true;
      sub.nested.opacity = 1;
      sub.nested.blend = "normal";
      engine.setLayers([sub.nested]);
    } else {
      engine.setLayers([]);
    }
    this._lastActiveSig = this._activeSignature();
  }

  /** Signature du set de calques actifs (clips) au frame courant — détecte un franchissement de bord dans `tick`. */
  private _activeSignature(): string {
    let sig = "";
    for (const child of this._activeGroup().children) {
      if (this._activeAt(child)) sig += child.id + ",";
    }
    return sig;
  }

  /** (Re)construit le graphe des comps imbriquées atteignables depuis le groupe actif et alimente leurs RT. */
  private _syncNested(): void {
    const engine = this._engine;
    if (!engine) return;
    const ordered: NestedSource[] = [];
    const guard = new Set<string>();

    // Comp active = prérendu : le mur affiche SA sortie caméra (pas la grille LED). Sa RT est la seule source.
    const active = this.activeComp();
    if (active.kind === "prerender") {
      const sub = this._updatePrerenderSub(active, this._frame, ordered);
      engine.setNested(ordered);
      if (sub) { sub.nested.enabled = true; sub.nested.opacity = 1; sub.nested.blend = "normal"; }
      return;
    }

    for (const child of this._activeGroup().children) {
      if (child.type === "particles") {
        if (child.visible && this._activeAt(child)) this._updateParticleSub(child, ordered);
        continue;
      }
      if (child.type !== "precomp" || !child.visible || !this._activeAt(child) || !precompActiveAt(child, this._frame)) continue;
      const comp = this._compositions[child.compId];
      if (!comp) continue;
      const frame = precompChildFrame(child, this._frame, comp.durationFrames);
      this._updateSub(comp, frame, ordered, guard);
    }
    engine.setNested(ordered); // ordonnées plus profond d'abord (les enfants se poussent avant leur parent)
  }

  /**
   * Met à jour (ou crée) le compositor d'une comp imbriquée à un frame local : évalue son animation,
   * rasterise ses shapes, (re)construit son stack au besoin, puis la fait rendre dans sa RT. Récursif
   * (enfants d'abord). `guard` = garde de cycle (une comp déjà dans la chaîne n'est pas ré-entrée).
   */
  private _updateSub(comp: Composition, frame: number, ordered: NestedSource[], guard: Set<string>): SubRenderer | null {
    const engine = this._engine;
    if (!engine || guard.has(comp.id)) return null;
    guard.add(comp.id);

    // Prérendu : chemin scène 3D → RT (pas de raster CPU / stack 2D).
    if (comp.kind === "prerender") return this._updatePrerenderSub(comp, frame, ordered);

    let sub = this._subs.get(comp.id);
    if (!sub) {
      const stack = new LayerStack(engine.fixture.width, engine.fixture.height);
      const scene3d = new Scene3DLayer(`${comp.id}:scene3d`, engine.fixture.width, engine.fixture.height);
      const nested = new NestedTextureLayer(`${comp.id}:nested`);
      nested.setTexture(stack.target.texture);
      sub = { stack, scene3d, nested, sig: "" };
      this._subs.set(comp.id, sub);
    }
    const stack = sub.stack!, scene3d = sub.scene3d!;

    this._animator.evaluateAt(comp.tracks, frame);                 // animation de la comp à son frame local
    scene3d.setShapes(this._shapeInputsIn(comp.root, frame));      // shapes de la comp (raster CPU dans sa DataTexture)

    const anySolo = this._anySoloIn(comp.root);
    const layers: EngineLayer[] = [];
    let sceneAdded = false;
    for (const layer of this._renderablesIn(comp.root)) {
      if (!layer.visible || !this._activeAtIn(comp.root, layer, frame) || (anySolo && !layer.solo)) continue;
      if (layer.type === "shader") layers.push(this._ensureShader(layer));
      else if (layer.type === "shape") { if (!sceneAdded) { layers.push(scene3d); sceneAdded = true; } }
      else if (layer.type === "video") layers.push(this._ensureVideo(layer));
      else if (layer.type === "precomp") {
        const cc = this._compositions[layer.compId];
        if (cc && precompActiveAt(layer, frame)) {
          const cf = precompChildFrame(layer, frame, cc.durationFrames);
          const cs = this._updateSub(cc, cf, ordered, guard);
          if (cs) { cs.nested.enabled = true; cs.nested.opacity = layer.opacity; cs.nested.blend = layer.blend; layers.push(cs.nested); }
        }
      }
      else if (layer.type === "particles") {
        const ps = this._updateParticleSub(layer, ordered);
        ps.nested.enabled = true; ps.nested.opacity = layer.opacity; ps.nested.blend = layer.blend; layers.push(ps.nested);
      }
    }

    const sig = this._compSigIn(comp, frame);
    if (sig !== sub.sig) { stack.setLayers([...layers].reverse()); sub.sig = sig; }
    stack.setTime(this._fps > 0 ? frame / this._fps : 0);
    ordered.push(stack);
    return sub;
  }

  /**
   * Met à jour (ou crée) le renderer 3D d'un prérendu à un frame local : évalue son animation, applique
   * la caméra/fond de `comp.scene`, construit les meshes depuis ses shapes, et pousse sa RT dans `ordered`.
   * Frontière de rendu : un prérendu ne compose pas de précomps imbriquées (scène 3D pure en v1).
   */
  private _updatePrerenderSub(comp: Composition, frame: number, ordered: NestedSource[]): SubRenderer | null {
    const engine = this._engine;
    if (!engine) return null;

    let sub = this._subs.get(comp.id);
    if (!sub || !sub.prerender) {
      const res = comp.scene?.resolution;
      const prerender = new Prerender3DScene(res?.w ?? engine.fixture.width, res?.h ?? engine.fixture.height);
      const nested = new NestedTextureLayer(`${comp.id}:nested`);
      nested.setTexture(prerender.target.texture);
      nested.setFlipV(false); // scène 3D : pas d'inversion V du compositor 2D → sinon prérendu à l'envers
      sub = { prerender, nested, sig: "" };
      this._subs.set(comp.id, sub);
    }

    this._animator.evaluateAt(comp.tracks, frame);
    sub.prerender!.setScene(comp.scene ?? defaultPrerenderScene());
    sub.prerender!.setShapes(this._shapeInputsIn(comp.root, frame));
    // particules émises DANS la scène 3D du prérendu (vues par sa caméra, avec les meshes)
    const particleLayers = this._renderablesIn(comp.root).filter(
      (l): l is ParticlesLayer => l.type === "particles" && l.visible && this._activeAtIn(comp.root, l, frame),
    );
    sub.prerender!.setParticles(particleLayers, (l) => this._resolveSim(l));
    ordered.push(sub.prerender!);
    return sub;
  }

  /**
   * Met à jour (ou crée) la scène de particules d'un calque `particles` : applique sa config (reconstruit
   * la sim au changement de nombre, sinon uniforms) et pousse sa scène dans `ordered` (simulée + rendue
   * par `Engine.update`). Sub keyé par id de calque (pas de composition dédiée : effet feuille).
   */
  private _updateParticleSub(layer: ParticlesLayer, ordered: NestedSource[]): SubRenderer {
    const engine = this._engine!;
    let sub = this._subs.get(layer.id);
    if (!sub || !sub.particles) {
      const particles = new ParticleScene(engine.fixture.width, engine.fixture.height);
      const nested = new NestedTextureLayer(`${layer.id}:nested`);
      nested.setTexture(particles.target.texture);
      sub = { particles, nested, sig: "" };
      this._subs.set(layer.id, sub);
    }
    sub.particles!.setConfig(layer, this._resolveSim(layer));
    ordered.push(sub.particles!);
    return sub;
  }

  /** engine layer d'un calque vidéo (VideoTexture plein-cadre), créé une fois puis synchronisé. */
  private _ensureVideo(model: VideoLayer): EngineLayer {
    this._ensureVideoPlayback(model.id, model.assetId); // crée/relance le <video> caché
    let live = this._videoLive.get(model.id);
    if (!live) { live = createLayer(LAYER_ID.VIDEO, model.id); this._videoLive.set(model.id, live); }
    const el = this._videoEls.get(model.id);
    if (el && live instanceof VideoWallLayer) live.setVideo(el);
    live.enabled = model.visible;
    live.opacity = model.opacity;
    live.blend = model.blend;
    return live;
  }

  /** engine layer d'un calque shader (créé une fois, réutilisé), synchronisé sur le modèle. */
  private _ensureShader(model: ShaderLayer): EngineLayer {
    let live = this._shaderLive.get(model.id);
    if (!live) {
      live = createLayer(model.shader, model.id);
      this._shaderLive.set(model.id, live);
    }
    live.enabled = model.visible;
    live.opacity = model.opacity;
    live.blend = model.blend;
    for (const key in model.params) live.setParam(key, model.params[key]);
    if (live instanceof SolidLayer) live.setColor(model.color.r, model.color.g, model.color.b);
    return live;
  }

  private _emit(): void {
    this._noteHistory();
    for (const listener of this._listeners) listener();
  }

  // ————————————————————————————————— Historique ————————————————————————————————

  private _snapshot(): HistorySnapshot {
    return { compositions: structuredClone(this._compositions), nav: structuredClone(this._nav) };
  }

  private _restore(snap: HistorySnapshot): void {
    this._restoringHistory = true;
    this._compositions = structuredClone(snap.compositions);
    this._nav = structuredClone(snap.nav);
    const top = this._nav[this._nav.length - 1];
    const comp = this._compositions[top.compId] ?? this._compositions[Object.keys(this._compositions)[0]];
    this._doc = { root: comp.root, activeGroupId: findGroup(comp.root, top.groupId) ? top.groupId : comp.root.id, selectedId: top.selectedId };
    this._animator.load(comp);
    this._push();
    this._emit();
    this._restoringHistory = false;
  }

  /** Appelé à chaque `_emit()` : ouvre/prolonge une rafale d'historique (debounce). */
  private _noteHistory(): void {
    if (this._restoringHistory) return;
    if (!this._historyBurstOpen) {
      this._undoStack.push(this._lastSnapshot);
      if (this._undoStack.length > HISTORY_LIMIT) this._undoStack.shift();
      this._redoStack = [];
      this._historyBurstOpen = true;
    }
    if (this._historyTimer) clearTimeout(this._historyTimer);
    this._historyTimer = setTimeout(() => {
      this._lastSnapshot = this._snapshot();
      this._historyBurstOpen = false;
      this._historyTimer = null;
    }, HISTORY_DEBOUNCE_MS);
  }

  canUndo(): boolean { return this._undoStack.length > 0; }
  canRedo(): boolean { return this._redoStack.length > 0; }

  undo(): void {
    if (this._historyTimer) { clearTimeout(this._historyTimer); this._historyTimer = null; }
    this._historyBurstOpen = false;
    const prev = this._undoStack.pop();
    if (!prev) return;
    this._redoStack.push(this._snapshot());
    this._restore(prev);
    this._lastSnapshot = prev;
  }

  redo(): void {
    if (this._historyTimer) { clearTimeout(this._historyTimer); this._historyTimer = null; }
    this._historyBurstOpen = false;
    const next = this._redoStack.pop();
    if (!next) return;
    this._undoStack.push(this._snapshot());
    this._restore(next);
    this._lastSnapshot = next;
  }
}

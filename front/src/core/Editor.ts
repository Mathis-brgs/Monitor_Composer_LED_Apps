import { Euler, Matrix4, Quaternion, Vector3 } from "three/webgpu";
import type { Engine } from "./engine/Engine.ts";
import {
  makeGroup, makeShape, makeShaderLayer, makeSpot, makeLyre, makeAudio, makeVideo, findLayer, findGroup, findParent, groupChildren,
  fixtureDmxChannels, layerActiveAt, mediaClipActiveAt, mediaSourceFrameAt, mediaFadeGain,
  wouldCycle, SPOT_DEFAULT_BASE, SPOT_CHANNEL_COUNT, LYRE_DEFAULT_BASES, LYRE_CHANNEL_COUNT,
  type Document, type Layer, type GroupLayer, type ShapeLayer, type ShaderLayer, type SpotLayer, type LyreLayer, type VideoLayer,
  type RGB, type Vec3, type Transform, type ShapeKind, type ShaderId, type BlendMode, type Fill, type Clip, type MediaClip, type SpotChannels, type LyreChannels,
} from "@domain/Layer.ts";

/** Patch de transform : chaque canal (position/rotation/échelle) partiellement modifiable. */
export interface TransformPatch { position?: Partial<Vec3>; rotation?: Partial<Vec3>; scale?: Partial<Vec3>; }

/** Outil actif de l'éditeur 3D : curseur de sélection ou l'un des trois modes de gizmo. */
export type EditorTool = "select" | "translate" | "rotate" | "scale";
import { createLayer } from "./engine/layers/index.ts";
import { LAYER_ID, type Layer as EngineLayer } from "./engine/layers/Layer.ts";
import { Scene3DLayer } from "./engine/layers/Scene3D.layer.ts";
import { SolidLayer } from "./engine/layers/Solid.layer.ts";
import { VideoWallLayer } from "./engine/layers/Video.layer.ts";
import { countLit, type ShapeFill, type ShapeInput } from "./engine/shapes.ts";
import { Animator } from "./Animator.ts";
import { sampleKeyframes, type Composition, type Interp, type Track } from "@domain/Composition.ts";

/** Un point du chemin d'animation (motion path) : position monde du calque à un frame keyframé. */
export interface MotionPoint { frame: number; x: number; y: number; z: number; }

/** Pixels décodés d'une image (ou d'une frame vidéo) — mis en cache hors du document (non sérialisable). */
interface DecodedBitmap { data: Uint8ClampedArray; width: number; height: number; }
/** Résolution de secours tant qu'une image/vidéo n'est pas encore décodée. */
const FALLBACK_FILL: ShapeFill = { kind: "solid", color: { r: 1, g: 1, b: 1 } };
/** Taille d'échantillonnage d'une frame vidéo : suffisant pour un mur LED, coûte peu à relire chaque frame. */
const VIDEO_SAMPLE_SIZE = 64;

export type EditorListener = () => void;

/** Libellé par défaut d'une primitive créée depuis le rail. */
const SHAPE_LABEL: Record<ShapeKind, string> = {
  sphere: "Sphère", box: "Cube", cylinder: "Cylindre", cone: "Cône", plane: "Plan", torus: "Tore",
};

/** Document seed : reprend les 3 calques shader + 2 objets 3D de l'état d'origine. */
function seedDocument(): Document {
  const root = makeGroup("root", "Composition");

  const sweep = makeShaderLayer("sweep-1", "sweep", "Balayage");
  sweep.blend = "add";
  sweep.opacity = 0.8;

  const plasma = makeShaderLayer("plasma-1", "plasma", "Plasma");
  plasma.params = { speed: 0.42, detail: 0.7, contrast: 0.55, hue: 0.57 };

  const solid = makeShaderLayer("solid-1", "solid", "Couleur unie");
  solid.color = { r: 0.11, g: 0.055, b: 0.024 }; // #1c0e06

  const sphere = makeShape("sphere-1", "sphere", "Sphère 01");
  sphere.transform = { position: { x: -0.28, y: 0.12, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.34, y: 0.34, z: 0.34 } };
  sphere.fill = { type: "solid", color: { r: 1, g: 0.541, b: 0.239 } };

  const box = makeShape("box-1", "box", "Cube 01");
  box.transform = { position: { x: 0.42, y: -0.14, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.26, y: 0.26, z: 0.26 } };
  box.fill = { type: "solid", color: { r: 1, g: 0.541, b: 0.239 } };

  root.children.push(sweep, plasma, solid, sphere, box);
  return { root, activeGroupId: "root", selectedId: "plasma-1" };
}

/**
 * Store du document (arbre unifié) + miroir moteur. L'app le modifie ; le moteur en
 * est le reflet (uniforms + reconstruction de la pile du groupe actif). `core` agnostique
 * de l'UI ; convention subscribe/notify (compatible pont Solid `fromStore`).
 */
export class Editor {
  private _doc = seedDocument();
  private readonly _listeners = new Set<EditorListener>();
  private readonly _shaderLive = new Map<string, EngineLayer>();
  private readonly _videoLive = new Map<string, EngineLayer>();
  private _scene3d: Scene3DLayer | null = null;
  private _engine: Engine | null = null;
  private _counter = 0;
  private _tool: EditorTool = "select";
  private _frame = 0;              // dernier frame évalué (instant courant pour l'auto-key)
  private _sceneDirty = false;     // un canal de shape a changé → 1 seul recompute par frame
  private _lastActiveSig = "";     // signature du set de calques actifs (clips) au dernier _push
  private readonly _animator = new Animator((id, channel, value) => this._applyChannel(id, channel, value));

  // fills image/vidéo : décodage async + lecture, mis en cache hors du document (par id de shape)
  private readonly _imagePixels = new Map<string, DecodedBitmap>();
  private readonly _videoEls = new Map<string, HTMLVideoElement>();
  private _videoSampleCanvas: HTMLCanvasElement | null = null;

  // ————————————————————————————————— Lecture —————————————————————————————————

  get rootId(): string { return this._doc.root.id; }
  get activeGroupId(): string { return this._doc.activeGroupId; }
  get selectedId(): string | null { return this._doc.selectedId; }
  get tool(): EditorTool { return this._tool; }

  /** enfants du groupe actif (ce qu'affichent Compositor/Scène/Editor 3D). */
  get children(): readonly Layer[] { return groupChildren(this._doc, this._doc.activeGroupId); }

  /** nœud sélectionné (n'importe où dans l'arbre). */
  get selected(): Layer | null {
    return this._doc.selectedId ? findLayer(this._doc.root, this._doc.selectedId) : null;
  }

  getDocument(): Document {
    return this._doc;
  }

  loadDocument(doc: Document): void {
    this._doc = doc;
    this._push();
    this._emit();
  }

  loadComposition(comp: Composition): void {
    this._animator.load(comp);
  }

  getComposition(): Composition {
    return this._animator.composition;
  }

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
    if (id === this._doc.selectedId) return;
    this._doc.selectedId = id;
    this._emit();
  }

  /** Outil actif (curseur / gizmo). Partagé par le rail et l'éditeur 3D. */
  setTool(tool: EditorTool): void {
    if (tool === this._tool) return;
    this._tool = tool;
    this._emit();
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
    const dot = channel.indexOf(".");
    const group = channel.slice(0, dot);
    const key = channel.slice(dot + 1);
    if (group === "position" || group === "rotation" || group === "scale") {
      this.setTransform(id, { [group]: { [key]: value } } as TransformPatch);
    } else if (group === "param") {
      this.setParam(id, key, value);
    } else if (group === "color") {
      if (layer.type === "shader") this.setColor(id, { ...layer.color, [key]: value } as RGB);
      else if (layer.type === "shape" && layer.fill.type === "solid") this.setFill(id, { type: "solid", color: { ...layer.fill.color, [key]: value } as RGB });
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

  /** Change l'interpolation d'une clé (linéaire / hold / bézier). */
  setKeyframeInterp(id: string, channel: string, frame: number, interp: Interp): void {
    this._animator.setInterp(id, channel, frame, interp);
    const layer = findLayer(this._doc.root, id);
    if (layer?.type === "shape") this._recomputeScene();
    this._emit();
  }

  /** Pose une clé complète (valeur + interp) sur un canal, créant la track au besoin (pour le coller). */
  putKeyframe(id: string, channel: string, frame: number, value: number, interp: Interp): void {
    this._animator.putKey(id, channel, frame, value, interp);
    const layer = findLayer(this._doc.root, id);
    if (layer?.type === "shape") this._recomputeScene();
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
    // parenté : le chemin (positions locales keyframées) est exprimé dans l'espace du parent
    const parentM = layer?.parentId ? this._worldMatrix(layer.parentId) : null;
    const at = (t: Track | undefined, fallback: number, frame: number): number =>
      t && t.keyframes.length ? sampleKeyframes(t.keyframes, frame) : fallback;
    return [...frames].sort((a, b) => a - b).map((frame) => {
      const local = new Vector3(at(tx, base.x, frame), at(ty, base.y, frame), at(tz, base.z, frame));
      if (parentM) local.applyMatrix4(parentM);
      return { frame, x: local.x, y: local.y, z: local.z };
    });
  }

  enterGroup(id: string): void {
    if (!findGroup(this._doc.root, id)) return;
    this._doc.activeGroupId = id;
    this._doc.selectedId = null;
    this._push();
    this._emit();
  }

  exitGroup(): void {
    const parent = findParent(this._doc.root, this._doc.activeGroupId);
    if (!parent) return;
    this._doc.activeGroupId = parent.id;
    this._doc.selectedId = null;
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
      
      // Si la couche supprimée était sélectionnée, on réinitialise la sélection
      if (this._doc.selectedId === id) {
        this._doc.selectedId = null;
      }
      
      this._push();
      this._emit();
    }
  }

  deleteSelected(): void {
    if (this._doc.selectedId) {
      this.deleteLayer(this._doc.selectedId);
    }
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

  addGroup(): string {
    this._counter += 1;
    const id = `group-${this._counter}`;
    const group = makeGroup(id, `Groupe ${String(this._counter).padStart(2, "0")}`);
    this._activeGroup().children.unshift(group);
    this._doc.selectedId = id;
    this._push();
    this._emit();
    return id;
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

  /** Volume d'une piste audio (gain ≥ 0). Non rendu sur le mur → pas de `_push`. */
  setAudioGain(id: string, gain: number): void {
    const l = findLayer(this._doc.root, id);
    if (l?.type !== "audio") return;
    l.gain = Math.max(0, gain);
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

  /** Parente un calque (transform hérité), ou le détache (null). Refuse un cycle. */
  setParent(id: string, parentId: string | null): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || id === parentId) return;
    if (parentId && wouldCycle(this._doc.root, id, parentId)) return;
    layer.parentId = parentId || undefined;
    this._recomputeScene();
    this._emit();
  }

  /** Transform monde d'un calque (compose la chaîne de parents). */
  worldTransform(id: string): Transform {
    const p = new Vector3(), q = new Quaternion(), s = new Vector3();
    this._worldMatrix(id).decompose(p, q, s);
    const e = new Euler().setFromQuaternion(q, "XYZ");
    return { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: e.x, y: e.y, z: e.z }, scale: { x: s.x, y: s.y, z: s.z } };
  }

  /** Écrit un transform exprimé en monde → stocke le local (monde ÷ parent). Pour le gizmo d'un calque parenté. */
  setWorldTransform(id: string, world: Transform): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    let local = this._matrixOf(world);
    if (layer.parentId) local = this._worldMatrix(layer.parentId).invert().multiply(local);
    const p = new Vector3(), q = new Quaternion(), s = new Vector3();
    local.decompose(p, q, s);
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
    this._pushFixtures();
    this._emit();
  }

  setLyreChannels(id: string, patch: Partial<LyreChannels>): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer || layer.type !== "lyre") return;
    layer.channels = { ...layer.channels, ...patch };
    this._pushFixtures();
    this._emit();
  }

  /** appelé chaque frame moteur : évalue les keyframes puis (au besoin) re-rasterise les shapes. */
  tick(frame: number, playing = false, fps = 24): void {
    this._frame = frame;
    this._sceneDirty = false;
    this._animator.evaluate(frame);
    if (this._activeSignature() !== this._lastActiveSig) {
      this._push(); // un calque a franchi un bord de clip → reconstruit la pile (re-rasterise aussi les shapes)
    } else if (this._sceneDirty || this._videoEls.size > 0) {
      this._recomputeScene();
    }
    this._syncVideos(frame, playing, fps);
  }

  /** Synchronise les `<video>` plein-cadre sur le playhead : play en lecture, seek en pause/scrub. */
  private _syncVideos(frame: number, playing: boolean, fps: number): void {
    for (const [id, el] of this._videoEls) {
      const layer = findLayer(this._doc.root, id);
      if (layer?.type !== "video") continue; // les fills vidéo de shapes gardent leur boucle libre
      const clip = layer.clips?.find((c) => mediaClipActiveAt(c, frame));
      const active = layer.visible && (clip !== undefined || (!layer.clips && layerActiveAt(layer.clip, frame)));
      if (!active) { if (!el.paused) el.pause(); continue; }
      const targetSec = (clip ? mediaSourceFrameAt(clip, frame) : frame) / (fps > 0 ? fps : 24);
      if (playing) {
        if (el.paused) void el.play().catch(() => {});
        if (Math.abs(el.currentTime - targetSec) > 0.2) el.currentTime = targetSec; // reslave
      } else {
        if (!el.paused) el.pause();
        el.currentTime = targetSec; // scrub image par image
      }
      // fondu du clip → opacité du layer moteur (mise à jour continue)
      const live = this._videoLive.get(id);
      if (live && clip) live.opacity = layer.opacity * mediaFadeGain(clip, frame);
    }
  }

  subscribe(listener: EditorListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  // ————————————————————————————————— Interne —————————————————————————————————

  /** Écrit la valeur d'un canal scalaire dans le modèle + le moteur (appelé par l'Animator). */
  private _applyChannel(id: string, channel: string, value: number): void {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return;
    if (channel === "opacity") {
      layer.opacity = value;
      const live = this._shaderLive.get(id);
      if (live) live.opacity = value;
      if (layer.type === "shape") this._sceneDirty = true;
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
    }
  }

  /** Lit la valeur courante d'un canal (pour la 1re clé). undefined si non applicable. */
  private _readChannel(id: string, channel: string): number | undefined {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return undefined;
    if (channel === "opacity") return layer.opacity;
    const dot = channel.indexOf(".");
    const group = channel.slice(0, dot);
    const key = channel.slice(dot + 1);
    if (group === "position" || group === "rotation" || group === "scale") {
      return layer.transform[group][key as keyof Vec3];
    }
    if (group === "param" && layer.type === "shader") return layer.params[key];
    if (group === "color") {
      const c = key as keyof RGB;
      if (layer.type === "shader") return layer.color[c];
      if (layer.type === "shape" && layer.fill.type === "solid") return layer.fill.color[c];
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

  /** Matrice monde d'un calque (parentWorld * local), en remontant la chaîne (garde anti-cycle). */
  private _worldMatrix(id: string, guard: Set<string> = new Set()): Matrix4 {
    const layer = findLayer(this._doc.root, id);
    if (!layer) return new Matrix4();
    const local = this._matrixOf(layer.transform);
    if (!layer.parentId || guard.has(id)) return local;
    guard.add(id);
    return this._worldMatrix(layer.parentId, guard).multiply(local);
  }

  private _toInput(s: ShapeLayer): ShapeInput {
    const w = this.worldTransform(s.id); // transform monde (parenté inclus) pour le rendu sur le mur
    return { kind: s.shape, position: w.position, rotation: w.rotation, scale: w.scale, fill: this._resolveFill(s), opacity: s.opacity };
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
    }
  }

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

  /** Un calque VISUEL du groupe actif est-il en solo ? (si oui, seuls les solos visuels rendent).
   *  L'audio est exclu : son solo/mute est géré par l'AudioSync, pas par le rendu mur/DMX. */
  private _anySolo(): boolean {
    return this._activeGroup().children.some((c) => c.solo && c.type !== "audio");
  }

  private _shapeInputs(): ShapeInput[] {
    const anySolo = this._anySolo();
    return this._activeGroup().children
      .filter((l): l is ShapeLayer => l.type === "shape" && l.visible && layerActiveAt(l.clip, this._frame) && (!anySolo || !!l.solo))
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
      if ((l.type === "spot" || l.type === "lyre") && l.visible && layerActiveAt(l.clip, this._frame) && (!anySolo || l.solo)) {
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

    const shapes = this._shapeInputs();
    scene3d.setShapes(shapes);
    this._pushFixtures();

    const anySolo = this._anySolo();
    const stack: EngineLayer[] = [];
    let sceneAdded = false;
    for (const child of this._activeGroup().children) {
      if (child.type === "shader") {
        if (layerActiveAt(child.clip, this._frame) && (!anySolo || child.solo)) stack.push(this._ensureShader(child));
      } else if (child.type === "shape") {
        // un seul calque Scene3D agrégé (position de la 1re shape) tant qu'il reste des shapes actives
        if (!sceneAdded && shapes.length > 0) { stack.push(scene3d); sceneAdded = true; }
      } else if (child.type === "video") {
        const active = child.clips ? child.clips.some((c) => mediaClipActiveAt(c, this._frame)) : layerActiveAt(child.clip, this._frame);
        if (child.visible && active && (!anySolo || child.solo)) stack.push(this._ensureVideo(child));
      }
      // group/image/spot/lyre : non rendus sur le mur (navigables / repère visuel seulement)
    }
    // ordre d'affichage (haut = avant) → ordre moteur inversé (le haut rend en dernier)
    engine.setLayers([...stack].reverse());
    this._lastActiveSig = this._activeSignature();
  }

  /** Signature du set de calques actifs (clips) au frame courant — détecte un franchissement de bord dans `tick`. */
  private _activeSignature(): string {
    let sig = "";
    for (const child of this._activeGroup().children) {
      if (layerActiveAt(child.clip, this._frame)) sig += child.id + ",";
    }
    return sig;
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
    for (const listener of this._listeners) listener();
  }
}

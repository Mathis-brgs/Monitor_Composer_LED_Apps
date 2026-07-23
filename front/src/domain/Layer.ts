export interface RGB { r: number; g: number; b: number; }
export type BlendMode = "normal" | "add";
export type ShaderId = "solid" | "plasma" | "sweep";
export type ShapeKind = "sphere" | "box" | "cylinder" | "cone" | "plane" | "torus" | "triangle";

export interface Vec3 { x: number; y: number; z: number; }
/** Transform façon Blender : position, rotation (Euler XYZ en radians), échelle — par axe. */
export interface Transform { position: Vec3; rotation: Vec3; scale: Vec3; }

/** Fenêtre d'activité d'un calque sur la timeline, en frames. Actif si `in ≤ frame ≤ out`. */
export interface Clip { in: number; out: number; }

/**
 * Clip de montage (edit list, façon Premiere) : portion `[sourceIn, sourceOut[` d'une source,
 * posée à `timelineIn` sur la timeline, jouée à `speed` (1 = temps réel). Tout en frames.
 * Distinct de `Clip` (simple fenêtre d'activité) : c'est une décision de montage.
 */
export interface MediaClip {
  id: string;
  sourceIn: number;
  sourceOut: number;
  timelineIn: number;
  speed: number;
  /** Fondu d'entrée (frames) : le gain monte 0→1 sur cette durée depuis le début du clip. */
  fadeIn?: number;
  /** Fondu de sortie (frames) : le gain descend 1→0 sur cette durée jusqu'à la fin du clip. */
  fadeOut?: number;
}

/** Remappage linéaire clampé d'une valeur d'entrée vers une sortie (bindings). */
export interface MapRange { inMin: number; inMax: number; outMin: number; outMax: number; }

/** Association audio-reactive : une feature d'un calque audio pilote un canal (mixée par-dessus les clés). */
export interface AudioBinding {
  sourceLayerId: string;
  feature: "amplitude" | "band" | "beat";
  /** Bande de fréquence [minHz, maxHz] quand `feature === "band"`. */
  bandRange?: [number, number];
  targetChannel: string;
  map: MapRange;
}

/** Association spatiale : une région d'un média pilote un canal (fixture / zone du mur). */
export interface SpatialBinding {
  mediaLayerId: string;
  region: { x: number; y: number; w: number; h: number };
  feature: "luma" | "color";
  targetChannel: string;
  map: MapRange;
}

interface LayerBase {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  blend: BlendMode;
  transform: Transform;
  /** Fenêtre d'activité (clip). Absent = pleine durée (toujours actif). */
  clip?: Clip;
  /** Solo : si au moins un calque du groupe est en solo, seuls les solos rendent. */
  solo?: boolean;
  /** Verrou : non sélectionnable / non éditable tant que verrouillé. */
  locked?: boolean;
  /** Couleur de label (hex) pour le tri visuel. Absent = pas de label. */
  label?: string;
  /** Groupe temporel (montage) : hérite la fenêtre active du clip média parent. */
  mediaGroupId?: string;
  /** Bindings audio-reactifs : pilotent un canal depuis une feature d'un calque audio. */
  audioBindings?: AudioBinding[];
  /** Bindings spatiaux : pilotent un canal depuis une région d'un média. */
  spatialBindings?: SpatialBinding[];
}

export interface ShaderLayer extends LayerBase { type: "shader"; shader: ShaderId; params: Record<string, number>; color: RGB; }

/** Remplissage d'une shape : couleur unie, dégradé linéaire (angle en radians), média (data URL,
 *  embarqué dans le projet), matériau personnalisé (référence un `MaterialPreset` du document),
 *  ou séquence PRÉ-RENDUE (frames calculées une fois à l'avance, hors du document — voir
 *  `Editor.setPrerenderedFrames` — non sérialisable, ne survit pas à une sauvegarde/rechargement). */
export type Fill =
  | { type: "solid"; color: RGB }
  | { type: "gradient"; from: RGB; to: RGB; angle: number }
  | { type: "image"; dataUrl: string }
  | { type: "video"; dataUrl: string }
  | { type: "material"; presetId: string }
  | { type: "prerender" };

/** Mode de rendu d'un matériau : "basic" = couleur brute (unlit), "emission" = même couleur
 *  boostée en intensité (effet "qui brille" pour des LEDs pilotées en valeurs brutes — pas de
 *  PBR/éclairage réaliste, jamais de "standard" : le mur est un afficheur, pas une scène éclairée). */
export type MaterialMode = "basic" | "emission";

/**
 * Matériau personnalisé : un fragment TSL (même langage que les autres calques moteur —
 * `Plasma.layer.ts`/`Sweep.layer.ts` — pas du WGSL brut) baké hors-écran en texture, puis
 * échantillonné comme un fill bitmap classique (même chemin qu'image/vidéo) — voir
 * `Editor._resolveFill` / `MaterialBaker`. Stocké dans `Document.materials`, réutilisable par
 * plusieurs shapes via `Fill.presetId` (façon bibliothèque de presets).
 * `vertex` est réservé : un fill est une texture plate échantillonnée sur la géométrie de la
 * shape, pas une géométrie déformable — il n'est pas encore évalué au rendu.
 */
export interface MaterialPreset {
  id: string;
  name: string;
  mode: MaterialMode;
  fragment: string;
  vertex: string;
}

export interface ShapeLayer extends LayerBase { type: "shape"; shape: ShapeKind; fill: Fill; /** afficher le wireframe (helper d'édition) dans l'Editor 3D */ showHelper: boolean; }

/**
 * Corps TSL de la **simulation compute** d'un système de particules — personnalisable, exactement comme
 * le `fragment` d'un `MaterialPreset` (voir `MaterialBaker`). Exécuté par particule à chaque frame ;
 * doit `return` la nouvelle position (vec3). En scope : `pos` (vec3, position courante), `info` (vec3,
 * données statiques par particule : x,y ∈ [0.5,1.5]), `time` (float, secondes), `speed` (float), `noise`
 * (float, intensité), `idx` (float, index), `snoise(p)` (bruit vec3 → -1..1) + toutes les fonctions TSL.
 * Défaut = anneau/donut (relaxation radiale, repris de `Creative-Post-processing/simulation.frag`).
 */
export const DEFAULT_PARTICLE_SIM = `// Donut : relaxation radiale (repris de simulation.frag)
const r0 = pos.xy.length().mul(0.8);
const cent = smoothstep(0.5, 0.51, info.x.sub(r0).abs()).oneMinus();
const ang = atan(pos.y, pos.x).sub(info.y.mul(0.3).mul(mix(0.5, 1.0, cent)));
const targetR = mix(info.x, float(1.5), ang.mul(2.0).add(time.mul(speed)).add(3.14159265).sin().mul(0.5).add(0.6));
const r = r0.add(targetR.sub(r0).mul(0.1));
const n = snoise(pos.mul(2.0).add(vec3(0.0, 0.0, time.mul(0.1)))).mul(0.003).mul(noise);
const nx = pos.x.add(ang.cos().mul(r).mul(1.1).sub(pos.x).mul(0.1)).add(n.x);
const ny = pos.y.add(ang.sin().mul(r).mul(1.1).sub(pos.y).mul(0.1)).add(n.y);
return vec3(nx, ny, 0.0);`;

/** Un paramètre custom déclaré par une simulation : nom (variable en scope de la sim), valeur, bornes du slider. */
export interface SimParamDef { name: string; value: number; min: number; max: number; }

/** Paramètres par défaut de la sim donut : `speed` (rotation) et `noise` (agitation), utilisés par `DEFAULT_PARTICLE_SIM`. */
export function defaultSimParams(): SimParamDef[] {
  return [
    { name: "speed", value: 1, min: 0, max: 5 },
    { name: "noise", value: 1, min: 0, max: 5 },
  ];
}

/**
 * Preset de simulation de particules : un corps TSL compute (`code`) + ses **paramètres custom**
 * (`params`, deviennent des variables en scope de la sim), exactement comme un `MaterialPreset`
 * (`fragment` + presets réutilisables) mais côté compute. Stocké dans la bibliothèque stable
 * `Editor._simulations` (sérialisée dans `Project.simulations`), réutilisable par plusieurs calques
 * `ParticlesLayer` via `simId`. Les valeurs courantes des params vivent sur le calque (`simValues`,
 * keyframables), pas ici — le preset ne porte que les défauts.
 */
export interface SimPreset {
  id: string;
  name: string;
  /** corps TSL de la simulation compute — voir `DEFAULT_PARTICLE_SIM`. */
  code: string;
  /** paramètres custom déclarés (variables en scope de `code` + contrôles keyframables `simParam.<name>`). */
  params: SimParamDef[];
}

/** Id du preset donut par défaut — toujours présent dans la bibliothèque (`Editor._simulations[0]`). */
export const DEFAULT_SIM_ID = "sim-donut";

/** Preset de simulation par défaut : donut (relaxation radiale) + params `speed`/`noise`. */
export function defaultSimPreset(): SimPreset {
  return { id: DEFAULT_SIM_ID, name: "Donut", code: DEFAULT_PARTICLE_SIM, params: defaultSimParams() };
}

/**
 * Système de particules GPU : référence une simulation partagée de la bibliothèque (`simId` → `SimPreset`)
 * — sim compute TSL personnalisable + paramètres custom réutilisables. Les valeurs courantes des params
 * (`simValues`) sont propres au calque et keyframables (canal `simParam.<name>`). Rendu en points additifs.
 */
export interface ParticlesLayer extends LayerBase {
  type: "particles";
  count: number;
  /** taille du point (px sur la RT 128×128). */
  size: number;
  /** couleur au bord (rayon max). */
  color: RGB;
  /** couleur au centre (rayon min). */
  colorEnd: RGB;
  /** preset de simulation référencé (bibliothèque `Editor._simulations`). */
  simId: string;
  /** valeurs courantes des params du preset (keyframables, canal `simParam.<name>`). */
  simValues: Record<string, number>;
}
export interface GroupLayer extends LayerBase { type: "group"; children: Layer[]; }
export interface ImageLayer extends LayerBase { type: "image"; assetId: string; /** Montage (edit list) ; absent = source entière. */ clips?: MediaClip[]; }
export interface VideoLayer extends LayerBase { type: "video"; assetId: string; /** Montage (edit list) ; absent = source entière. */ clips?: MediaClip[]; }
/** Piste audio : non spatiale, exclue du rendu mur/3D. `gain` = volume (0..1+). */
export interface AudioLayer extends LayerBase { type: "audio"; assetId: string; gain: number; /** Montage (edit list) ; absent = source entière. */ clips?: MediaClip[]; }

/**
 * Appareils DMX du show (doc prof) : adressés en canaux bruts sur le 4e
 * contrôleur (192.168.1.48), univers 33 — routés par le Go via des entités
 * eHuB dont l'ID = numéro de canal (1-indexé) et dont seule la composante R
 * porte la valeur (0-255). Aucun rendu sur le mur : simple repère visuel
 * dans l'éditeur 3D (voir `transform.position`).
 */
export interface SpotChannels { r: number; g: number; b: number; w: number; }
export interface LyreChannels {
  pan: number; panFine: number; tilt: number; tiltFine: number;
  speed: number; dimmer: number; strobe: number;
  r: number; g: number; b: number; w: number;
  special: number; reset: number;
}
/** Projecteur statique : `baseChannel` = 1er de ses 4 canaux (R/G/B/W) — éditable si le patch DMX change. */
export interface SpotLayer extends LayerBase { type: "spot"; baseChannel: number; channels: SpotChannels; }
/** Lyre (tête mobile) : `baseChannel` = 1er de ses 13 canaux — éditable si le patch DMX change. */
export interface LyreLayer extends LayerBase { type: "lyre"; baseChannel: number; channels: LyreChannels; }

/**
 * Instance de composition imbriquée (précomp OU prérendu) : joue la composition `compId`
 * et la rend comme un seul calque. Frontière opaque : son arbre vit dans SA composition,
 * pas dans ce calque (pas de `children` ici). `timeOffset`/`speed` mappent le frame parent
 * vers le temps local de la comp enfant.
 */
export interface PrecompLayer extends LayerBase {
  type: "precomp";
  compId: string;
  /** Frame local de la comp au début (timelineIn) de l'instance. */
  timeOffset: number;
  /** Étirement temporel (1 = 1:1). */
  speed: number;
}

export type Layer = ShaderLayer | ShapeLayer | GroupLayer | ImageLayer | VideoLayer | AudioLayer | SpotLayer | LyreLayer | PrecompLayer | ParticlesLayer;

/** Suggestions de départ (doc prof), purement indicatives — `baseChannel` reste libre et modifiable ensuite. */
export const SPOT_DEFAULT_BASE = 1;
export const LYRE_DEFAULT_BASES = [10, 30, 50, 70] as const;
export const SPOT_CHANNEL_COUNT = 4;
export const LYRE_CHANNEL_COUNT = 13;
const LYRE_CHANNEL_ORDER: (keyof LyreChannels)[] = [
  "pan", "panFine", "tilt", "tiltFine", "speed", "dimmer", "strobe", "r", "g", "b", "w", "special", "reset",
];

/** Canaux DMX bruts (numéro 1-indexé → valeur 0-255) d'un spot/lyre, prêts pour l'encodage eHuB. */
export function fixtureDmxChannels(l: SpotLayer | LyreLayer): { channel: number; value: number }[] {
  if (l.type === "spot") {
    const { r, g, b, w } = l.channels;
    return [r, g, b, w].map((value, i) => ({ channel: l.baseChannel + i, value }));
  }
  return LYRE_CHANNEL_ORDER.map((key, i) => ({ channel: l.baseChannel + i, value: l.channels[key] }));
}

/** Couleur représentative d'un fill (wireframe/vignette) : couleur unie, moyenne pour un dégradé, blanc pour un média. */
export function fillPreviewColor(fill: Fill): RGB {
  switch (fill.type) {
    case "solid": return fill.color;
    case "gradient": return { r: (fill.from.r + fill.to.r) / 2, g: (fill.from.g + fill.to.g) / 2, b: (fill.from.b + fill.to.b) / 2 };
    case "image":
    case "video":
    case "material":
    case "prerender": return { r: 1, g: 1, b: 1 };
  }
}

// ————————————————————————————————— Clips —————————————————————————————————

/** Le calque est-il actif à ce frame ? Pas de clip → toujours vrai. */
export function layerActiveAt(clip: Clip | undefined, frame: number): boolean {
  return !clip || (frame >= clip.in && frame <= clip.out);
}

const clampFrame = (f: number, dur: number): number => Math.max(0, Math.min(dur, Math.round(f)));

/** Décale in+out de `delta` frames en gardant la longueur, borné à `[0, dur]`. */
export function moveClip(clip: Clip, delta: number, dur: number): Clip {
  const len = clip.out - clip.in;
  const start = Math.max(0, Math.min(dur - len, clip.in + Math.round(delta)));
  return { in: start, out: start + len };
}

/** Bouge le bord `in`, garde `in ≤ out` (min 1 frame), borné à `[0, dur]`. */
export function trimIn(clip: Clip, frame: number, dur: number): Clip {
  return { in: Math.min(clip.out, clampFrame(frame, dur)), out: clip.out };
}

/** Bouge le bord `out`, garde `out ≥ in` (min 1 frame), borné à `[0, dur]`. */
export function trimOut(clip: Clip, frame: number, dur: number): Clip {
  return { in: clip.in, out: Math.max(clip.in, clampFrame(frame, dur)) };
}

// ————————————————————————————— Montage média —————————————————————————————

/** Longueur d'un clip de montage sur la timeline (frames), selon la portion source et la vitesse. */
export function mediaClipLength(c: MediaClip): number {
  return Math.max(1, Math.round((c.sourceOut - c.sourceIn) / c.speed));
}

/** Frame de fin sur la timeline (exclusive). */
export function mediaClipTimelineOut(c: MediaClip): number {
  return c.timelineIn + mediaClipLength(c);
}

/** Le clip de montage est-il actif à ce frame de timeline ? (in inclus, out exclu) */
export function mediaClipActiveAt(c: MediaClip, frame: number): boolean {
  return frame >= c.timelineIn && frame < mediaClipTimelineOut(c);
}

/** Frame de la SOURCE à afficher pour un frame de timeline donné (clampé à la portion). */
export function mediaSourceFrameAt(c: MediaClip, frame: number): number {
  const local = (frame - c.timelineIn) * c.speed;
  return Math.max(c.sourceIn, Math.min(c.sourceOut, c.sourceIn + Math.round(local)));
}

/** Déplace le clip de `delta` frames sur la timeline (borné à ≥ 0). */
export function moveMediaClip(c: MediaClip, delta: number): MediaClip {
  return { ...c, timelineIn: Math.max(0, c.timelineIn + Math.round(delta)) };
}

/** Rogne le bord d'entrée à `frame` (timeline) : avance la source d'autant, garde ≥ 1 frame de source. */
export function trimMediaIn(c: MediaClip, frame: number): MediaClip {
  const t = Math.max(0, Math.min(mediaClipTimelineOut(c) - 1, Math.round(frame)));
  const deltaSource = Math.round((t - c.timelineIn) * c.speed);
  const sourceIn = Math.max(0, Math.min(c.sourceOut - 1, c.sourceIn + deltaSource));
  return { ...c, sourceIn, timelineIn: t };
}

/** Rogne le bord de sortie à `frame` (timeline) : ajuste `sourceOut`, garde ≥ 1 frame.
 *  La borne haute réelle (durée de la source décodée) est clampée par l'appelant. */
export function trimMediaOut(c: MediaClip, frame: number): MediaClip {
  const t = Math.max(c.timelineIn + 1, Math.round(frame));
  const sourceOut = c.sourceIn + Math.round((t - c.timelineIn) * c.speed);
  return { ...c, sourceOut: Math.max(c.sourceIn + 1, sourceOut) };
}

/** Coupe le clip au frame `frame` (timeline) → `[avant, après]`, ou null si hors bornes.
 *  `newId` = id du 2e clip (la génération d'id reste hors du domaine pur). */
export function splitMediaClip(c: MediaClip, frame: number, newId: string): [MediaClip, MediaClip] | null {
  const f = Math.round(frame);
  if (f <= c.timelineIn || f >= mediaClipTimelineOut(c)) return null;
  const cutSource = mediaSourceFrameAt(c, f);
  return [
    { ...c, sourceOut: cutSource },
    { ...c, id: newId, sourceIn: cutSource, timelineIn: f },
  ];
}

/** Facteur de gain du fondu (0..1) d'un clip à un frame timeline donné (1 hors des fondus). */
export function mediaFadeGain(c: MediaClip, frame: number): number {
  const len = mediaClipLength(c);
  const local = frame - c.timelineIn;
  if (local < 0 || local > len) return 0;
  let g = 1;
  const fin = c.fadeIn ?? 0;
  const fout = c.fadeOut ?? 0;
  if (fin > 0 && local < fin) g = Math.min(g, local / fin);
  if (fout > 0 && local > len - fout) g = Math.min(g, (len - local) / fout);
  return Math.max(0, Math.min(1, g));
}

/**
 * Groupe temporel (association « groupé sous un média ») : un calque avec
 * `mediaGroupId` n'est actif que quand le média parent l'est (fenêtre de ses clips
 * de montage, sinon son clip simple). Sans groupe → toujours actif (selon son propre clip).
 */
export function mediaGroupActiveAt(root: GroupLayer, layer: Layer, frame: number): boolean {
  if (!layer.mediaGroupId) return true;
  const parent = findLayer(root, layer.mediaGroupId);
  if (!parent) return true;
  if (parent.type === "audio" || parent.type === "video") {
    const clips = parent.clips;
    if (clips && clips.length) return clips.some((c) => mediaClipActiveAt(c, frame));
  }
  return layerActiveAt(parent.clip, frame);
}

/** Remappage linéaire clampé d'une valeur via une `MapRange` (pour les bindings). */
export function applyMap(map: MapRange, v: number): number {
  if (map.inMax === map.inMin) return map.outMin;
  const t = Math.max(0, Math.min(1, (v - map.inMin) / (map.inMax - map.inMin)));
  return map.outMin + t * (map.outMax - map.outMin);
}

/** Document = arbre (racine) + groupe où l'on se trouve + sélection + bibliothèque de matériaux.
 *  `materials` optionnel : absent sur les documents/projets antérieurs à cette fonctionnalité. */
export interface Document { root: GroupLayer; activeGroupId: string; selectedId: string | null; materials?: MaterialPreset[]; }

const vec3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
const ORIGIN = (): Transform => ({ position: vec3(), rotation: vec3(), scale: vec3(0.3, 0.3, 0.3) });
const WHITE = (): RGB => ({ r: 1, g: 1, b: 1 });

function base(id: string, name: string): LayerBase {
  return { id, name, visible: true, opacity: 1, blend: "normal", transform: ORIGIN() };
}

export function makeGroup(id: string, name: string): GroupLayer {
  return { ...base(id, name), type: "group", children: [] };
}
export function makeShape(id: string, shape: ShapeKind, name: string): ShapeLayer {
  return { ...base(id, name), type: "shape", shape, fill: { type: "solid", color: WHITE() }, showHelper: true };
}
export function makeShaderLayer(id: string, shader: ShaderId, name: string): ShaderLayer {
  return { ...base(id, name), type: "shader", shader, params: {}, color: WHITE() };
}
/** Piste audio : gain 1 par défaut. Transform/opacity hérités de base mais ignorés au rendu. */
export function makeAudio(id: string, name: string, assetId: string): AudioLayer {
  return { ...base(id, name), type: "audio", assetId, gain: 1 };
}
/** Vidéo plein-cadre : `assetId` = URL (object URL / data URL) de la source. */
export function makeVideo(id: string, name: string, assetId: string): VideoLayer {
  return { ...base(id, name), type: "video", assetId };
}
/** Éteint par défaut (sécurité physique : pas de flash inattendu à la création). */
export function makeSpot(id: string, name: string, baseChannel: number): SpotLayer {
  return { ...base(id, name), type: "spot", baseChannel, channels: { r: 0, g: 0, b: 0, w: 0 } };
}
export function makeLyre(id: string, name: string, baseChannel: number): LyreLayer {
  return {
    ...base(id, name),
    type: "lyre",
    baseChannel,
    channels: { pan: 127, panFine: 0, tilt: 127, tiltFine: 0, speed: 0, dimmer: 0, strobe: 0, r: 0, g: 0, b: 0, w: 0, special: 0, reset: 0 },
  };
}
/** Instance jouant la composition `compId` (précomp ou prérendu) : sans décalage, à vitesse 1. */
export function makePrecomp(id: string, name: string, compId: string): PrecompLayer {
  return { ...base(id, name), type: "precomp", compId, timeOffset: 0, speed: 1 };
}
/** Système de particules : référence le preset donut par défaut. Composité en additif. */
export function makeParticles(id: string, name: string): ParticlesLayer {
  const values: Record<string, number> = {};
  for (const p of defaultSimParams()) values[p.name] = p.value;
  return {
    ...base(id, name),
    type: "particles",
    blend: "add",
    count: 2000,
    size: 2.5,
    color: { r: 1, g: 0.6, b: 0.2 },
    colorEnd: { r: 0.8, g: 0.1, b: 0.3 },
    simId: DEFAULT_SIM_ID,
    simValues: values,
  };
}

/** L'instance de précomp est-elle active au frame parent ? (sa fenêtre de clip ; sans clip = toujours). */
export function precompActiveAt(inst: PrecompLayer, parentFrame: number): boolean {
  return layerActiveAt(inst.clip, parentFrame);
}

/**
 * Frame local de la comp enfant pour un frame parent donné : `timeOffset` + (parent − début) × vitesse,
 * clampé à `[0, childDuration[`. `début` = bord `in` du clip de l'instance (0 sans clip).
 */
export function precompChildFrame(inst: PrecompLayer, parentFrame: number, childDuration: number): number {
  const start = inst.clip?.in ?? 0;
  const local = inst.timeOffset + (parentFrame - start) * inst.speed;
  return Math.max(0, Math.min(Math.max(0, childDuration - 1), Math.round(local)));
}

/** Recherche en profondeur d'un nœud par id (null si absent). */
export function findLayer(root: GroupLayer, id: string): Layer | null {
  for (const child of root.children) {
    if (child.id === id) return child;
    if (child.type === "group") {
      const found = findLayer(child, id);
      if (found) return found;
    }
  }
  return null;
}

/** Groupe par id (racine incluse), null si absent ou nœud non-groupe. */
export function findGroup(root: GroupLayer, id: string): GroupLayer | null {
  if (root.id === id) return root;
  const node = findLayer(root, id);
  return node && node.type === "group" ? node : null;
}

/** Groupe parent d'un nœud (null pour la racine ou si absent). */
export function findParent(root: GroupLayer, id: string): GroupLayer | null {
  for (const child of root.children) {
    if (child.id === id) return root;
    if (child.type === "group") {
      const p = findParent(child, id);
      if (p) return p;
    }
  }
  return null;
}

/** Enfants du groupe donné (dans le document). */
export function groupChildren(doc: Document, groupId: string): readonly Layer[] {
  return findGroup(doc.root, groupId)?.children ?? [];
}

/** Ids de tout le sous-arbre d'un calque (lui + descendants ; une precomp est opaque : pas de descente). */
export function collectSubtreeIds(layer: Layer, out: Set<string> = new Set()): Set<string> {
  out.add(layer.id);
  if (layer.type === "group") for (const c of layer.children) collectSubtreeIds(c, out);
  return out;
}

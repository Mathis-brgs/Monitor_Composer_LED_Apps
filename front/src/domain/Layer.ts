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
  /** Parent (transform hérité) : le transform monde = transform monde du parent ∘ transform local. */
  parentId?: string;
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

export type Layer = ShaderLayer | ShapeLayer | GroupLayer | ImageLayer | VideoLayer | AudioLayer | SpotLayer | LyreLayer;

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

/** Parenter `id` à `parentId` créerait-il un cycle ? (parentId a-t-il `id` comme ancêtre, ou chaîne déjà cyclique) */
export function wouldCycle(root: GroupLayer, id: string, parentId: string): boolean {
  let cur: string | null | undefined = parentId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === id) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    cur = findLayer(root, cur)?.parentId;
  }
  return false;
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

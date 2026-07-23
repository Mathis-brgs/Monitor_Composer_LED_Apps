import type { Editor } from "../Editor.ts";
import type { RGB } from "@domain/Layer.ts";
import type { Interp } from "@domain/Composition.ts";

export interface TunnelOptions {
  /** "square" = anneaux carrés imbriqués (façon cible). "triangle" = 4 triangles par anneau,
   *  un par côté de l'écran, pointant vers le centre. */
  kind?: "square" | "triangle";
  /** Nombre d'anneaux imbriqués, du plus grand (extérieur) au plus petit (centre). */
  ringCount?: number;
  /** Frame où le 1er anneau (le plus grand) apparaît. */
  startFrame?: number;
  /** Écart (frames) entre l'apparition de deux anneaux consécutifs — le tempo de construction. */
  stepFrames?: number;
  /** Durée du pop-in d'un anneau, en frames. */
  popFrames?: number;
  /** Durée d'un cycle de "voyage" (zoom vers le centre puis reset) une fois le tunnel construit. */
  travelPeriod?: number;
  /** Frame de fin de la phase "voyage" (boucle de zoom). */
  endFrame?: number;
  maxScale?: number;
  minScale?: number;
  colorA?: RGB;
  colorB?: RGB;
  /** Triangles seulement : durée (frames) d'un état allumé/éteint une fois le tunnel construit.
   *  Les triangles des côtés (haut/bas/gauche/droite) et ceux des coins (entre les côtés)
   *  clignotent en opposition : l'un des deux groupes est toujours visible — 0 pour désactiver. */
  blinkPeriod?: number;
}

// blanc volontairement pas à 1,1,1 : trop violent/aveuglant sur le vrai mur LED
const COLOR_WHITE: RGB = { r: 0.4, g: 0.4, b: 0.4 };
const COLOR_BLACK: RGB = { r: 0, g: 0, b: 0 };

interface KeyframeSpec { frame: number; value: number; interp: Interp }

/** Description d'une forme du tunnel, indépendante de l'Editor : soit on la matérialise en
 *  calque + clés live (`insertTunnel`), soit on l'échantillonne hors-écran image par image
 *  (`tunnelPrerendered.ts`, via `sampleKeyframes`) — les deux lisent EXACTEMENT les mêmes clés,
 *  donc un rendu pré-rendu identique au live, pixel pour pixel. */
export interface TunnelShapeSpec {
  kind: "box" | "triangle";
  name: string;
  position: { x: number; y: number };
  rotationZ: number;
  color: RGB;
  scaleKeys: KeyframeSpec[];
  opacityKeys: KeyframeSpec[]; // vide si pas de clignotement (carrés, ou blinkPeriod=0)
}

export interface TunnelBuild {
  specs: TunnelShapeSpec[];
  /** 1re frame de la boucle "voyage" en régime établi (tous les anneaux construits). */
  buildEnd: number;
  /** Durée (frames) d'UN cycle complet de la boucle établie — voir `tunnelPrerendered.ts`. */
  loopLength: number;
  endFrame: number;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

/** Calcule toutes les shapes + clés du tunnel, sans toucher à l'Editor — logique pure partagée
 *  entre la version live et la version pré-rendue (voir `TunnelShapeSpec`). */
export function buildTunnel(opts: TunnelOptions = {}): TunnelBuild {
  const kind = opts.kind ?? "square";
  const ringCount = Math.max(2, Math.min(20, Math.round(opts.ringCount ?? 8)));
  const startFrame = Math.max(0, Math.round(opts.startFrame ?? 0));
  const stepFrames = Math.max(1, Math.round(opts.stepFrames ?? 10));
  const popFrames = Math.max(1, Math.round(opts.popFrames ?? 8));
  const travelPeriod = Math.max(4, Math.round(opts.travelPeriod ?? 40));
  const buildEnd = startFrame + (ringCount - 1) * stepFrames + popFrames;
  const endFrame = Math.max(buildEnd + travelPeriod, Math.round(opts.endFrame ?? buildEnd + travelPeriod * 6));
  const maxScale = opts.maxScale ?? 0.95;
  const minScale = opts.minScale ?? 0.12;
  const colorA = opts.colorA ?? COLOR_WHITE;
  const colorB = opts.colorB ?? COLOR_BLACK;
  const blinkPeriod = Math.max(0, Math.round(opts.blinkPeriod ?? 15));
  const loopLength = kind === "triangle" && blinkPeriod > 0 ? lcm(travelPeriod, blinkPeriod * 2) : travelPeriod;

  const specs: TunnelShapeSpec[] = [];

  /** Clés scale d'un anneau : invisible → pop-in à `settleScale` → boucle de zoom (sawtooth vers
   *  `settleScale*0.2` puis reset) jusqu'à `endFrame`. */
  const scaleKeysFor = (ringIndex: number, settleScale: number): KeyframeSpec[] => {
    const activation = startFrame + ringIndex * stepFrames;
    const popEnd = activation + popFrames;
    const scaleKeys: KeyframeSpec[] = [
      { frame: startFrame, value: 0, interp: "hold" },
      { frame: activation, value: 0, interp: "bezier" },
      { frame: popEnd, value: settleScale, interp: "linear" },
    ];
    // voyage : sawtooth synchronisé. Chaque cycle se termine 1 frame avant le suivant : deux clés
    // ne doivent jamais tomber sur le même frame (upsertKeyframe remplace, n'empile pas — la 2e
    // écraserait la 1re et le reset instantané du sawtooth disparaîtrait).
    const travelMin = settleScale * 0.2;
    let cycleStart = popEnd;
    while (cycleStart < endFrame) {
      const shrinkEnd = Math.min(endFrame, cycleStart + travelPeriod - 1);
      scaleKeys.push({ frame: cycleStart, value: settleScale, interp: "linear" });
      scaleKeys.push({ frame: shrinkEnd, value: travelMin, interp: "hold" });
      cycleStart = shrinkEnd + 1;
    }
    return scaleKeys;
  };

  const opacityKeysFor = (ringIndex: number, startOn: boolean): KeyframeSpec[] => {
    if (blinkPeriod <= 0) return [];
    const popEnd = startFrame + ringIndex * stepFrames + popFrames;
    const opacityKeys: KeyframeSpec[] = [];
    let on = startOn;
    let f = popEnd;
    opacityKeys.push({ frame: f, value: on ? 1 : 0, interp: "hold" });
    while (f < endFrame) {
      const next = Math.min(endFrame, f + blinkPeriod);
      on = !on;
      opacityKeys.push({ frame: next, value: on ? 1 : 0, interp: "hold" });
      f = next;
    }
    return opacityKeys;
  };

  for (let i = 0; i < ringCount; i++) {
    const t = ringCount === 1 ? 0 : i / (ringCount - 1);
    const settleScale = maxScale + (minScale - maxScale) * t; // décroît du plus grand au plus petit
    const color = i % 2 === 0 ? colorA : colorB;

    if (kind === "square") {
      specs.push({
        kind: "box",
        name: `Tunnel anneau ${i + 1}`,
        position: { x: 0, y: 0 },
        rotationZ: 0,
        color,
        scaleKeys: scaleKeysFor(i, settleScale),
        opacityKeys: [],
      });
    } else {
      // 8 triangles par anneau : 4 sur les côtés (haut/bas/gauche/droite) + 4 dans les coins
      // (les zones qui seraient sinon noires entre les côtés) — pointe toujours vers le centre
      // (rotation = angle + 90°). Les deux groupes clignotent en OPPOSITION : quand les côtés
      // sont visibles, les coins sont éteints (et inversement).
      const sideAngles = [Math.PI / 2, -Math.PI / 2, Math.PI, 0];
      const cornerAngles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];
      const scaleKeys = scaleKeysFor(i, settleScale);
      for (const a of sideAngles) {
        specs.push({
          kind: "triangle",
          name: `Tunnel anneau ${i + 1} (side)`,
          position: { x: Math.cos(a) * settleScale, y: Math.sin(a) * settleScale },
          rotationZ: a + Math.PI / 2,
          color,
          scaleKeys,
          opacityKeys: opacityKeysFor(i, true),
        });
      }
      for (const a of cornerAngles) {
        specs.push({
          kind: "triangle",
          name: `Tunnel anneau ${i + 1} (corner)`,
          position: { x: Math.cos(a) * settleScale, y: Math.sin(a) * settleScale },
          rotationZ: a + Math.PI / 2,
          color,
          scaleKeys,
          opacityKeys: opacityKeysFor(i, false),
        });
      }
    }
  }

  return { specs, buildEnd, loopLength, endFrame };
}

/**
 * Précomposition "tunnel" en deux temps, façon effet démo classique :
 * 1. Construction : les anneaux apparaissent un par un, du plus grand au plus petit, au tempo
 *    `stepFrames` ("le tunnel se prépare").
 * 2. Voyage : une fois construits, tous les anneaux zooment ensemble vers le centre en boucle
 *    (sawtooth : rétrécit puis re-saute à la taille de départ) — "on reste dans le tunnel".
 * Formes en couleur SOLIDE alternée (pas de matériau/shader) : le look "carrés imbriqués" vient
 * du masquage entre shapes (les plus petites sont ajoutées en dernier → au-dessus → cachent le
 * centre des plus grandes), pas d'un calcul procédural.
 */
export function insertTunnel(editor: Editor, opts: TunnelOptions = {}): string[] {
  const { specs } = buildTunnel(opts);
  const ids: string[] = [];
  const keys: { id: string; channel: string; frame: number; value: number; interp: Interp }[] = [];

  for (const spec of specs) {
    const id = editor.addShape(spec.kind);
    editor.setName(id, spec.name);
    editor.setFill(id, { type: "solid", color: spec.color });
    editor.setTransform(id, {
      position: { x: spec.position.x, y: spec.position.y, z: 0 },
      rotation: { x: 0, y: 0, z: spec.rotationZ },
      scale: { x: 0, y: 0, z: 0 },
    });
    for (const k of spec.scaleKeys) {
      keys.push({ id, channel: "scale.x", frame: k.frame, value: k.value, interp: k.interp });
      keys.push({ id, channel: "scale.y", frame: k.frame, value: k.value, interp: k.interp });
      keys.push({ id, channel: "scale.z", frame: k.frame, value: k.value, interp: k.interp });
    }
    for (const k of spec.opacityKeys) {
      keys.push({ id, channel: "opacity", frame: k.frame, value: k.value, interp: k.interp });
    }
    ids.push(id);
  }

  editor.putKeyframesBulk(keys);
  return ids;
}

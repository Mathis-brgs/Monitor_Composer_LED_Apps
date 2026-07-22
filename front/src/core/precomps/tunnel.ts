import type { Editor } from "../Editor.ts";
import type { RGB, ShapeKind } from "@domain/Layer.ts";
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

const COLOR_WHITE: RGB = { r: 1, g: 1, b: 1 };
const COLOR_BLACK: RGB = { r: 0, g: 0, b: 0 };

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

  const ids: string[] = [];
  const keys: { id: string; channel: string; frame: number; value: number; interp: Interp }[] = [];

  /** Anime un calque déjà positionné : invisible → pop-in à `settleScale` → boucle de zoom (sawtooth
   *  vers `minRatio*settleScale` puis reset) jusqu'à `endFrame`. */
  const animateRing = (id: string, ringIndex: number, settleScale: number): void => {
    const activation = startFrame + ringIndex * stepFrames;
    const popEnd = activation + popFrames;
    for (const axis of ["x", "y", "z"] as const) {
      keys.push({ id, channel: `scale.${axis}`, frame: startFrame, value: 0, interp: "hold" });
      keys.push({ id, channel: `scale.${axis}`, frame: activation, value: 0, interp: "bezier" });
      keys.push({ id, channel: `scale.${axis}`, frame: popEnd, value: settleScale, interp: "linear" });
    }
    // voyage : sawtooth synchronisé (tous les anneaux zooment/resettent ensemble). Chaque cycle
    // se termine 1 frame avant le suivant démarre : deux clés ne doivent JAMAIS tomber sur le
    // même frame (upsertKeyframe remplace, n'empile pas — la 2e écraserait la 1re et le "reset"
    // instantané du sawtooth disparaîtrait).
    const travelMin = settleScale * 0.2;
    let cycleStart = popEnd;
    while (cycleStart < endFrame) {
      const shrinkEnd = Math.min(endFrame, cycleStart + travelPeriod - 1);
      for (const axis of ["x", "y", "z"] as const) {
        keys.push({ id, channel: `scale.${axis}`, frame: cycleStart, value: settleScale, interp: "linear" });
        keys.push({ id, channel: `scale.${axis}`, frame: shrinkEnd, value: travelMin, interp: "hold" });
      }
      cycleStart = shrinkEnd + 1;
    }
  };

  for (let i = 0; i < ringCount; i++) {
    const t = ringCount === 1 ? 0 : i / (ringCount - 1);
    const settleScale = maxScale + (minScale - maxScale) * t; // décroît du plus grand au plus petit
    const color = i % 2 === 0 ? colorA : colorB;

    if (kind === "square") {
      const id = editor.addShape("box");
      editor.setName(id, `Tunnel anneau ${i + 1}`);
      editor.setFill(id, { type: "solid", color });
      editor.setTransform(id, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0, y: 0, z: 0 } });
      animateRing(id, i, settleScale);
      ids.push(id);
    } else {
      // 8 triangles par anneau : 4 sur les côtés (haut/bas/gauche/droite) + 4 dans les coins
      // (les zones qui seraient sinon noires entre les côtés) — pointe toujours vers le centre
      // (rotation = angle + 90°, dérivé des placements d'origine haut/bas/gauche/droite).
      // Les deux groupes clignotent en OPPOSITION : quand les côtés sont visibles, les coins sont
      // éteints (et inversement), donc les 8 zones sont couvertes en alternance, pas seulement 4.
      const sideAngles = [Math.PI / 2, -Math.PI / 2, Math.PI, 0];        // haut, bas, gauche, droite
      const cornerAngles = [Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]; // coins

      const popEnd = startFrame + i * stepFrames + popFrames;

      const addTriangle = (angle: number, group: "side" | "corner"): void => {
        const kindShape: ShapeKind = "triangle";
        const id = editor.addShape(kindShape);
        editor.setName(id, `Tunnel anneau ${i + 1} (${group})`);
        editor.setFill(id, { type: "solid", color });
        editor.setTransform(id, {
          position: { x: Math.cos(angle) * settleScale, y: Math.sin(angle) * settleScale, z: 0 },
          rotation: { x: 0, y: 0, z: angle + Math.PI / 2 },
          scale: { x: 0, y: 0, z: 0 },
        });
        animateRing(id, i, settleScale);

        // clignotement : le groupe "side" démarre visible, "corner" démarre éteint, et ça alterne
        if (blinkPeriod > 0) {
          let on = group === "side";
          let f = popEnd;
          keys.push({ id, channel: "opacity", frame: f, value: on ? 1 : 0, interp: "hold" });
          while (f < endFrame) {
            const next = Math.min(endFrame, f + blinkPeriod);
            on = !on;
            keys.push({ id, channel: "opacity", frame: next, value: on ? 1 : 0, interp: "hold" });
            f = next;
          }
        }

        ids.push(id);
      };

      for (const a of sideAngles) addTriangle(a, "side");
      for (const a of cornerAngles) addTriangle(a, "corner");
    }
  }

  editor.putKeyframesBulk(keys);
  return ids;
}

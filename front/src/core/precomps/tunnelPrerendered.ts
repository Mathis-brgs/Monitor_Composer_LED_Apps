import type { Editor } from "../Editor.ts";
import type { RGB } from "@domain/Layer.ts";
import { sampleKeyframes } from "@domain/Composition.ts";
import { rasterizeShapes, type ShapeInput } from "../engine/shapes.ts";
import { buildTunnel, type TunnelOptions } from "./tunnel.ts";

const SIZE = 128; // aligné sur `Editor.materialBakeSize` / la résolution native du mur
// même blanc adouci que tunnel.ts (1,1,1 est trop violent sur le vrai mur LED)
const COLOR_WHITE: RGB = { r: 0.4, g: 0.4, b: 0.4 };
const COLOR_BLACK: RGB = { r: 0, g: 0, b: 0 };

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
function lcm(a: number, b: number): number {
  return (a * b) / gcd(a, b);
}

export interface PrerenderResult { frames: Uint8ClampedArray[]; loopStart: number }

/** Identifiant de générateur stocké dans `Fill` (voir `prerenderRegistry.ts`) — permet de
 *  recalculer les frames après un rechargement de projet (les frames elles-mêmes ne sont pas
 *  sérialisées, trop volumineuses). */
export const TUNNEL_EXACT_GENERATOR = "tunnel-prerender-exact";
export const TUNNEL_SIMPLE_GENERATOR = "tunnel-prerender-simple";

/**
 * Calcule les frames du tunnel pré-rendu EXACT (mêmes clés que `insertTunnel`, échantillonnées
 * via `sampleKeyframes` au lieu d'animées en direct — résultat identique au pixel près). Pure
 * (pas d'Editor) : réutilisée à la création ET à la régénération après chargement de projet.
 */
export function computeTunnelPrerendered(opts: TunnelOptions = {}): PrerenderResult {
  const { specs, buildEnd, loopLength } = buildTunnel({ ...opts, startFrame: 0 });
  const totalFrames = buildEnd + loopLength;

  const frames: Uint8ClampedArray[] = [];
  for (let f = 0; f < totalFrames; f++) {
    const shapes: ShapeInput[] = [];
    for (const spec of specs) {
      const opacity = spec.opacityKeys.length > 0 ? sampleKeyframes(spec.opacityKeys, f) : 1;
      if (opacity < 0.5) continue; // clignotement : hors, on omet la forme plutôt que de la rendre noire
      const s = sampleKeyframes(spec.scaleKeys, f);
      if (s <= 0) continue;
      shapes.push({
        kind: spec.kind,
        position: { x: spec.position.x, y: spec.position.y, z: 0 },
        rotation: { x: 0, y: 0, z: spec.rotationZ },
        scale: { x: s, y: s, z: s },
        fill: { kind: "solid", color: spec.color },
      });
    }
    frames.push(new Uint8ClampedArray(rasterizeShapes(shapes, SIZE, SIZE)));
  }
  return { frames, loopStart: buildEnd };
}

/**
 * Version PRÉ-RENDUE du tunnel — EXACTEMENT le même tunnel que `insertTunnel` (même construction
 * anneau par anneau, même boucle de voyage), pas une version simplifiée. La construction (anneaux
 * qui apparaissent un par un) ne se répète qu'une fois (intro) ; une fois le tunnel bâti, la
 * boucle de voyage se répète indéfiniment (voir `Editor.setPrerenderedFrames`, paramètre
 * `loopStart`). Les FRAMES ne sont pas sérialisées, mais `generator`+`options` le sont sur le
 * `Fill` — `Editor._rehydratePrerenderedFills` les recalcule après un chargement de projet.
 */
export function insertTunnelPrerendered(editor: Editor, opts: TunnelOptions = {}): string {
  const { frames, loopStart } = computeTunnelPrerendered(opts);
  const id = editor.addShape("box");
  editor.setName(id, `Tunnel pré-rendu (${opts.kind ?? "square"})`);
  editor.setTransform(id, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
  editor.setFill(id, { type: "prerender", generator: TUNNEL_EXACT_GENERATOR, options: opts as Record<string, unknown> });
  editor.setPrerenderedFrames(id, frames, loopStart);
  return id;
}

/** Calcule les frames du tunnel pré-rendu SIMPLE (anneaux synchronisés, pas de construction). */
export function computeTunnelPrerenderedSimple(opts: TunnelOptions = {}): PrerenderResult {
  const kind = opts.kind ?? "square";
  const ringCount = Math.max(2, Math.min(20, Math.round(opts.ringCount ?? 8)));
  const travelPeriod = Math.max(4, Math.round(opts.travelPeriod ?? 40));
  const blinkPeriod = Math.max(2, Math.round(opts.blinkPeriod ?? 15));
  const maxScale = opts.maxScale ?? 0.95;
  const minScale = opts.minScale ?? 0.12;
  const colorA = opts.colorA ?? COLOR_WHITE;
  const colorB = opts.colorB ?? COLOR_BLACK;

  const loopLength = kind === "triangle" ? lcm(travelPeriod, blinkPeriod * 2) : travelPeriod;

  const rings = Array.from({ length: ringCount }, (_, i) => {
    const t = ringCount === 1 ? 0 : i / (ringCount - 1);
    return { settleScale: maxScale + (minScale - maxScale) * t, color: i % 2 === 0 ? colorA : colorB };
  });

  const travelScale = (settleScale: number, lf: number): number => {
    const travelMin = settleScale * 0.2;
    const frac = (lf % travelPeriod) / Math.max(1, travelPeriod - 1);
    return settleScale + (travelMin - settleScale) * frac;
  };

  const sideAngles = [Math.PI / 2, -Math.PI / 2, Math.PI, 0];
  const cornerAngles = [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4];

  const frames: Uint8ClampedArray[] = [];
  for (let lf = 0; lf < loopLength; lf++) {
    const shapes: ShapeInput[] = [];
    for (const ring of rings) {
      const s = travelScale(ring.settleScale, lf);
      if (kind === "square") {
        shapes.push({ kind: "box", position: { x: 0, y: 0, z: 0 }, scale: { x: s, y: s, z: s }, fill: { kind: "solid", color: ring.color } });
      } else {
        const phaseOn = Math.floor(lf / blinkPeriod) % 2 === 0;
        for (const a of phaseOn ? sideAngles : cornerAngles) {
          shapes.push({
            kind: "triangle",
            position: { x: Math.cos(a) * ring.settleScale, y: Math.sin(a) * ring.settleScale, z: 0 },
            rotation: { x: 0, y: 0, z: a + Math.PI / 2 },
            scale: { x: s, y: s, z: s },
            fill: { kind: "solid", color: ring.color },
          });
        }
      }
    }
    frames.push(new Uint8ClampedArray(rasterizeShapes(shapes, SIZE, SIZE)));
  }
  return { frames, loopStart: 0 }; // boucle depuis le début, pas d'intro
}

/**
 * Version PRÉ-RENDUE "simple" : pas de reprise des clés live — tous les anneaux SYNCHRONISÉS
 * (même zoom, même clignotement, en phase), sans phase de construction, boucle depuis la frame 0.
 * Plus sobre/lisible que la version exacte (qui garde le décalage par anneau hérité du tempo de
 * construction) — gardée en plus comme option, pas une étape vers la version exacte.
 */
export function insertTunnelPrerenderedSimple(editor: Editor, opts: TunnelOptions = {}): string {
  const { frames, loopStart } = computeTunnelPrerenderedSimple(opts);
  const id = editor.addShape("box");
  editor.setName(id, `Tunnel pré-rendu simple (${opts.kind ?? "square"})`);
  editor.setTransform(id, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
  editor.setFill(id, { type: "prerender", generator: TUNNEL_SIMPLE_GENERATOR, options: opts as Record<string, unknown> });
  editor.setPrerenderedFrames(id, frames, loopStart);
  return id;
}

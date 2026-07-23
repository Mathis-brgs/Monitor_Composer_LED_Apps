import type { Editor } from "../Editor.ts";
import type { RGB } from "@domain/Layer.ts";
import { rasterizeShapes, type ShapeInput } from "../engine/shapes.ts";

const SIZE = 128; // résolution du mur
const DISK_RES = 48; // résolution du bitmap plasma de la boule (petite zone de l'écran, pas besoin de 128)

/** Dégradé plasma par défaut (orange→rose), identique à `Plasma.layer.ts` — utilisé pour les
 *  particules qui tombent. */
const PLASMA_COLORS: [RGB, RGB] = [{ r: 1.0, g: 0.5412, b: 0.2392 }, { r: 1.0, g: 0.2902, b: 0.3529 }];
/** Dégradé braise (jaune-blanc chaud → rouge sombre) — utilisé pour la boule une fois formée. */
const EMBER_COLORS: [RGB, RGB] = [{ r: 1.0, g: 0.85, b: 0.35 }, { r: 0.75, g: 0.08, b: 0.02 }];

/** Angle d'or — répartition en spirale (graines de tournesol), sans trou ni paquet. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/** Ease façon smoothstep — même courbe que l'interpolation "bezier" du reste du projet. */
function ease(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * Valeur du champ plasma en un point du mur — MÊME formule que `Plasma.layer.ts` (4 sinus dont
 * un radial), traduite en JS pur (bake CPU, pas de TSL/GPU). `wx`/`wy` en pixels mur (0..128),
 * `t` en secondes. Renvoie 0..1 ; le dégradé (couleur) est appliqué séparément par l'appelant.
 */
function plasmaFieldAt(wx: number, wy: number, t: number): number {
  const s1 = Math.sin(wx * 0.09 + t * 1.2);
  const s2 = Math.sin(wy * 0.08 - t * 0.9);
  const s3 = Math.sin((wx + wy) * 0.05 + t * 1.6);
  const dist = Math.hypot(wx - 64, wy - 64);
  const s4 = Math.sin(dist * 0.11 - t * 2.0);
  const field = (s1 + s2 + s3 + s4) * 0.25;
  return Math.max(0, Math.min(1, field * 0.5 + 0.5));
}

function plasmaColor(v: number, [colA, colB]: [RGB, RGB]): RGB {
  return { r: colA.r + (colB.r - colA.r) * v, g: colA.g + (colB.g - colA.g) * v, b: colA.b + (colB.b - colA.b) * v };
}

/** Mur normalisé [-1,1] → pixels mur [0,128] (même convention que `uv().mul(128)` en TSL). */
const toWallPx = (n: number): number => ((n + 1) / 2) * SIZE;

export interface EmberPlasmaBallOptions {
  /** Nombre de particules (défaut 80, plafonné à 150). */
  count?: number;
  /** Fenêtre (s) sur laquelle les apparitions/chutes sont étalées — pas toutes en même temps. */
  fallSeconds?: number;
  /** Durée (s) de la chute PROPRE à une particule, une fois qu'elle apparaît. */
  fallDurationSeconds?: number;
  /** Durée (s) de l'attraction vers le centre + fonte, propre à une particule. */
  formSeconds?: number;
  /** Durée d'un cycle de boucle une fois la boule complètement formée (s) — le motif plasma n'a
   *  pas de période exacte courte, donc la boucle n'est pas parfaitement raccord, mais un motif
   *  organique comme celui-ci ne montre pas la coupure. */
  loopSeconds?: number;
  fps?: number;
  /** Rayon final de la boule plasma. */
  radius?: number;
  particleScale?: number;
  /** Hauteur (Y) du sol où les particules tombent avant d'être attirées vers le centre. */
  groundY?: number;
}

/**
 * Précomposition PRÉ-RENDUE (pas de version live) : des particules de PLASMA (couleur = motif
 * plasma échantillonné à leur position, pas une palette statique) APPARAISSENT et tombent au sol
 * une par une (pas toutes en même temps — chaque particule a sa propre horloge de spawn/chute/
 * attraction), puis sont attirées vers le centre où elles fondent dans une boule de plasma lisse
 * et continue, recolorée en BRAISE (jaune→rouge). La boule grandit UNIQUEMENT au rythme des
 * arrivées réelles (jamais avant qu'une particule n'ait fini son trajet) — pas sur une horloge
 * indépendante. Toujours pré-rendu (bake CPU intensif) — pas de version live équivalente.
 */
export function insertEmberPlasmaBall(editor: Editor, opts: EmberPlasmaBallOptions = {}): string {
  const count = Math.max(4, Math.min(150, Math.round(opts.count ?? 80)));
  const fps = opts.fps && opts.fps > 0 ? opts.fps : 24;
  // par défaut, la formation complète (dernière particule fondue) dure 3.8+1.2+3.0 = 8s
  const spawnWindowFrames = Math.max(1, Math.round((opts.fallSeconds ?? 3.8) * fps));
  const fallDurFrames = Math.max(1, Math.round((opts.fallDurationSeconds ?? 1.2) * fps));
  const attractDurFrames = Math.max(1, Math.round((opts.formSeconds ?? 3.0) * fps));
  const loopFrames = Math.max(1, Math.round((opts.loopSeconds ?? 6) * fps));
  const radius = opts.radius ?? 0.22;
  const particleScale = opts.particleScale ?? 0.032;
  const groundY = opts.groundY ?? -0.75;

  // chaque particule a SA PROPRE horloge : apparaît à `spawn` (étalé, pas toutes en même temps),
  // tombe pendant `fallDurFrames`, puis est attirée+rétrécit pendant `attractDurFrames`.
  const particles = Array.from({ length: count }, (_, i) => {
    const r = radius * Math.sqrt((i + 0.5) / count);
    const angle = i * GOLDEN_ANGLE;
    const t = Math.min(1, r / radius);
    const x0 = (Math.random() - 0.5) * 1.8;
    const spawn = Math.round(Math.random() * spawnWindowFrames);
    const groundArrive = spawn + fallDurFrames;
    const centerArrive = groundArrive + attractDurFrames;
    return {
      spawn,
      groundArrive,
      centerArrive,
      x0,
      y0: 0.55 + Math.random() * 0.4, // départ dispersé en haut
      xGround: x0 * 0.85 + (Math.random() - 0.5) * 0.15, // tombe quasi droit, léger flottement
      yGround: groundY + Math.random() * 0.15,
      xEnd: r * Math.cos(angle),
      yEnd: r * Math.sin(angle),
      scale: particleScale * (1.1 - 0.3 * t),
    };
  });

  const lastArrival = Math.max(...particles.map((p) => p.centerArrive));
  const totalFrames = lastArrival + loopFrames;

  const frames: Uint8ClampedArray[] = [];
  for (let f = 0; f < totalFrames; f++) {
    const shapes: ShapeInput[] = [];
    const time = f / fps;
    // crédit de formation : une particule encore EN ROUTE vers le centre compte déjà,
    // proportionnellement (linéaire, pas adouci) à son avancement — sinon la boule reste à zéro
    // pendant tout le trajet (~4s) et n'apparaît qu'à la toute première arrivée complète, alors
    // qu'on voit déjà plein de particules converger vers le centre.
    let formCredit = 0;

    for (const p of particles) {
      if (f >= p.centerArrive) { formCredit += 1; continue; } // fondue dans la boule, plus rendue à part
      if (f < p.spawn) continue; // pas encore apparue

      let x: number, y: number, s: number;
      if (f < p.groundArrive) {
        const fallT = ease((f - p.spawn) / fallDurFrames);
        x = p.x0 + (p.xGround - p.x0) * fallT;
        y = p.y0 + (p.yGround - p.y0) * fallT;
        s = p.scale;
      } else {
        const attractRaw = (f - p.groundArrive) / attractDurFrames;
        const attractT = ease(attractRaw);
        x = p.xGround + (p.xEnd - p.xGround) * attractT;
        y = p.yGround + (p.yEnd - p.yGround) * attractT;
        s = p.scale * (1 - attractT);
        formCredit += attractRaw; // en route : compte déjà, proportionnellement
      }
      if (s <= 0) continue;
      const v = plasmaFieldAt(toWallPx(x), toWallPx(y), time);
      const color = plasmaColor(v, PLASMA_COLORS);
      shapes.push({ kind: "sphere", position: { x, y, z: 0 }, scale: { x: s, y: s, z: s }, fill: { kind: "solid", color } });
    }

    // boule plasma (couleur braise) : grandit avec le crédit de formation cumulé — commence dès
    // que les 1res particules SE DIRIGENT vers le centre, finit pile à `lastArrival` (8s).
    const diskScale = radius * Math.min(1, formCredit / count);
    if (diskScale > 0) {
      const data = new Uint8ClampedArray(DISK_RES * DISK_RES * 4);
      for (let py = 0; py < DISK_RES; py++) {
        const ly = 1 - (py / (DISK_RES - 1)) * 2;
        for (let px = 0; px < DISK_RES; px++) {
          const lx = (px / (DISK_RES - 1)) * 2 - 1;
          const v = plasmaFieldAt(toWallPx(lx * diskScale), toWallPx(ly * diskScale), time);
          const c = plasmaColor(v, EMBER_COLORS);
          const o = (py * DISK_RES + px) * 4;
          data[o] = Math.round(c.r * 255);
          data[o + 1] = Math.round(c.g * 255);
          data[o + 2] = Math.round(c.b * 255);
          data[o + 3] = 255;
        }
      }
      shapes.push({
        kind: "sphere",
        position: { x: 0, y: 0, z: 0 },
        scale: { x: diskScale, y: diskScale, z: diskScale },
        fill: { kind: "bitmap", data, width: DISK_RES, height: DISK_RES },
      });
    }

    frames.push(new Uint8ClampedArray(rasterizeShapes(shapes, SIZE, SIZE)));
  }

  const id = editor.addShape("box");
  editor.setName(id, "Plasma → boule de braise (pré-rendu)");
  editor.setTransform(id, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } });
  editor.setFill(id, { type: "prerender" });
  editor.setPrerenderedFrames(id, frames, lastArrival);
  return id;
}

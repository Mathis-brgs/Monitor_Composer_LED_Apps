import { exp, float, fract, smoothstep, texture, uv, vec2 } from "three/tsl";
import type { Texture } from "three/webgpu";

/**
 * Taille visuelle d'une LED = fraction du pas (cellule) qu'elle occupe.
 * FUTUR : réglable (précision vs réalité du vrai mur), potentiellement par fixture.
 */
export const LED_FILL = 0.75;

/**
 * ColorNode « mur LED » : chaque cellule d'une grille n×n = un point rond lumineux
 * (rayon LED_FILL/2) + halo, échantillonnant `source`. Dessiné DANS le plan (uv) → la
 * taille ne dépend que du facteur, pas de la caméra. Partagé Render 2D et Editor 3D (plan).
 */
export function ledColorNode(source: Texture, n = 128) {
  const cell = uv().mul(n);
  const f = fract(cell);
  const d = f.sub(vec2(0.5)).length();          // distance au centre de la cellule
  const r = LED_FILL / 2;
  const dot = float(1).sub(smoothstep(r - 0.1, r, d)); // LED ronde de rayon LED_FILL/2
  const glow = exp(d.mul(-6.0)).mul(0.22);             // halo doux (aspect lumineux)
  const led = texture(source, uv());
  return led.rgb.mul(dot.add(glow));
}

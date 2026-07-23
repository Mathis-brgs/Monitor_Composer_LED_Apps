import type { TunnelOptions } from "./tunnel.ts";
import { computeTunnelPrerendered, computeTunnelPrerenderedSimple, TUNNEL_EXACT_GENERATOR, TUNNEL_SIMPLE_GENERATOR } from "./tunnelPrerendered.ts";
import { computeEmberPlasmaBall, EMBER_PLASMA_BALL_GENERATOR, type EmberPlasmaBallOptions } from "./emberPlasmaBall.ts";

export interface PrerenderResult { frames: Uint8ClampedArray[]; loopStart: number }

/**
 * Registre des générateurs de fill "prerender" : associe l'id stocké sur `Fill.generator` à sa
 * fonction de calcul pure. Utilisé par `Editor._rehydratePrerenderedFills` pour recalculer les
 * frames (non sérialisées) après un chargement de projet — voir `Fill` dans `domain/Layer.ts`.
 */
export function computePrerenderedFrames(generator: string, options: Record<string, unknown>): PrerenderResult | null {
  switch (generator) {
    case TUNNEL_EXACT_GENERATOR: return computeTunnelPrerendered(options as TunnelOptions);
    case TUNNEL_SIMPLE_GENERATOR: return computeTunnelPrerenderedSimple(options as TunnelOptions);
    case EMBER_PLASMA_BALL_GENERATOR: return computeEmberPlasmaBall(options as EmberPlasmaBallOptions);
    default: return null;
  }
}

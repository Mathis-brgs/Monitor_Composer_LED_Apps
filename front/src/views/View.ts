import type { AppContext } from "@core/AppContext.ts";

/**
 * Une vue = un panneau (UI + rendu). Reçoit le contexte par injection (la root),
 * ne charge rien elle-même et n'utilise aucune globale.
 */
export interface View {
  readonly id: string;
  mount(ctx: AppContext, host: HTMLElement): void;
  unmount(): void;
  /** optionnel : dessin à l'écran à chaque frame (vues WebGPU) */
  render?(): void;
}

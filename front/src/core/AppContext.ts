import type { WebGPURenderer } from "three/webgpu";
import type { Project } from "@domain/Project.ts";
import type { AssetStore } from "./AssetStore.ts";
import type { Transport } from "./transport.ts";
import type { Engine } from "./engine/Engine.ts";

/**
 * Contexte injecté à chaque vue (chargé une fois par la root, lu partout).
 * C'est le "root en back" : un seul point charge, tout le monde consomme.
 */
export interface AppContext {
  readonly renderer: WebGPURenderer;
  readonly project: Project;
  readonly assets: AssetStore;
  readonly engine: Engine;
  readonly transport: Transport;
}

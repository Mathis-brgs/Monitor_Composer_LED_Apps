import { DEFAULT_CONFIG, type ProjectConfig } from "./ProjectConfig.ts";
import { EMPTY_COMPOSITION, type Composition } from "./Composition.ts";
import type { SceneObject } from "./SceneObject.ts";

/** Document projet = config + composition + objets. Chargeable/sauvable en JSON (P1). */
export interface Project {
  config: ProjectConfig;
  composition: Composition;
  objects: SceneObject[];
}

export function createProject(config: ProjectConfig = DEFAULT_CONFIG): Project {
  return { config, composition: EMPTY_COMPOSITION, objects: [] };
}

// TODO: loadProject(json) / saveProject(project) — sérialisation JSON

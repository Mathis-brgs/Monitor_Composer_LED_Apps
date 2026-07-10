import { DEFAULT_CONFIG, type ProjectConfig } from "./ProjectConfig.ts";
import { EMPTY_COMPOSITION, type Composition } from "./Composition.ts";
import type { SceneObject } from "./SceneObject.ts";
import type { Document } from "./Layer.ts";

/** Document projet = config + composition + objets. Chargeable/sauvable en JSON (P1). */
export interface Project {
  config: ProjectConfig;
  composition: Composition;
  objects: SceneObject[];
  document?: Document;
}

export function createProject(config: ProjectConfig = DEFAULT_CONFIG): Project {
  return { config, composition: EMPTY_COMPOSITION, objects: [] };
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(json: string): Project {
  const parsed = JSON.parse(json) as Partial<Project>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Format de projet JSON invalide");
  }

  const config: ProjectConfig = {
    name: parsed.config?.name ?? DEFAULT_CONFIG.name,
    fixture: parsed.config?.fixture ?? DEFAULT_CONFIG.fixture,
    ehub: {
      host: parsed.config?.ehub?.host ?? DEFAULT_CONFIG.ehub.host,
      port: parsed.config?.ehub?.port ?? DEFAULT_CONFIG.ehub.port,
    },
    frequency: parsed.config?.frequency ?? DEFAULT_CONFIG.frequency,
  };

  const composition: Composition = parsed.composition ?? EMPTY_COMPOSITION;
  const objects: SceneObject[] = parsed.objects ?? [];
  const document = parsed.document;

  return { config, composition, objects, document };
}



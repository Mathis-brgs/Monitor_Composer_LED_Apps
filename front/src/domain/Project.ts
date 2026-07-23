import { DEFAULT_CONFIG, type ProjectConfig } from "./ProjectConfig.ts";
import {
  DEFAULT_DURATION_FRAMES, hasTracks, isComposition, makeComposition, type Composition,
} from "./Composition.ts";
import type { SceneObject } from "./SceneObject.ts";
import { makeGroup, makeShape, makeShaderLayer, type Document, type GroupLayer, type SimPreset } from "./Layer.ts";

/** Document projet = config + compositions (dont la principale) + objets. Chargeable/sauvable en JSON. */
export interface Project {
  config: ProjectConfig;
  /** Compositions indexées par id ; contient toujours au moins la comp principale. */
  compositions: Record<string, Composition>;
  mainCompId: string;
  objects: SceneObject[];
  /** Bibliothèque de simulations de particules (presets partagés, façon `Editor._simulations`).
   *  Optionnel : absent sur les projets antérieurs à cette fonctionnalité (l'éditeur sème alors le donut). */
  simulations?: SimPreset[];
}

const MAIN_ID = "main";

export function createProject(config: ProjectConfig = DEFAULT_CONFIG): Project {
  const main = makeComposition(MAIN_ID, "Composition principale", "main", { root: makeGroup("root", "Composition") });
  return { config, compositions: { [MAIN_ID]: main }, mainCompId: MAIN_ID, objects: [] };
}

/**
 * Projet de démarrage (démo dev) : comp principale peuplée des calques d'origine
 * (3 shaders + 2 objets). Utilisé au boot ; `createProject` reste vide (Fichier > Nouveau).
 */
export function createSeededProject(config: ProjectConfig = DEFAULT_CONFIG): Project {
  const root = makeGroup("root", "Composition");

  const sweep = makeShaderLayer("sweep-1", "sweep", "Balayage");
  sweep.blend = "add";
  sweep.opacity = 0.8;

  const plasma = makeShaderLayer("plasma-1", "plasma", "Plasma");
  plasma.params = { speed: 0.42, detail: 0.7, contrast: 0.55, hue: 0.57 };

  const solid = makeShaderLayer("solid-1", "solid", "Couleur unie");
  solid.color = { r: 0.11, g: 0.055, b: 0.024 }; // #1c0e06

  const sphere = makeShape("sphere-1", "sphere", "Sphère 01");
  sphere.transform = { position: { x: -0.28, y: 0.12, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.34, y: 0.34, z: 0.34 } };
  sphere.fill = { type: "solid", color: { r: 1, g: 0.541, b: 0.239 } };

  const box = makeShape("box-1", "box", "Cube 01");
  box.transform = { position: { x: 0.42, y: -0.14, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 0.26, y: 0.26, z: 0.26 } };
  box.fill = { type: "solid", color: { r: 1, g: 0.541, b: 0.239 } };

  root.children.push(sweep, plasma, solid, sphere, box);
  const main = makeComposition(MAIN_ID, "Composition", "main", { root });
  return { config, compositions: { [MAIN_ID]: main }, mainCompId: MAIN_ID, objects: [] };
}

/** Comp principale du projet (jamais nulle : fabrique une comp vide en dernier recours). */
export function mainComposition(project: Project): Composition {
  return project.compositions[project.mainCompId]
    ?? makeComposition(project.mainCompId || MAIN_ID, "Composition principale", "main");
}

export function serializeProject(project: Project): string {
  return JSON.stringify(project, null, 2);
}

export function deserializeProject(json: string): Project {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Format de projet JSON invalide");
  }

  const config = readConfig((parsed as { config?: Partial<ProjectConfig> }).config);
  const objects = (parsed as { objects?: SceneObject[] }).objects ?? [];
  const simulations = readSimulations((parsed as { simulations?: unknown }).simulations);

  // — Nouveau format : { compositions, mainCompId } —
  const rawComps = (parsed as { compositions?: Record<string, unknown> }).compositions;
  const rawMainId = (parsed as { mainCompId?: unknown }).mainCompId;
  if (rawComps && typeof rawComps === "object" && typeof rawMainId === "string") {
    const compositions: Record<string, Composition> = {};
    for (const [id, c] of Object.entries(rawComps)) {
      if (isComposition(c)) compositions[id] = c;
    }
    let mainCompId = compositions[rawMainId] ? rawMainId : Object.keys(compositions)[0] ?? MAIN_ID;
    if (!compositions[mainCompId]) {
      compositions[mainCompId] = makeComposition(mainCompId, "Composition principale", "main");
    }
    return { config, compositions, mainCompId, objects, simulations };
  }

  // — Ancien format : { composition: { tracks }, document?: { root, ... } } → une comp principale —
  const legacyComp = (parsed as { composition?: unknown }).composition;
  const legacyDoc = (parsed as { document?: Document }).document;
  const tracks = hasTracks(legacyComp) ? legacyComp.tracks : [];
  const root: GroupLayer = legacyDoc?.root ?? makeGroup("root", "Composition");
  const main = makeComposition(MAIN_ID, "Composition principale", "main", {
    root, tracks, durationFrames: DEFAULT_DURATION_FRAMES,
  });
  return { config, compositions: { [MAIN_ID]: main }, mainCompId: MAIN_ID, objects, simulations };
}

/** Lit la bibliothèque de simulations (validation légère : présence de id/code/params). undefined si absente. */
function readSimulations(raw: unknown): SimPreset[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: SimPreset[] = [];
  for (const p of raw) {
    if (p && typeof p === "object" && typeof (p as SimPreset).id === "string" && typeof (p as SimPreset).code === "string") {
      const params = Array.isArray((p as SimPreset).params) ? (p as SimPreset).params : [];
      out.push({ id: (p as SimPreset).id, name: (p as SimPreset).name ?? (p as SimPreset).id, code: (p as SimPreset).code, params });
    }
  }
  return out;
}

function readConfig(c: Partial<ProjectConfig> | undefined): ProjectConfig {
  return {
    name: c?.name ?? DEFAULT_CONFIG.name,
    fixture: c?.fixture ?? DEFAULT_CONFIG.fixture,
    ehub: {
      host: c?.ehub?.host ?? DEFAULT_CONFIG.ehub.host,
      port: c?.ehub?.port ?? DEFAULT_CONFIG.ehub.port,
    },
    frequency: c?.frequency ?? DEFAULT_CONFIG.frequency,
  };
}

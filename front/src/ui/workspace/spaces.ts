import type { LayoutNode, PanelId } from "./layouts.ts";

/**
 * Espaces = onglets. Modèle Blender/AE : édition vs sortie.
 * - `editor3d`  : édition de scène 3D (+ vue 2D à venir) — tout éditable.
 * - `compositor`: pile de calques + timeline (After Effects / Première).
 * - `render`    : sortie finale du syphon (le mur), view-only (toggle 2D/3D à venir).
 */
export type SpaceId = "editor3d" | "compositor" | "render";

export interface SpaceDef {
  readonly id: SpaceId;
  readonly label: string;
}

export const SPACES: readonly SpaceDef[] = [
  { id: "editor3d", label: "3D Editor" },
  { id: "compositor", label: "Compositor" },
  { id: "render", label: "Render" },
];

export const DEFAULT_SPACE: SpaceId = "editor3d";

function leaf(panel: PanelId): LayoutNode {
  return { type: "leaf", panel };
}

/** row de panneaux au-dessus d'une timeline. (La barre d'outils est un overlay du viewport 3D, plus un panneau docké.) */
function withTimeline(top: LayoutNode, timelineSize = 250): LayoutNode {
  return {
    type: "split",
    dir: "col",
    children: [
      { size: 625, node: top },
      { size: timelineSize, node: leaf("timeline") },
    ],
  };
}

function row(children: { panel: PanelId; size: number }[]): LayoutNode {
  return {
    type: "split",
    dir: "row",
    children: children.map((c) => ({ size: c.size, node: leaf(c.panel) })),
  };
}

/** 3D Editor : outliner · viewport 3D (barre d'outils en overlay) · inspecteur + timeline. */
const EDITOR_3D: LayoutNode = withTimeline(
  row([
    { panel: "outliner", size: 260 },
    { panel: "viewport", size: 900 },
    { panel: "inspector", size: 322 },
  ]),
  214,
);

/** Compositor (AE/Première) : outliner · preview · inspecteur + timeline. */
const COMPOSITOR: LayoutNode = withTimeline(
  row([
    { panel: "outliner", size: 300 },
    { panel: "preview", size: 900 },
    { panel: "inspector", size: 360 },
  ]),
);

/** Render : sortie du syphon en plein cadre (view-only). */
const RENDER: LayoutNode = leaf("preview");

/** Agencement par espace. Personnalisable/persistant ensuite via localStorage. */
export const SPACE_LAYOUTS: Record<SpaceId, LayoutNode> = {
  editor3d: EDITOR_3D,
  compositor: COMPOSITOR,
  render: RENDER,
};

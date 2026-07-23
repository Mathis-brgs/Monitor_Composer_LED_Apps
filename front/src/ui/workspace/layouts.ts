/**
 * Agencement = arbre de splits. Un nœud est soit une feuille (un panneau), soit
 * un split (rangée/colonne de sous-nœuds redimensionnables). L'app = un arrangement
 * de panneaux : cet arbre pilote le rendu du body, il est mutable (resize/permutation)
 * et sérialisable (persistance localStorage par espace).
 */

export type PanelId =
  | "outliner"
  | "viewport"
  | "preview"
  | "inspector"
  | "timeline";

export const PANEL_IDS: readonly PanelId[] = [
  "outliner",
  "viewport",
  "preview",
  "inspector",
  "timeline",
];

/** "row" = enfants côte à côte (colonnes) ; "col" = enfants empilés (rangées). */
export type SplitDir = "row" | "col";

export interface LeafNode {
  type: "leaf";
  panel: PanelId;
}

export interface SplitChild {
  node: LayoutNode;
  /** poids flex-grow (proportion d'espace) — ignoré si `fixed` est défini */
  size: number;
  /** taille fixe en px (non redimensionnable), ex: le rail d'outils */
  fixed?: number;
}

export interface SplitNode {
  type: "split";
  dir: SplitDir;
  children: SplitChild[];
}

export type LayoutNode = LeafNode | SplitNode;

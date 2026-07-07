export interface AssetEntry {
  readonly src: string;
  readonly type: "texture" | "video" | "audio";
  /** groupe de préchargement (ex: "boot") */
  readonly group?: string;
}

export type AssetManifest = Record<string, AssetEntry>;

/** Manifeste déclaratif des assets (vide pour l'instant). */
export const ASSET_MANIFEST: AssetManifest = {};

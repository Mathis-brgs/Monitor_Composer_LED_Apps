import type { AssetManifest } from "@assets/assets.manifest.ts";

/**
 * Chargement des assets déclarés (textures/vidéo/audio) via le manifeste.
 * SQUELETTE : le pipeline réel (loaders Three, préchargement par groupe) est à implémenter.
 */
export class AssetStore {
  private readonly _loaded = new Map<string, unknown>();

  async load(_manifest: AssetManifest): Promise<void> {
    // TODO: précharger le groupe "boot" (TextureLoader / vidéo / audio)
  }

  get<T>(key: string): T {
    const asset = this._loaded.get(key);
    if (asset === undefined) throw new Error(`asset absent: ${key}`);
    return asset as T;
  }
}

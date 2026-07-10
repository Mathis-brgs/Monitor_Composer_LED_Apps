/** Config d'un projet — sérialisable (P1 du cours : chargeable/sauvable). */
export interface ProjectConfig {
  readonly name: string;
  /** id de la fixture (ex: "wall") */
  readonly fixture: string;
  /** cible UDP du routeur Go (le process principal Electron y émet l'eHuB) */
  readonly ehub: { readonly host: string; readonly port: number };
  frequency?: number;
}

export const DEFAULT_CONFIG: ProjectConfig = {
  name: "new project",
  fixture: "wall",
  ehub: { host: "127.0.0.1", port: 8765 },
  frequency: 24,
};

export interface ControllerConfig {
  readonly ip: string;
}

/** Config d'un projet — sérialisable (P1 du cours : chargeable/sauvable). */
export interface ProjectConfig {
  readonly name: string;
  /** id de la fixture (ex: "wall") */
  readonly fixture: string;
  readonly controllers: ControllerConfig[];
  /** cible UDP du routeur Go (le process principal Electron y émet l'eHuB) */
  readonly ehub: { readonly host: string; readonly port: number };
  drawings?: Record<number, "red" | "blue" | "green" | "white">;
  frequency?: number;
}

export const DEFAULT_CONFIG: ProjectConfig = {
  name: "Nouveau projet",
  fixture: "wall",
  controllers: [
    { ip: "192.168.1.45" },
    { ip: "192.168.1.46" },
    { ip: "192.168.1.47" },
    { ip: "192.168.1.48" },
  ],
  ehub: { host: "192.168.1.62", port: 8765 },
  frequency: 24,
};

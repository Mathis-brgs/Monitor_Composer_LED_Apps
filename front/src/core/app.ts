import { createRenderer } from "./device.ts";
import { Runtime, type Frame } from "./Runtime.ts";
import { IpcTransport } from "./transport.ts";
import { AssetStore } from "./AssetStore.ts";
import { Engine } from "./engine/Engine.ts";
import type { AppContext } from "./AppContext.ts";
import { ASSET_MANIFEST } from "@assets/assets.manifest.ts";
import { createProject, serializeProject, deserializeProject, type Project } from "@domain/Project.ts";
import { WallFixture } from "@domain/fixtures/WallFixture.ts";
import type { View } from "@views/View.ts";

const EHUB_HZ = 24; // limite fixee par le prof : 24 fps max

/**
 * Composition root : charge la config, précharge les assets, construit le
 * document, crée le device + le moteur, puis monte les vues avec le contexte.
 */
export class App {
  private readonly _runtime: Runtime;
  private readonly _views: View[] = [];
  private _active: View | null = null;
  
  /** Callback déclenché après le chargement réussi d'un projet pour actualiser l'IHM */
  public onProjectLoaded?: () => void;

  private constructor(readonly context: AppContext) {
    this._runtime = new Runtime(this._frame);
  }

  static async create(canvas: HTMLCanvasElement, project: Project = createProject()): Promise<App> {
    const renderer = await createRenderer(canvas);

    const assets = new AssetStore();
    await assets.load(ASSET_MANIFEST);

    const transport = new IpcTransport({
      host: project.config.ehub.host,
      port: project.config.ehub.port,
    });
    transport.connect();

    // TODO: résoudre la fixture depuis project.config.fixture via un registre
    const fixture = new WallFixture();
    const engine = new Engine(renderer, fixture, transport, project);

    const app = new App({ renderer, project, assets, engine, transport });
    app._start();
    app.sendEhubConfig().catch((err) => console.error("Erreur d'envoi config eHuB initiale :", err));
    return app;
  }

  /** monte une vue avec le contexte injecté ; la dernière vue avec `render` devient active. */
  mountView(view: View, host: HTMLElement): void {
    view.mount(this.context, host);
    this._views.push(view);
    if (view.render) this._active = view;
  }

  async loadProject(): Promise<void> {
    try {
      const json = await window.led?.loadProject();
      if (!json) return; // Annulé par l'utilisateur

      const loaded = deserializeProject(json);
      
      // Mettre à jour le projet en place à chaud (pour garder la référence de context.project)
      const p = this.context.project;
      p.config = loaded.config;
      p.composition = loaded.composition;
      p.objects = loaded.objects;

      // Mettre à jour l'IP / Port cible du transport eHuB
      this.context.transport.updateTarget(p.config.ehub.host, p.config.ehub.port);

      // Envoyer le paquet de config eHuB au routage Go
      await this.sendEhubConfig();

      console.log("Projet chargé avec succès :", p.config.name);

      // Déclencher le callback s'il existe
      this.onProjectLoaded?.();
    } catch (err) {
      console.error("Erreur de chargement du projet :", err);
      alert("Impossible de charger le projet : " + String(err));
    }
  }

  async saveProject(): Promise<void> {
    try {
      const json = serializeProject(this.context.project);
      await window.led?.saveProject(json, this.context.project.config.name);
      console.log("Projet sauvegardé avec succès");
    } catch (err) {
      console.error("Erreur lors de la sauvegarde du projet :", err);
      alert("Impossible de sauvegarder le projet : " + String(err));
    }
  }

  async sendEhubConfig(): Promise<void> {
    await this.context.engine.sendConfig();
  }

  private _start(): void {
    window.setInterval(() => void this.context.engine.output(), 1000 / EHUB_HZ);
    this._runtime.start();
  }

  private readonly _frame = (frame: Frame): void => {
    this.context.engine.update(frame);
    this._active?.render?.();
  };
}

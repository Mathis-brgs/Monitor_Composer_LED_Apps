import { createRenderer } from "./device.ts";
import { Runtime, type Frame } from "./Runtime.ts";
import { IpcTransport } from "./transport.ts";
import { AssetStore } from "./AssetStore.ts";
import { Engine } from "./engine/Engine.ts";
import { Clock } from "./Clock.ts";
import { Editor } from "./Editor.ts";
import { LiveState } from "./LiveState.ts";
import type { AppContext } from "./AppContext.ts";
import { ASSET_MANIFEST } from "@assets/assets.manifest.ts";
import { createProject, serializeProject, deserializeProject, type Project } from "@domain/Project.ts";
import { WallFixture } from "@domain/fixtures/WallFixture.ts";
import type { View } from "@views/View.ts";

const EHUB_HZ = 24;

/**
 * Composition root : charge la config, précharge les assets, construit le
 * document, crée le device + le moteur, puis monte les vues avec le contexte.
 */
export class App {
  private readonly _runtime: Runtime;
  private _view: View | null = null;
  private _ehubIntervalId: number | null = null;


  /** Callback déclenché après le chargement réussi d'un projet pour actualiser l'IHM */
  public onProjectLoaded?: () => void;

  private constructor(readonly context: AppContext) {
    this._runtime = new Runtime(this._frame);
  }

  static async create(
    canvas: HTMLCanvasElement,
    project: Project = createProject(),
    clock: Clock = new Clock(),
    editor: Editor = new Editor(),
    live: LiveState = new LiveState(),
  ): Promise<App> {
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
    const engine = new Engine(renderer, fixture, transport);
    editor.attach(engine);

    const app = new App({
      renderer,
      project,
      assets,
      engine,
      transport,
      clock,
      editor,
      live,
    });
    app._start();
    return app;
  }

  /**
   * Vue de rendu active dans le canvas moteur partagé : démonte la précédente,
   * monte la nouvelle avec le contexte injecté. Idempotent par `id`.
   * Un seul canvas → une seule vue rend à la fois (l'espace actif décide laquelle).
   */
  setView(view: View, host: HTMLElement): void {
    if (this._view?.id === view.id) return;
    this._view?.unmount();
    this._view = view;
    view.mount(this.context, host);
  }

  async loadProject(): Promise<void> {
    try {
      const res = await window.led?.loadProject();
      if (!res) return; // Annulé par l'utilisateur

      const loaded = deserializeProject(res.content);
      
      // Mettre à jour le projet en place à chaud (pour garder la référence de context.project)
      const p = this.context.project;
      p.config = loaded.config;
      p.composition = loaded.composition;
      p.objects = loaded.objects;
      p.document = loaded.document;

      // Extraire le nom du fichier du chemin pour le nom du projet
      const fileName = res.filePath.split(/[\\/]/).pop() || "new project";
      const projectName = fileName.replace(/\.json$/i, "");
      (p.config as any).name = projectName;

      // Mettre à jour l'IP / Port cible du transport eHuB
      this.context.transport.updateTarget(p.config.ehub.host, p.config.ehub.port);

      // Charger le document dans l'éditeur s'il est présent
      if (loaded.document) {
        this.context.editor.loadDocument(loaded.document);
      }

      // Mettre à jour la fréquence d'envoi eHuB
      this.updateFrequency(p.config.frequency ?? 24);

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
      this.context.project.document = this.context.editor.getDocument();
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

  /**
   * (Re)démarre la boucle d'envoi eHuB à la fréquence donnée. Seul point qui
   * touche `_ehubIntervalId` : évite d'avoir deux boucles d'envoi en
   * parallèle (une pour LIVE, une pour la fréquence du projet). La boucle
   * n'envoie la scène que si LIVE est actif — sinon elle ne fait rien.
   */
  private _restartEhubInterval(hz: number): void {
    if (this._ehubIntervalId !== null) {
      window.clearInterval(this._ehubIntervalId);
    }
    this._ehubIntervalId = window.setInterval(() => {
      if (this.context.live.live) void this.context.engine.output();
    }, 1000 / hz);
  }

  updateFrequency(hz: number): void {
    this.context.project.config.frequency = hz;
    this._restartEhubInterval(hz);
    console.log(`Fréquence d'envoi eHuB mise à jour : ${hz} Hz`);
  }

  private _start(): void {
    this._restartEhubInterval(this.context.project.config.frequency ?? EHUB_HZ);
    // À la sortie du LIVE (et à l'état initial, off par défaut), on pousse
    // une frame noire pour ne pas laisser le mur figé sur la dernière image.
    this.context.live.subscribe((state) => {
      if (!state.live) void this.context.engine.blackout();
    });
    this._runtime.start();
  }

  private readonly _frame = (frame: Frame): void => {
    const { clock, engine } = this.context;
    clock.advance(frame.deltaTime);
    engine.update(clock.time);
    this._view?.render?.();
  };
}

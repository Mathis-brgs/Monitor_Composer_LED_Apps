import { createRenderer } from "./device.ts";
import { Runtime, type Frame } from "./Runtime.ts";
import { IpcTransport } from "./transport.ts";
import { AssetStore } from "./AssetStore.ts";
import { Engine } from "./engine/Engine.ts";
import { Clock } from "./Clock.ts";
import { Editor } from "./Editor.ts";
import type { AppContext } from "./AppContext.ts";
import { ASSET_MANIFEST } from "@assets/assets.manifest.ts";
import { createProject, type Project } from "@domain/Project.ts";
import { WallFixture } from "@domain/fixtures/WallFixture.ts";
import type { View } from "@views/View.ts";

const EHUB_HZ = 40;

/**
 * Composition root : charge la config, précharge les assets, construit le
 * document, crée le device + le moteur, puis monte les vues avec le contexte.
 */
export class App {
  private readonly _runtime: Runtime;
  private _view: View | null = null;

  private constructor(readonly context: AppContext) {
    this._runtime = new Runtime(this._frame);
  }

  static async create(
    canvas: HTMLCanvasElement,
    project: Project = createProject(),
    clock: Clock = new Clock(),
    editor: Editor = new Editor(),
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

    const app = new App({ renderer, project, assets, engine, transport, clock, editor });
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

  private _start(): void {
    window.setInterval(() => void this.context.engine.output(), 1000 / EHUB_HZ);
    this._runtime.start();
  }

  private readonly _frame = (frame: Frame): void => {
    const { clock, engine } = this.context;
    clock.advance(frame.deltaTime);
    engine.update(clock.time);
    this._view?.render?.();
  };
}

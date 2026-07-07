import { createRenderer } from "./device.ts";
import { Runtime, type Frame } from "./Runtime.ts";
import { IpcTransport } from "./transport.ts";
import { AssetStore } from "./AssetStore.ts";
import { Engine } from "./engine/Engine.ts";
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
  private readonly _views: View[] = [];
  private _active: View | null = null;

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
    const engine = new Engine(renderer, fixture, transport);

    const app = new App({ renderer, project, assets, engine, transport });
    app._start();
    return app;
  }

  /** monte une vue avec le contexte injecté ; la dernière vue avec `render` devient active. */
  mountView(view: View, host: HTMLElement): void {
    view.mount(this.context, host);
    this._views.push(view);
    if (view.render) this._active = view;
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

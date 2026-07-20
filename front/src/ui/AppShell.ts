import type { Project } from "@domain/Project.ts";
import type { Clock } from "@core/Clock.ts";
import type { Editor } from "@core/Editor.ts";
import type { AudioEngine } from "@core/AudioEngine.ts";
import type { LiveState } from "@core/LiveState.ts";
import type { App } from "@core/app.ts";
import { MenuBar } from "./frame/MenuBar.ts";
import { TabBar } from "./frame/TabBar.ts";
import { StatusBar } from "./frame/StatusBar.ts";
import { Workspace } from "./workspace/Workspace.ts";
import { DEFAULT_SPACE, type SpaceId } from "./workspace/spaces.ts";

export interface AppShellOptions {
  readonly project: Project;
  readonly clock: Clock;
  readonly editor: Editor;
  readonly audio: AudioEngine;
  readonly live: LiveState;
}

/**
 * Coque de l'application : cadre (menu-bar / tab-bar / status-bar) + workspace
 * (agencement de panneaux). DOM pur, indépendant de WebGPU : monte toujours.
 */
export class AppShell {
  readonly element: HTMLElement;
  readonly viewportCanvas: HTMLCanvasElement;
  readonly menuBar: MenuBar;

  /** Notifié quand l'espace actif change : la root y branche le switch de vue moteur. */
  onSpaceChange?: (id: SpaceId) => void;

  private readonly _tabBar: TabBar;
  private readonly _workspace: Workspace;
  private _activeSpace: SpaceId = DEFAULT_SPACE;

  constructor(opts: AppShellOptions) {
    const { config } = opts.project;

    this.viewportCanvas = document.createElement("canvas");
    this.viewportCanvas.id = "view";

    this._workspace = new Workspace(this.viewportCanvas, opts.clock, opts.editor, opts.audio);
    this._workspace.setSpace(this._activeSpace);

    this._tabBar = new TabBar(this._activeSpace, opts.clock, opts.live, (id) => this._selectSpace(id));
    this.menuBar = new MenuBar(config);

    this.element = document.createElement("div");
    this.element.className = "shell";
    this.element.append(
      this.menuBar.element,
      this._tabBar.element,
      this._workspace.element,
      new StatusBar(config).element,
    );

    // Espace = play/pause global (transport), sauf pendant une saisie de texte.
    window.addEventListener("keydown", (e) => {
      if (e.code !== "Space" || isTyping(e.target)) return;
      e.preventDefault(); // évite l'activation du bouton focus et le scroll
      opts.clock.toggle();
    });
  }

  setApp(app: App): void {
    this.menuBar.setApp(app);
    app.onProjectLoaded = () => {
      this.menuBar.setProjectName(app.context.project.config.name);
    };
  }

  /** Hôte du canvas moteur (le body du viewport) pour la vue WebGPU. */
  get viewportHost(): HTMLElement {
    return this.viewportCanvas.parentElement ?? this.element;
  }

  /** Affiche une erreur cadrée dans le viewport (ex: WebGPU indisponible). */
  showViewportError(err: unknown): void {
    const box = document.createElement("div");
    box.className = "viewport__error";
    box.textContent = `WebGPU indisponible.\n\n${String(err)}`;
    this.viewportCanvas.parentElement?.appendChild(box);
  }

  /**
   * Loader d'initialisation du viewport (pendant le boot WebGPU). Carte centrée
   * façon maquette Figma (frame 60:504). Retourne un disposer à appeler au succès/erreur.
   */
  showViewportLoader(): () => void {
    const host = this.viewportHost;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    const box = document.createElement("div");
    box.className = "viewport-loader";
    box.innerHTML =
      '<div class="viewport-loader__grid"><div class="viewport-loader__scan"></div></div>' +
      '<div class="viewport-loader__title">VIEWPORT 3D</div>' +
      '<div class="viewport-loader__sub">rendu moteur live · WebGPU → 128×128</div>';
    host.appendChild(box);
    return () => box.remove();
  }

  private _selectSpace(id: SpaceId): void {
    if (id === this._activeSpace) return;
    this._activeSpace = id;
    this._tabBar.setActive(id);
    this._workspace.setSpace(id); // réattache le canvas dans le leaf viewport/preview du nouvel espace
    this.onSpaceChange?.(id); // puis la root aligne la vue moteur (3D vs composite 2D)
  }
}

/** Vrai si l'événement vient d'un champ de saisie (ne pas capter les raccourcis globaux). */
function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

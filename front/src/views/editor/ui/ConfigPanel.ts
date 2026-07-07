import { Pane, type TpChangeEvent } from "tweakpane";
import type { App } from "@core/app.ts";

/**
 * Panneau d'interface graphique flottant (Tweakpane)
 * Permet d'éditer la configuration du projet et de charger/sauvegarder les fichiers.
 */
export class ConfigPanel {
  private _pane: Pane;

  constructor(private readonly _app: App) {
    this._pane = new Pane({
      title: "Configuration du Projet",
      expanded: true,
    });

    // S'abonner au chargement de projet pour reconstruire l'IHM
    this._app.onProjectLoaded = () => {
      this.rebuild();
    };

    this._applyStyles();
    this._buildUI();
  }

  private _applyStyles(): void {
    this._pane.element.style.width = "320px";
    this._pane.element.style.position = "absolute";
    this._pane.element.style.top = "12px";
    this._pane.element.style.right = "12px";
    this._pane.element.style.zIndex = "9999";
  }

  rebuild(): void {
    this._pane.dispose();

    this._pane = new Pane({
      title: "Configuration du Projet",
      expanded: true,
    });

    this._applyStyles();
    this._buildUI();
  }

  private _buildUI(): void {
    const config = this._app.context.project.config;

    // --- Dossier Projet ---
    const fProject = this._pane.addFolder({ title: "Projet" });

    fProject.addBinding(config, "name", {
      label: "Nom",
    });

    const btnLoad = fProject.addButton({ title: "Charger Projet" });
    btnLoad.on("click", async () => {
      await this._app.loadProject();
    });

    const btnSave = fProject.addButton({ title: "Sauvegarder Projet" });
    btnSave.on("click", async () => {
      await this._app.saveProject();
    });

    // --- Dossier Réseau eHuB ---
    const fEhub = this._pane.addFolder({ title: "Réseau eHuB (Go)" });

    fEhub.addBinding(config.ehub, "host", {
      label: "Adresse IP",
    }).on("change", (ev: TpChangeEvent<string>) => {
      this._app.context.transport.updateTarget(ev.value, config.ehub.port);
    });

    fEhub.addBinding(config.ehub, "port", {
      label: "Port UDP",
      step: 1,
      min: 1,
      max: 65535,
    }).on("change", (ev: TpChangeEvent<number>) => {
      this._app.context.transport.updateTarget(config.ehub.host, ev.value);
    });

    const btnSendConfig = fEhub.addButton({ title: "Envoyer Config eHuB" });
    btnSendConfig.on("click", async () => {
      await this._app.sendEhubConfig();
    });

    // --- Dossier Contrôleurs ---
    const fControllers = this._pane.addFolder({ title: "Contrôleurs Physiques" });

    config.controllers.forEach((ctrl, index) => {
      fControllers.addBinding(ctrl, "ip", {
        label: `Ctrl ${index + 1} (.${45 + index})`,
      });
    });
  }

  dispose(): void {
    this._pane.dispose();
  }
}

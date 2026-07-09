import "@styles/tokens.css";
import "@styles/shell.css";

import { App } from "@core/app.ts";
import { Clock } from "@core/Clock.ts";
import { Editor } from "@core/Editor.ts";
import { AppShell } from "@ui/AppShell.ts";
import { DEFAULT_SPACE, type SpaceId } from "@ui/workspace/spaces.ts";
import { createProject } from "@domain/Project.ts";
import type { View } from "@views/View.ts";
import { Editor3DView } from "@views/editor3d/Editor3DView.ts";
import { Preview2DView } from "@views/preview2d/Preview2DView.ts";
import { ConfigPanel } from "@views/editor/ui/ConfigPanel.ts";

/**
 * Vue moteur (contenu du canvas) par espace. Un seul canvas partagé : l'espace
 * actif décide de la scène rendue. `editor3d` = scène 3D éditable ; `compositor`
 * et `render` = sortie composite 2D du moteur (mur LED réaliste).
 */
const VIEW_FOR_SPACE: Record<SpaceId, () => View> = {
  editor3d: () => new Editor3DView(),
  compositor: () => new Preview2DView(),
  render: () => new Preview2DView(),
};

// Sous Electron uniquement : marque la plateforme pour insérer les insets de la
// barre native fondue (feux macOS à gauche, contrôles Windows à droite).
const ua = navigator.userAgent;
if (/Electron/.test(ua)) {
  document.documentElement.dataset.platform = /Mac/.test(ua) ? "mac" : "win";
}

const root = document.getElementById("app");
if (!(root instanceof HTMLElement)) {
  throw new Error("#app introuvable");
}

const project = createProject();
const clock = new Clock();
const editor = new Editor();
const shell = new AppShell({ project, clock, editor });
root.appendChild(shell.element);

// Shell (DOM pur) monté ; le moteur WebGPU rend dans le canvas du viewport (non bloquant).
const dismissLoader = shell.showViewportLoader();
App.create(shell.viewportCanvas, project, clock, editor)
  .then((app) => {
    dismissLoader();
    app.setView(VIEW_FOR_SPACE[DEFAULT_SPACE](), shell.viewportHost);
    shell.onSpaceChange = (id) => app.setView(VIEW_FOR_SPACE[id](), shell.viewportHost);

    // Initialiser le panneau de configuration flottant
    new ConfigPanel(app);
  })
  .catch((err: unknown) => {
    dismissLoader();
    console.error(err);
    shell.showViewportError(err);
  });

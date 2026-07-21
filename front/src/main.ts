import "@styles/tokens.css";
import "@styles/shell.css";

import { App } from "@core/app.ts";
import { Clock } from "@core/Clock.ts";
import { Editor } from "@core/Editor.ts";
import { AudioEngine } from "@core/AudioEngine.ts";
import { LiveState } from "@core/LiveState.ts";
import { AppShell } from "@ui/AppShell.ts";
import { installEdgeAwareTooltips } from "@ui/tooltip-edge.ts";
import { DEFAULT_SPACE, type SpaceId } from "@ui/workspace/spaces.ts";
import { createSeededProject } from "@domain/Project.ts";
import type { View } from "@views/View.ts";
import { Editor3DView } from "@views/editor3d/Editor3DView.ts";
import { Preview2DView } from "@views/preview2d/Preview2DView.ts";

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

installEdgeAwareTooltips();

const project = createSeededProject();
const clock = new Clock();
const editor = new Editor();
editor.setClock(clock);
editor.loadCompositions(project.compositions, project.mainCompId);
const audio = new AudioEngine();
const live = new LiveState();
const shell = new AppShell({ project, clock, editor, audio, live });
root.appendChild(shell.element);

/** Undo/redo global (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z ou Ctrl+Y) : au niveau fenêtre pour marcher
 *  depuis n'importe quel panneau (timeline, inspecteur, viewport 3D), pas juste un seul. Ignoré
 *  pendant la saisie texte (un champ gère son propre undo natif). */
window.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
  const el = document.activeElement as HTMLElement | null;
  if (el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) return;
  e.preventDefault();
  if (e.shiftKey) editor.redo();
  else editor.undo();
});
window.addEventListener("keydown", (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "y") return;
  const el = document.activeElement as HTMLElement | null;
  if (el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable)) return;
  e.preventDefault();
  editor.redo();
});

// Shell (DOM pur) monté ; le moteur WebGPU rend dans le canvas du viewport (non bloquant).
const dismissLoader = shell.showViewportLoader();
App.create(shell.viewportCanvas, project, clock, editor, live, audio)
  .then((app) => {
    dismissLoader();
    app.setView(VIEW_FOR_SPACE[DEFAULT_SPACE](), shell.viewportHost);
    shell.onSpaceChange = (id) => app.setView(VIEW_FOR_SPACE[id](), shell.viewportHost);

    // Connecter l'application au shell (barre de menus)
    shell.setApp(app);
  })
  .catch((err: unknown) => {
    dismissLoader();
    console.error(err);
    shell.showViewportError(err);
  });

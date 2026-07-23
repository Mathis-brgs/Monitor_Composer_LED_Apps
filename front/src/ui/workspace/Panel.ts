import type { PanelId } from "./layouts.ts";
import type { Clock } from "@core/Clock.ts";
import type { Editor } from "@core/Editor.ts";
import type { AudioEngine } from "@core/AudioEngine.ts";
import { createIcon } from "@ui/icons/Icon.ts";

/** Un panneau du body = un id + son élément racine. */
export interface Panel {
  readonly id: PanelId;
  readonly element: HTMLElement;
  /** libère les ressources (abonnements, racine Solid) avant que le panneau soit recréé */
  unmount?(): void;
}

/** Contexte passé aux fabriques de panneaux (deps partagées du shell). */
export interface PanelContext {
  readonly canvas: HTMLCanvasElement;
  readonly clock: Clock;
  readonly editor: Editor;
  readonly audio: AudioEngine;
}

export interface PanelParts {
  readonly element: HTMLElement;
  readonly header: HTMLElement | null;
  readonly body: HTMLElement;
}

/** Construit la coquille d'un panneau : header (libellé + icône optionnels) + body. */
export function createPanel(opts: { title?: string; modifier?: string; icon?: string } = {}): PanelParts {
  const element = document.createElement("div");
  element.className = "panel";
  if (opts.modifier) element.classList.add(`panel--${opts.modifier}`);

  let header: HTMLElement | null = null;
  if (opts.title !== undefined) {
    header = document.createElement("div");
    header.className = "panel__header";
    header.draggable = true; // glisser l'en-tête pour permuter le panneau
    if (opts.icon) {
      header.appendChild(createIcon(opts.icon, { size: 11, className: "panel__header-icon" }));
    }
    const label = document.createElement("span");
    label.textContent = opts.title;
    header.appendChild(label);
    element.appendChild(header);
  }

  const body = document.createElement("div");
  body.className = "panel__body";
  element.appendChild(body);

  return { element, header, body };
}

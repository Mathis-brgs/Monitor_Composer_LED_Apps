import { render } from "solid-js/web";
import type { JSX } from "solid-js";
import type { PanelId } from "../workspace/layouts.ts";
import { createPanel, type Panel } from "../workspace/Panel.ts";

export interface SolidPanelOptions {
  readonly id: PanelId;
  readonly title?: string;
  readonly modifier?: string;
  /** icône du header (avant le libellé) */
  readonly icon?: string;
  /** classe ajoutée au body (ex "inspector") pour les styles internes du panneau */
  readonly bodyClass?: string;
  /** contenu additionnel du header (onglets, actions) après le libellé */
  readonly header?: (header: HTMLElement) => void;
  readonly body: () => JSX.Element;
}

/**
 * Monte un composant Solid dans la coquille d'un panneau et l'expose au contrat `Panel`.
 * `unmount` = disposer Solid : détruit les effets et déclenche les `onCleanup`
 * (désabonnements des stores). La `Workspace` l'appelle avant de recréer les panneaux.
 */
export function solidPanel(opts: SolidPanelOptions): Panel {
  const { element, header, body } = createPanel({ title: opts.title, modifier: opts.modifier, icon: opts.icon });
  if (opts.bodyClass) body.classList.add(opts.bodyClass);
  if (header && opts.header) opts.header(header);
  const dispose = render(opts.body, body);
  return { id: opts.id, element, unmount: dispose };
}

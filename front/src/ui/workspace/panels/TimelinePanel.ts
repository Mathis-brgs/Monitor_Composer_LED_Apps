import type { Clock } from "@core/Clock.ts";
import { createPanel, type Panel } from "../Panel.ts";
import { Sequencer } from "./Sequencer.ts";

/** Panneau de séquence (timeline) : pistes, règle, keyframes, playhead lié à l'horloge. */
export class TimelinePanel implements Panel {
  readonly id = "timeline";
  readonly element: HTMLElement;

  constructor(clock: Clock) {
    const { element, header, body } = createPanel({
      title: "Timeline",
      modifier: "timeline",
      icon: "sliders",
    });

    if (header) {
      const seq = document.createElement("span");
      seq.className = "seq-badge";
      seq.textContent = "Séquence 01";
      const spacer = document.createElement("div");
      spacer.className = "panel__header-spacer";
      const meta = document.createElement("span");
      meta.className = "seq-meta";
      meta.textContent = "Durée 8.00 s · 40 FPS";
      header.append(seq, spacer, meta);
    }

    body.appendChild(new Sequencer(clock).element);
    this.element = element;
  }
}

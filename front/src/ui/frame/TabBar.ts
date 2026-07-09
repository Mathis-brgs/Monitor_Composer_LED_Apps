import type { Clock } from "@core/Clock.ts";
import { SPACES, type SpaceId } from "../workspace/spaces.ts";
import { TransportControls } from "./TransportControls.ts";

/** Onglets des espaces (navigation branchée) + transport (branché sur l'horloge) à droite. */
export class TabBar {
  readonly element: HTMLElement;
  private readonly _tabs = new Map<SpaceId, HTMLElement>();

  constructor(active: SpaceId, clock: Clock, onSelect: (id: SpaceId) => void) {
    this.element = document.createElement("div");
    this.element.className = "tab-bar";

    for (const space of SPACES) {
      const tab = document.createElement("button");
      tab.type = "button";
      tab.className = "tab";
      tab.textContent = space.label;
      tab.addEventListener("click", () => onSelect(space.id));
      this._tabs.set(space.id, tab);
      this.element.appendChild(tab);
    }

    const spacer = document.createElement("div");
    spacer.className = "tab-bar__spacer";
    this.element.append(spacer, new TransportControls(clock).element);

    this.setActive(active);
  }

  setActive(id: SpaceId): void {
    for (const [spaceId, tab] of this._tabs) {
      tab.classList.toggle("tab--active", spaceId === id);
    }
  }
}

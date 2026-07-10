import type { Clock } from "@core/Clock.ts";
import type { LiveState } from "@core/LiveState.ts";

const FPS = 40;

const PLAY_SVG =
  '<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1 9 5 1 9Z" fill="currentColor"/></svg>';
const PAUSE_SVG =
  '<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="1" width="3" height="8" fill="currentColor"/><rect x="6" y="1" width="3" height="8" fill="currentColor"/></svg>';

/** Contrôles de transport : play/pause + timecode, branchés sur l'horloge de lecture. */
export class TransportControls {
  readonly element: HTMLElement;
  private readonly _btn: HTMLButtonElement;
  private readonly _time: HTMLElement;
  private readonly _liveBtn: HTMLButtonElement;

  constructor(clock: Clock, live: LiveState) {
    this.element = document.createElement("div");
    this.element.className = "tab-bar__transport";

    this._btn = document.createElement("button");
    this._btn.type = "button";
    this._btn.className = "transport-btn";
    this._btn.addEventListener("click", () => clock.toggle());

    this._time = document.createElement("span");
    this._time.className = "timecode";

    const sep = document.createElement("span");
    sep.className = "transport-sep";

    // Bouton LIVE : n'envoie la scène au routeur (eHuB) que lorsqu'il est
    // actif. À la désactivation, une frame noire est poussée pour éteindre
    // le mur au lieu de le laisser figé (voir App._start / Engine.blackout).
    this._liveBtn = document.createElement("button");
    this._liveBtn.type = "button";
    this._liveBtn.className = "live";
    const dot = document.createElement("span");
    dot.className = "live-dot";
    this._liveBtn.append(dot, document.createTextNode("Live"));
    this._liveBtn.addEventListener("click", () => live.toggle());

    this.element.append(this._btn, this._time, sep, this._liveBtn);

    clock.subscribe((c) => this._sync(c));
    live.subscribe((l) => this._syncLive(l));
  }

  private _sync(clock: Clock): void {
    this._btn.classList.toggle("transport-btn--playing", clock.playing);
    this._btn.innerHTML = clock.playing ? PAUSE_SVG : PLAY_SVG;
    this._btn.setAttribute("aria-label", clock.playing ? "Pause" : "Lecture");
    this._time.textContent = formatTimecode(clock.time);
  }

  private _syncLive(live: LiveState): void {
    this._liveBtn.classList.toggle("live--active", live.live);
    this._liveBtn.setAttribute("aria-pressed", String(live.live));
    this._liveBtn.setAttribute("aria-label", live.live ? "Couper le direct" : "Passer en direct");
  }
}

/** MM:SS:FF (frames à 40 fps). */
function formatTimecode(time: number): string {
  const totalFrames = Math.floor(time * FPS);
  const frames = totalFrames % FPS;
  const totalSeconds = Math.floor(totalFrames / FPS);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

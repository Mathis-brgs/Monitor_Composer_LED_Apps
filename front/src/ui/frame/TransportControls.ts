import type { Clock } from "@core/Clock.ts";
import type { LiveState } from "@core/LiveState.ts";

const PLAY_SVG =
  '<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1 9 5 1 9Z" fill="currentColor"/></svg>';
const PAUSE_SVG =
  '<svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="1" width="3" height="8" fill="currentColor"/><rect x="6" y="1" width="3" height="8" fill="currentColor"/></svg>';
const TO_START_SVG =
  '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="1" y="1" width="1.6" height="8" fill="currentColor"/><path d="M9 1 3.4 5 9 9Z" fill="currentColor"/></svg>';
const TO_END_SVG =
  '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1 6.6 5 1 9Z" fill="currentColor"/><rect x="7.4" y="1" width="1.6" height="8" fill="currentColor"/></svg>';
const STEP_BACK_SVG =
  '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M7 1 2 5 7 9Z" fill="currentColor"/></svg>';
const STEP_FWD_SVG =
  '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1 8 5 3 9Z" fill="currentColor"/></svg>';
const LOOP_SVG =
  '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M2.5 5A3.5 3.5 0 0 1 9 3.2M9 1.5V3.4H7.1"/><path d="M9.5 7A3.5 3.5 0 0 1 3 8.8M3 10.5V8.6H4.9"/></svg>';

/** Contrôles de transport : play/pause + timecode, branchés sur l'horloge de lecture. */
export class TransportControls {
  readonly element: HTMLElement;
  private readonly _btn: HTMLButtonElement;
  private readonly _loopBtn: HTMLButtonElement;
  private readonly _time: HTMLElement;
  private readonly _liveBtn: HTMLButtonElement;

  constructor(clock: Clock, live: LiveState) {
    this.element = document.createElement("div");
    this.element.className = "tab-bar__transport";

    this._btn = document.createElement("button");
    this._btn.type = "button";
    this._btn.className = "transport-btn";
    this._btn.addEventListener("click", () => clock.toggle());

    const toStart = navBtn(TO_START_SVG, "Aller au début", () => clock.goToStart());
    const stepBack = navBtn(STEP_BACK_SVG, "Image précédente", () => clock.stepFrame(-1));
    const stepFwd = navBtn(STEP_FWD_SVG, "Image suivante", () => clock.stepFrame(1));
    const toEnd = navBtn(TO_END_SVG, "Aller à la fin", () => clock.goToEnd());

    this._loopBtn = document.createElement("button");
    this._loopBtn.type = "button";
    this._loopBtn.className = "transport-btn";
    this._loopBtn.innerHTML = LOOP_SVG;
    this._loopBtn.addEventListener("click", () =>
      clock.setLoop(clock.loop === "off" ? "loop" : "off"),
    );

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

    this.element.append(
      toStart, stepBack, this._btn, stepFwd, toEnd,
      this._loopBtn, this._time, sep, this._liveBtn,
    );

    clock.subscribe((c) => this._sync(c));
    live.subscribe((l) => this._syncLive(l));
  }

  private _sync(clock: Clock): void {
    this._btn.classList.toggle("transport-btn--playing", clock.playing);
    this._btn.innerHTML = clock.playing ? PAUSE_SVG : PLAY_SVG;
    this._btn.setAttribute("aria-label", clock.playing ? "Pause" : "Lecture");
    this._btn.dataset.tooltip = clock.playing ? "Pause (Espace)" : "Lecture (Espace)";
    this._time.textContent = formatTimecode(clock.time, clock.fps);
    this._loopBtn.classList.toggle("transport-btn--active", clock.loop === "loop");
    this._loopBtn.setAttribute("aria-pressed", String(clock.loop === "loop"));
    this._loopBtn.setAttribute("aria-label", clock.loop === "loop" ? "Boucle activée" : "Boucle désactivée");
    this._loopBtn.dataset.tooltip = clock.loop === "loop" ? "Boucle (activée)" : "Boucle (désactivée)";
  }

  private _syncLive(live: LiveState): void {
    this._liveBtn.classList.toggle("live--active", live.live);
    this._liveBtn.setAttribute("aria-pressed", String(live.live));
    this._liveBtn.setAttribute("aria-label", live.live ? "Couper le direct" : "Passer en direct");
  }
}

/** MM:SS:FF (frames au fps de composition). */
function formatTimecode(time: number, fps: number): string {
  const totalFrames = Math.floor(time * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60);
  return `${pad(minutes)}:${pad(seconds)}:${pad(frames)}`;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function navBtn(svg: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "transport-btn";
  btn.innerHTML = svg;
  btn.setAttribute("aria-label", label);
  btn.dataset.tooltip = label;
  btn.addEventListener("click", onClick);
  return btn;
}

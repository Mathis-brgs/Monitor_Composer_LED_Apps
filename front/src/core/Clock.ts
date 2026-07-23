export type ClockListener = (clock: Clock) => void;
export type LoopMode = "off" | "loop";

/**
 * Horloge de lecture (transport) : temps de composition en secondes qui n'avance
 * QUE lorsque `playing`. Le Runtime (RAF) tourne toujours ; c'est cette horloge,
 * pas le RAF, qui pilote le temps envoyé au moteur — d'où un vrai play/pause.
 */
export class Clock {
  private _time = 0;
  private _playing = false;
  private _fps = 24;
  private _durationFrames = 192; // 8 s @ 24 fps par défaut
  private _loop: LoopMode = "off";
  private _bpm = 120;            // tempo (grille rythmique + snap)
  private _beatsPerBar = 4;      // signature (temps par mesure)
  private readonly _listeners = new Set<ClockListener>();

  get time(): number {
    return this._time;
  }

  get playing(): boolean {
    return this._playing;
  }

  get fps(): number {
    return this._fps;
  }

  get durationFrames(): number {
    return this._durationFrames;
  }

  /** Durée de composition en secondes (= durationFrames / fps). */
  get duration(): number {
    return this._fps > 0 ? this._durationFrames / this._fps : 0;
  }

  /** Frame courant (arrondi au fps). */
  get frame(): number {
    return this.timeToFrame(this._time);
  }

  get loop(): LoopMode {
    return this._loop;
  }

  /** Tempo en battements par minute (grille + snap). */
  get bpm(): number {
    return this._bpm;
  }

  /** Temps par mesure (accent de mesure sur la grille). */
  get beatsPerBar(): number {
    return this._beatsPerBar;
  }

  /** Durée d'un battement en frames (= fps · 60 / bpm). */
  get framesPerBeat(): number {
    return this._bpm > 0 ? (this._fps * 60) / this._bpm : 0;
  }

  setBpm(bpm: number): void {
    if (bpm > 0 && bpm !== this._bpm) {
      this._bpm = bpm;
      this._emit();
    }
  }

  setBeatsPerBar(n: number): void {
    const v = Math.max(1, Math.round(n));
    if (v !== this._beatsPerBar) {
      this._beatsPerBar = v;
      this._emit();
    }
  }

  /**
   * Avance le temps de `deltaTime` s (sans effet si en pause / dt <= 0).
   * En boucle : wrap modulo la durée. Sinon : clamp à la fin + auto-pause.
   */
  advance(deltaTime: number): void {
    if (!this._playing || deltaTime <= 0) return;
    let t = this._time + deltaTime;
    const dur = this.duration;
    if (this._loop === "loop") {
      if (dur > 0) t %= dur;
    } else if (dur > 0 && t >= dur) {
      t = dur;
      this._playing = false;
    }
    this._time = Math.max(0, t);
    this._emit();
  }

  toggle(): void {
    this._playing = !this._playing;
    this._emit();
  }

  play(): void {
    if (!this._playing) {
      this._playing = true;
      this._emit();
    }
  }

  pause(): void {
    if (this._playing) {
      this._playing = false;
      this._emit();
    }
  }

  /** Place le temps (secondes), clampé à [0, duration]. */
  seek(time: number): void {
    const dur = this.duration;
    let t = Math.max(0, time);
    if (dur > 0) t = Math.min(t, dur);
    this._time = t;
    this._emit();
  }

  /** Place le playhead à un frame donné, clampé à [0, durationFrames]. */
  seekFrame(frame: number): void {
    const f = clamp(Math.round(frame), 0, this._durationFrames);
    this._time = this.frameToTime(f);
    this._emit();
  }

  /** Décale de `delta` frames et met en pause (navigation image par image). */
  stepFrame(delta: number): void {
    this._playing = false;
    this.seekFrame(this.frame + delta);
  }

  goToStart(): void {
    this.seekFrame(0);
  }

  goToEnd(): void {
    this.seekFrame(this._durationFrames);
  }

  reset(): void {
    this._time = 0;
    this._emit();
  }

  /** (Re)configure la grille de temps. fps <= 0 et durée négative ignorés. */
  configure(opts: { fps?: number; durationFrames?: number }): void {
    if (opts.fps !== undefined && opts.fps > 0) this._fps = opts.fps;
    if (opts.durationFrames !== undefined && opts.durationFrames >= 0) {
      this._durationFrames = Math.round(opts.durationFrames);
    }
    this._emit();
  }

  setLoop(mode: LoopMode): void {
    this._loop = mode;
    this._emit();
  }

  timeToFrame(time: number): number {
    return Math.round(time * this._fps);
  }

  frameToTime(frame: number): number {
    return this._fps > 0 ? frame / this._fps : 0;
  }

  /** S'abonne aux changements (état + temps). Appelé une fois immédiatement. Retourne le désabonnement. */
  subscribe(listener: ClockListener): () => void {
    this._listeners.add(listener);
    listener(this);
    return () => this._listeners.delete(listener);
  }

  private _emit(): void {
    for (const listener of this._listeners) listener(this);
  }
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, value));
}

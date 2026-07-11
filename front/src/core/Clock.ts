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

  /** Avance le temps de `deltaTime` s — sans effet si en pause. */
  advance(deltaTime: number): void {
    if (this._playing && deltaTime > 0) {
      this._time += deltaTime;
      this._emit();
    }
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

  seek(time: number): void {
    this._time = Math.max(0, time);
    this._emit();
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

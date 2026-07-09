export type ClockListener = (clock: Clock) => void;

/**
 * Horloge de lecture (transport) : temps de composition en secondes qui n'avance
 * QUE lorsque `playing`. Le Runtime (RAF) tourne toujours ; c'est cette horloge,
 * pas le RAF, qui pilote le temps envoyé au moteur — d'où un vrai play/pause.
 */
export class Clock {
  private _time = 0;
  private _playing = false;
  private readonly _listeners = new Set<ClockListener>();

  get time(): number {
    return this._time;
  }

  get playing(): boolean {
    return this._playing;
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

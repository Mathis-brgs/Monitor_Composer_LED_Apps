export interface Frame {
  /** temps écoulé depuis le start, en secondes */
  readonly time: number;
  /** delta depuis la frame précédente, en secondes */
  readonly deltaTime: number;
}

/** Horloge : boucle requestAnimationFrame unique. Ne connaît rien du rendu. */
export class Runtime {
  private _id = 0;
  private _start = 0;
  private _last = 0;
  private _running = false;

  constructor(private readonly _tick: (frame: Frame) => void) {}

  start(): void {
    if (this._running) return;
    this._running = true;
    this._start = performance.now();
    this._last = this._start;
    this._id = requestAnimationFrame(this._loop);
  }

  stop(): void {
    this._running = false;
    cancelAnimationFrame(this._id);
  }

  private readonly _loop = (): void => {
    const now = performance.now();
    const deltaTime = (now - this._last) / 1000;
    this._last = now;
    this._tick({ time: (now - this._start) / 1000, deltaTime });
    this._id = requestAnimationFrame(this._loop);
  };
}

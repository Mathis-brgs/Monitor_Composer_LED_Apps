export type LiveListener = (state: LiveState) => void;

/**
 * État "LIVE" : quand actif, le moteur envoie la scène au routeur (eHuB) en
 * continu. Quand désactivé, l'envoi s'arrête — et on pousse une dernière
 * frame noire (voir Engine.blackout) pour ne pas laisser le mur figé sur la
 * dernière image envoyée. Off par défaut : on n'envoie rien tant que
 * personne n'a explicitement mis le show en direct.
 */
export class LiveState {
  private _live = false;
  private readonly _listeners = new Set<LiveListener>();

  get live(): boolean {
    return this._live;
  }

  toggle(): void {
    this._live = !this._live;
    this._emit();
  }

  /** S'abonne aux changements. Appelé une fois immédiatement. Retourne le désabonnement. */
  subscribe(listener: LiveListener): () => void {
    this._listeners.add(listener);
    listener(this);
    return () => this._listeners.delete(listener);
  }

  private _emit(): void {
    for (const listener of this._listeners) listener(this);
  }
}

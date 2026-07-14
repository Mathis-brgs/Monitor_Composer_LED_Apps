import {
  EMPTY_COMPOSITION, sampleKeyframes, upsertKeyframe, moveKeyframe, removeKeyframe,
  type Composition, type Track,
} from "../domain/Composition.ts";

/** Applique la valeur d'un canal scalaire à un calque (modèle + moteur). Fourni par l'Editor. */
export type ApplyChannel = (layerId: string, channel: string, value: number) => void;

/**
 * Détient les tracks de keyframes et applique les valeurs échantillonnées par frame.
 * Agnostique du moteur et du modèle : passe par le callback `apply` injecté.
 */
export class Animator {
  private _comp: Composition = { tracks: [...EMPTY_COMPOSITION.tracks] };
  private readonly _apply: ApplyChannel;

  constructor(apply: ApplyChannel) {
    this._apply = apply;
  }

  load(comp: Composition): void {
    this._comp = comp;
  }

  get composition(): Composition {
    return this._comp;
  }

  isAnimated(layerId: string, channel: string): boolean {
    return this._find(layerId, channel) !== undefined;
  }

  /** Chaque frame : échantillonne chaque track et applique (aucune émission). */
  evaluate(frame: number): void {
    for (const t of this._comp.tracks) {
      if (t.keyframes.length > 0) this._apply(t.layerId, t.channel, sampleKeyframes(t.keyframes, frame));
    }
  }

  /** Crée une track (1 clé) pour un canal non encore animé. `value` = valeur au frame courant. */
  addChannel(layerId: string, channel: string, frame: number, value: number): void {
    if (this._find(layerId, channel)) return;
    this._comp.tracks.push({ layerId, channel, keyframes: [{ frame, value, interp: "linear" }] });
  }

  removeChannel(layerId: string, channel: string): void {
    this._comp.tracks = this._comp.tracks.filter((t) => !(t.layerId === layerId && t.channel === channel));
  }

  /** Pose/met à jour une clé au frame courant si le canal est animé. Renvoie true si une NOUVELLE clé a été insérée. */
  autoKey(layerId: string, channel: string, frame: number, value: number): boolean {
    const t = this._find(layerId, channel);
    if (!t) return false;
    const existed = t.keyframes.some((k) => k.frame === frame);
    t.keyframes = upsertKeyframe(t.keyframes, { frame, value, interp: "linear" });
    return !existed;
  }

  /** Déplace une clé d'une track (no-op si track/clé absente). */
  moveKey(layerId: string, channel: string, from: number, to: number): void {
    const t = this._find(layerId, channel);
    if (t) t.keyframes = moveKeyframe(t.keyframes, from, to);
  }

  /** Retire une clé ; supprime la track si elle devient vide (pas de track fantôme). */
  removeKey(layerId: string, channel: string, frame: number): void {
    const t = this._find(layerId, channel);
    if (!t) return;
    t.keyframes = removeKeyframe(t.keyframes, frame);
    if (t.keyframes.length === 0) this.removeChannel(layerId, channel);
  }

  /** Supprime toutes les tracks d'un calque (à sa suppression). */
  dropLayer(layerId: string): void {
    this._comp.tracks = this._comp.tracks.filter((t) => t.layerId !== layerId);
  }

  private _find(layerId: string, channel: string): Track | undefined {
    return this._comp.tracks.find((t) => t.layerId === layerId && t.channel === channel);
  }
}

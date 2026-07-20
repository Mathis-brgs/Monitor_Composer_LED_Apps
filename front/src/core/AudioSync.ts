import type { Clock } from "./Clock.ts";
import type { Editor } from "./Editor.ts";
import type { AudioEngine } from "./AudioEngine.ts";
import type { Layer } from "@domain/Layer.ts";

/** Au-delà de ce décalage audio↔horloge (s), on relance la source (loop, gros scrub). */
const RESLAVE_THRESHOLD = 0.06;

/**
 * Asservit la lecture audio à l'horloge de composition (frame = maître) : à
 * chaque frame, reflète play/pause de l'horloge sur l'AudioEngine et corrige la
 * dérive. MVP = première piste audio de l'arbre (soundtrack), depuis t=0.
 */
export class AudioSync {
  private readonly _engine: AudioEngine;
  private readonly _editor: Editor;
  private readonly _clock: Clock;

  constructor(engine: AudioEngine, editor: Editor, clock: Clock) {
    this._engine = engine;
    this._editor = editor;
    this._clock = clock;
  }

  /** Première piste audio chargée dans le moteur (parcours de l'arbre), ou null. */
  private _asset(): { id: string; gain: number } | null {
    const walk = (layers: readonly Layer[]): { id: string; gain: number } | null => {
      for (const l of layers) {
        if (l.type === "audio" && this._engine.has(l.assetId)) return { id: l.assetId, gain: l.gain };
        if (l.type === "group") { const found = walk(l.children); if (found) return found; }
      }
      return null;
    };
    return walk(this._editor.getDocument().root.children);
  }

  /** Appelé chaque frame par la boucle de rendu. */
  tick(): void {
    const eng = this._engine;
    const a = this._asset();
    if (!a) { if (eng.playing) eng.stop(); return; }
    if (this._clock.playing) {
      const t = this._clock.time;
      const synced = eng.playing && eng.playingId === a.id && Math.abs(eng.positionSec() - t) <= RESLAVE_THRESHOLD;
      if (!synced) eng.play(a.id, t, a.gain);
    } else if (eng.playing) {
      eng.stop();
    }
  }
}

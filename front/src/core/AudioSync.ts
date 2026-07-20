import type { Clock } from "./Clock.ts";
import type { Editor } from "./Editor.ts";
import type { AudioEngine } from "./AudioEngine.ts";
import { mediaClipActiveAt, mediaSourceFrameAt, type Layer, type MediaClip } from "@domain/Layer.ts";

/** Au-delà de ce décalage audio↔horloge (s), on relance la source (changement de clip, gap, scrub). */
const RESLAVE_THRESHOLD = 0.06;

/**
 * Asservit la lecture audio à l'horloge de composition (frame = maître) : à chaque
 * frame, joue le clip de montage actif à l'offset source correspondant, et corrige
 * la dérive. Gap entre clips = silence. MVP : première piste audio avec un clip actif.
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

  /** Clip de montage actif au frame courant (1re piste audio chargée), ou null. */
  private _active(): { assetId: string; clip: MediaClip; gain: number } | null {
    const frame = this._clock.frame;
    const walk = (layers: readonly Layer[]): { assetId: string; clip: MediaClip; gain: number } | null => {
      for (const l of layers) {
        if (l.type === "audio" && this._engine.has(l.assetId) && l.clips) {
          const clip = l.clips.find((c) => mediaClipActiveAt(c, frame));
          if (clip) return { assetId: l.assetId, clip, gain: l.gain };
        }
        if (l.type === "group") { const found = walk(l.children); if (found) return found; }
      }
      return null;
    };
    return walk(this._editor.getDocument().root.children);
  }

  /** Appelé chaque frame par la boucle de rendu. */
  tick(): void {
    const eng = this._engine;
    const a = this._active();
    if (!a || !this._clock.playing) {
      if (eng.playing) eng.stop();
      return;
    }
    const srcSec = mediaSourceFrameAt(a.clip, this._clock.frame) / this._clock.fps;
    const synced = eng.playing && eng.playingId === a.assetId && Math.abs(eng.positionSec() - srcSec) <= RESLAVE_THRESHOLD;
    if (!synced) eng.play(a.assetId, srcSec, a.gain);
  }
}

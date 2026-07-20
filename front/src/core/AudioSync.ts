import type { Clock } from "./Clock.ts";
import type { Editor } from "./Editor.ts";
import type { AudioEngine } from "./AudioEngine.ts";
import { mediaClipActiveAt, mediaSourceFrameAt, mediaFadeGain, type Layer, type MediaClip } from "@domain/Layer.ts";

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

  /** Toutes les pistes audio de l'arbre (parcours en profondeur). */
  private _audioLayers(): Layer[] {
    const out: Layer[] = [];
    const walk = (layers: readonly Layer[]): void => {
      for (const l of layers) {
        if (l.type === "audio") out.push(l);
        else if (l.type === "group") walk(l.children);
      }
    };
    walk(this._editor.getDocument().root.children);
    return out;
  }

  /** Clip de montage actif au frame courant, mute/solo respectés, ou null.
   *  Mute = `!visible` ; Solo = si ≥ 1 piste audio en solo (non mutée), seules celles-là jouent. */
  private _active(): { assetId: string; clip: MediaClip; gain: number } | null {
    const frame = this._clock.frame;
    const audio = this._audioLayers();
    const anySolo = audio.some((l) => l.type === "audio" && l.solo && l.visible);
    for (const l of audio) {
      if (l.type !== "audio") continue;
      if (!l.visible) continue; // muté
      if (anySolo && !l.solo) continue; // solo actif ailleurs
      if (!this._engine.has(l.assetId) || !l.clips) continue;
      const clip = l.clips.find((c) => mediaClipActiveAt(c, frame));
      if (clip) return { assetId: l.assetId, clip, gain: l.gain };
    }
    return null;
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
    // enveloppe de fondu appliquée en continu (le gain node est mis à jour chaque frame)
    eng.setGain(a.gain * mediaFadeGain(a.clip, this._clock.frame));
  }
}

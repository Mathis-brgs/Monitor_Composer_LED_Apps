import { computePeaks } from "./audio-peaks.ts";

/** Waveform précalculée d'un asset audio (paires min/max entrelacées). */
export interface AudioPeaks {
  readonly data: Float32Array;
  readonly buckets: number;
  readonly durationSec: number;
}

const PEAK_BUCKETS_PER_SEC = 200;
const MAX_BUCKETS = 6000;

/**
 * Moteur audio (Web Audio) : décode les assets, précalcule leur waveform, et lit
 * UNE source à la fois asservie à l'horloge de composition (frame = maître).
 * Aucune dépendance UI ; l'appelant (AudioSync) reflète play/pause/seek dessus.
 */
export class AudioEngine {
  private _ctx: AudioContext | null = null;
  private readonly _buffers = new Map<string, AudioBuffer>();
  private readonly _peaks = new Map<string, AudioPeaks>();
  private _source: AudioBufferSourceNode | null = null;
  private _gainNode: GainNode | null = null;
  private _playingId: string | null = null;
  private _startCtxTime = 0;
  private _startOffset = 0;

  private _context(): AudioContext {
    if (!this._ctx) this._ctx = new AudioContext();
    return this._ctx;
  }

  /** Décode un fichier audio et précalcule sa waveform. Idempotent par `assetId`. */
  async load(assetId: string, data: ArrayBuffer): Promise<AudioPeaks> {
    const existing = this._peaks.get(assetId);
    if (existing) return existing;
    const buf = await this._context().decodeAudioData(data);
    this._buffers.set(assetId, buf);
    const buckets = Math.min(MAX_BUCKETS, Math.max(1, Math.ceil(buf.duration * PEAK_BUCKETS_PER_SEC)));
    const peaks: AudioPeaks = { data: computePeaks(buf.getChannelData(0), buckets), buckets, durationSec: buf.duration };
    this._peaks.set(assetId, peaks);
    return peaks;
  }

  has(assetId: string): boolean { return this._buffers.has(assetId); }
  peaks(assetId: string): AudioPeaks | null { return this._peaks.get(assetId) ?? null; }
  duration(assetId: string): number { return this._buffers.get(assetId)?.duration ?? 0; }

  get playing(): boolean { return this._source !== null; }
  get playingId(): string | null { return this._playingId; }

  /** Position de lecture courante (s), depuis l'horloge audio matérielle. */
  positionSec(): number {
    if (!this._ctx || !this._source) return this._startOffset;
    return this._startOffset + (this._ctx.currentTime - this._startCtxTime);
  }

  /** Lit `assetId` à partir de `offsetSec` avec `gain` (coupe la source précédente). */
  play(assetId: string, offsetSec: number, gain = 1): void {
    const buf = this._buffers.get(assetId);
    if (!buf) return;
    this.stop();
    const ctx = this._context();
    if (ctx.state === "suspended") void ctx.resume();
    const off = Math.max(0, Math.min(buf.duration, offsetSec));
    if (off >= buf.duration) return; // au-delà de la fin : rien à jouer
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(ctx.destination);
    src.onended = () => { if (this._source === src) { this._source = null; this._gainNode = null; this._playingId = null; } };
    src.start(0, off);
    this._source = src;
    this._gainNode = g;
    this._playingId = assetId;
    this._startCtxTime = ctx.currentTime;
    this._startOffset = off;
  }

  /** Ajuste le gain de la source en cours (automation live : fades, rubber-band). */
  setGain(gain: number): void {
    if (this._gainNode) this._gainNode.gain.value = Math.max(0, gain);
  }

  /** Coupe la lecture en cours (idempotent). */
  stop(): void {
    if (this._source) {
      try { this._source.stop(); } catch { /* déjà arrêtée */ }
      this._source.disconnect();
    }
    this._source = null;
    this._gainNode = null;
    this._playingId = null;
  }
}

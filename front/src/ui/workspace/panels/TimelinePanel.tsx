import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { Clock } from "@core/Clock.ts";
import type { Editor } from "@core/Editor.ts";
import type { AudioEngine, AudioPeaks } from "@core/AudioEngine.ts";
import {
  moveClip, trimIn, trimOut, moveMediaClip, trimMediaIn, trimMediaOut, splitMediaClip,
  mediaClipLength, mediaClipTimelineOut,
  type Clip, type Layer, type MediaClip,
} from "@domain/Layer.ts";
import { getCubicBezierVelocity, sampleKeyframes, type Interp } from "@domain/Composition.ts";
import { createIcon } from "@ui/icons/Icon.ts";
import { NumberField } from "@ui/solid/controls.tsx";
import { fromStore } from "@ui/solid/store.ts";
import { solidPanel } from "@ui/solid/mount.ts";
import { animatableProps } from "./timeline-properties.ts";
import type { Panel } from "../Panel.ts";

const AXIS_SHORT: Record<string, string> = { x: "X", y: "Y", z: "Z", r: "R", g: "G", b: "B" };
/** Libellé court d'un canal pour l'éditeur de valeur ("position.x" → "X", "opacity" → ""). */
function channelShort(channel: string): string {
  const k = channel.split(".")[1];
  return k ? (AXIS_SHORT[k] ?? k) : "";
}

function evaluateVelocity(interp: string, cp: readonly [number, number, number, number] | undefined, raw: number): number {
  if (interp === "linear") return 1;
  if (interp === "hold") return 0;
  if (interp === "ease-in") return 2 * raw;
  if (interp === "ease-out") return 2 * (1 - raw);
  if (interp === "bezier") {
    const x1 = cp ? cp[0] : 0.42;
    const y1 = cp ? cp[1] : 0;
    const x2 = cp ? cp[2] : 0.58;
    const y2 = cp ? cp[3] : 1;
    return getCubicBezierVelocity(x1, y1, x2, y2, raw);
  }
  return 0;
}

const MIN_PPS = 8;
const MAX_PPS = 400;
const DEFAULT_PPS = 90;

function clampPps(v: number): number {
  return Math.max(MIN_PPS, Math.min(MAX_PPS, v));
}

interface AxisRow { channel: string; label: string; animated: boolean; frames: number[]; interps: Interp[] }
interface PropRow { label: string; channels: string[]; animated: boolean; frames: number[]; interps: Interp[]; axes: AxisRow[] }
interface LayerRow { layerId: string; type: Layer["type"]; assetId: string | undefined; name: string; clip: Clip | undefined; mediaClips: MediaClip[]; gain: number; props: PropRow[]; keyframes: number[]; visible: boolean; solo: boolean; locked: boolean; label: string | undefined }

/** Gain audio maximal (rubber-band de volume) : 2 = +6 dB env., 1 = unité. */
const GAIN_MAX = 2;

const WAVE_H = 64; // hauteur du backing waveform (affiché en 100% de la piste ; downscale net au zoom vertical)
/** Cache LRU de waveforms rasterisées : reconstruire un canvas (rebuild `<For>`) ne relance
 *  plus la boucle de peaks — un simple `drawImage` suffit. Clé = fenêtre + géométrie + zoom. */
const WAVE_CACHE = new Map<string, HTMLCanvasElement>();
const WAVE_CACHE_MAX = 96;
function waveBitmap(pk: AudioPeaks, key: string, w: number, b0: number, b1: number, z: number, color: string): HTMLCanvasElement {
  const hit = WAVE_CACHE.get(key);
  if (hit) { WAVE_CACHE.delete(key); WAVE_CACHE.set(key, hit); return hit; } // touch (LRU)
  const c = document.createElement("canvas");
  c.width = w;
  c.height = WAVE_H;
  const g = c.getContext("2d");
  if (g) {
    const span = Math.max(1, b1 - b0);
    const mid = WAVE_H / 2;
    // un seul chemin rempli d'un coup (vs. un fillRect par pixel) — bien plus rapide
    const path = new Path2D();
    for (let x = 0; x < w; x++) {
      const b = Math.min(pk.buckets - 1, b0 + Math.floor((x / w) * span));
      const mx = Math.max(-1, Math.min(1, pk.data[b * 2 + 1] * z));
      const mn = Math.max(-1, Math.min(1, pk.data[b * 2] * z));
      const y0 = mid - mx * mid;
      path.rect(x, y0, 1, Math.max(1, (mid - mn * mid) - y0));
    }
    g.fillStyle = color;
    g.fill(path);
  }
  if (WAVE_CACHE.size >= WAVE_CACHE_MAX) WAVE_CACHE.delete(WAVE_CACHE.keys().next().value!);
  WAVE_CACHE.set(key, c);
  return c;
}

/** Waveform d'un clip audio : trace la FENÊTRE de source [sourceIn, sourceOut] du clip
 *  (pas d'écrasement au trim), depuis les peaks précalculés de l'AudioEngine. */
function AudioWave(props: {
  audio: AudioEngine; assetId: string; width: number;
  sourceIn: number; sourceOut: number; sourceFrames: number; zoom: number; version: number;
}): JSX.Element {
  let cv: HTMLCanvasElement | undefined;
  createEffect(() => {
    props.version; // dép. : redessine après un import
    const w = Math.max(1, Math.round(props.width));
    const pk = props.audio.peaks(props.assetId);
    const c = cv;
    if (!c) return;
    c.width = w;
    c.height = WAVE_H;
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, w, WAVE_H);
    if (!pk) return;
    // sous-plage de buckets correspondant à la fenêtre de source du clip
    const frames = Math.max(1, props.sourceFrames);
    const b0 = Math.max(0, Math.floor((props.sourceIn / frames) * pk.buckets));
    const b1 = Math.min(pk.buckets, Math.ceil((props.sourceOut / frames) * pk.buckets));
    const z = Math.max(1, props.zoom);
    const color = getComputedStyle(c).color || "#ff8a3d";
    const key = `${props.assetId}|${b0}|${b1}|${w}|${z}|${color}`;
    g.drawImage(waveBitmap(pk, key, w, b0, b1, z, color), 0, 0);
  });
  return <canvas ref={cv} class="seq__wave" />;
}

const LABEL_COLORS = ["#ff8a3d", "#7fd88a", "#5a9bff", "#c98bff", "#ffd24a", "#ff6b6b", "#4ad9d9", "#9aa0a6"];

/** Une clé sélectionnée = un groupe de canaux d'un calque à un frame. */
interface SelKey { layerId: string; frame: number; channels: string[] }
const sameKey = (a: SelKey, b: SelKey): boolean =>
  a.layerId === b.layerId && a.frame === b.frame && a.channels.join(",") === b.channels.join(",");

function Timeline(props: { clock: Clock; editor: Editor; audio: AudioEngine }): JSX.Element {
  const clock = props.clock;
  const editor = props.editor;
  const audio = props.audio;
  const time = fromStore(clock, () => clock.time);
  const frame = fromStore(clock, () => clock.frame);
  const duration = fromStore(clock, () => clock.duration);
  const fps = fromStore(clock, () => clock.fps);
  const bpm = fromStore(clock, () => clock.bpm);
  const beatsPerBar = fromStore(clock, () => clock.beatsPerBar);
  const [pps, setPps] = createSignal(DEFAULT_PPS);
  const [waveZoom, setWaveZoom] = createSignal(1); // zoom vertical (amplitude) de la waveform (Alt+molette)
  const [snapOn, setSnapOn] = createSignal(true);  // aimantation sur la grille rythmique (BPM)
  const [rowScale, setRowScale] = createSignal(1); // zoom en hauteur (taille des pistes)
  const [tlTool, setTlTool] = createSignal<"select" | "razor" | "hand">("select"); // outil actif (rail)

  // Zoom horizontal : slider 0..1 ↔ pps en échelle log (course lisible sur toute la plage).
  const ppsToT = (p: number): number => Math.log(p / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS);
  const tToPps = (t: number): number => clampPps(MIN_PPS * Math.pow(MAX_PPS / MIN_PPS, Math.max(0, Math.min(1, t))));
  const ROW_SCALE_MIN = 0.7;
  const ROW_SCALE_MAX = 2.6;

  // Snapshot réactif : recalculé à chaque emit de l'Editor (jamais pendant la lecture).
  // Une rangée par calque (ordre z) + son catalogue de propriétés animables (façon AE).
  const version = fromStore(editor, () => editor.getComposition());
  const selectedId = fromStore(editor, () => editor.selectedId);
  const rows = createMemo<LayerRow[]>(() => {
    version();
    const tracks = editor.getComposition().tracks;
    return editor.children.map((l) => {
      const props = animatableProps(l).map((p) => {
        const chanTracks = tracks.filter((t) => t.layerId === l.id && p.channels.includes(t.channel));
        const set = new Set<number>();
        for (const t of chanTracks) for (const k of t.keyframes) set.add(k.frame);
        const frames = [...set].sort((a, b) => a - b);
        // interp affichée = celle du 1er canal ayant une clé à ce frame (les canaux d'un groupe sont keyés ensemble)
        const interps = frames.map((f) => {
          for (const t of chanTracks) { const k = t.keyframes.find((x) => x.frame === f); if (k) return k.interp; }
          return "linear" as Interp;
        });
        // sous-pistes par axe (X/Y/Z) pour les propriétés multi-canaux (séparer les dimensions)
        const axes: AxisRow[] = p.channels.length > 1
          ? p.channels.map((ch) => {
              const t = chanTracks.find((tt) => tt.channel === ch);
              return {
                channel: ch,
                label: channelShort(ch),
                animated: !!t,
                frames: t ? t.keyframes.map((k) => k.frame) : [],
                interps: t ? t.keyframes.map((k) => k.interp) : [],
              };
            })
          : [];
        return { label: p.label, channels: p.channels, animated: chanTracks.length > 0, frames, interps, axes };
      });
      const keyframes = [...new Set(props.flatMap((p) => p.frames))].sort((a, b) => a - b);
      const assetId = "assetId" in l ? l.assetId : undefined;
      const mediaClips = "clips" in l && l.clips ? l.clips : [];
      const gain = l.type === "audio" ? l.gain : 1;
      return { layerId: l.id, type: l.type, assetId, name: l.name, clip: l.clip, mediaClips, gain, props, keyframes, visible: l.visible, solo: !!l.solo, locked: !!l.locked, label: l.label };
    });
  });
  // Séparation façon Premiere : pistes visuelles au-dessus, pistes audio regroupées en dessous.
  const videoRows = createMemo<LayerRow[]>(() => rows().filter((r) => r.type !== "audio"));
  const audioRows = createMemo<LayerRow[]>(() => rows().filter((r) => r.type === "audio"));
  // Pistes audio EN HAUT (façon Logic), pistes visuelles en dessous.
  const sortedRows = createMemo<LayerRow[]>(() => [...audioRows(), ...videoRows()]);
  /** Libellé de section à insérer AVANT la rangée i (transition audio↔visuel), sinon null. */
  const sectionBefore = (i: number): string | null => {
    const rws = sortedRows();
    if (i === 0) return rws[0]?.type === "audio" ? "Audio" : "Visuel";
    const prevAudio = rws[i - 1].type === "audio";
    const curAudio = rws[i].type === "audio";
    return prevAudio !== curAudio ? (curAudio ? "Audio" : "Visuel") : null;
  };

  // Waveforms : bumpé après un import audio pour forcer le redraw des canvas.
  const [audioVersion, setAudioVersion] = createSignal(0);
  /** Importe un fichier audio → décodage (peaks) + piste audio dans l'arbre. */
  const importAudio = (): void => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "audio/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.arrayBuffer().then(async (buf) => {
        const assetId = `${file.name}:${file.size}`;
        const pk = await audio.load(assetId, buf);
        const audioFrames = Math.max(1, Math.round(pk.durationSec * clock.fps));
        // Audio plus long que la composition → proposer de caler la timeline dessus.
        if (audioFrames > clock.durationFrames) {
          const fit = window.confirm(
            `L'audio dure ${pk.durationSec.toFixed(1)} s, plus que la composition (${clock.duration.toFixed(1)} s).\n\n` +
              `OK = caler la durée de la timeline sur l'audio\nAnnuler = garder la durée actuelle`,
          );
          if (fit) clock.configure({ durationFrames: audioFrames });
        }
        // Un clip de montage couvrant toute la source (durée réelle) → largeur/waveform correctes.
        editor.addAudio(assetId, file.name.replace(/\.[^.]+$/, ""), audioFrames);
        setAudioVersion((v) => v + 1);
      });
    };
    input.click();
  };

  /** Importe une vidéo → calque vidéo plein-cadre diffusé sur le mur (object URL, clip = durée réelle). */
  const importVideo = (): void => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      const name = file.name.replace(/\.[^.]+$/, "");
      const probe = document.createElement("video");
      probe.preload = "metadata";
      probe.onloadedmetadata = () => editor.addVideo(url, name, Math.max(1, Math.round(probe.duration * clock.fps)));
      probe.onerror = () => editor.addVideo(url, name); // fallback : source entière
      probe.src = url;
    };
    input.click();
  };

  const [expanded, setExpanded] = createSignal<Set<string>>(new Set());
  const isExpanded = (id: string): boolean => expanded().has(id);
  const toggleExpand = (id: string): void => {
    const n = new Set(expanded());
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setExpanded(n);
  };

  const [selection, setSelection] = createSignal<SelKey[]>([]);
  const isSelected = (layerId: string, frame: number, channels: string[]): boolean =>
    selection().some((s) => sameKey(s, { layerId, frame, channels }));

  // Éditeur de courbes intégré à la timeline
  const [expandedCurves, setExpandedCurves] = createSignal<Set<string>>(new Set());
  const isCurvesExpanded = (layerId: string, label: string): boolean => expandedCurves().has(`${layerId}|${label}`);
  const toggleCurvesExpand = (layerId: string, label: string): void => {
    const n = new Set(expandedCurves());
    const k = `${layerId}|${label}`;
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setExpandedCurves(n);
  };

  const [activeGraphType, setActiveGraphType] = createSignal<Record<string, "value" | "velocity">>({});
  const [activeCurveAxis, setActiveCurveAxis] = createSignal<Record<string, number>>({});

  const getGraphType = (layerId: string, label: string): "value" | "velocity" => {
    return activeGraphType()[`${layerId}|${label}`] ?? "value";
  };
  const setGraphType = (layerId: string, label: string, type: "value" | "velocity") => {
    setActiveGraphType((prev) => ({ ...prev, [`${layerId}|${label}`]: type }));
  };

  const getCurveAxis = (layerId: string, label: string): number => {
    return activeCurveAxis()[`${layerId}|${label}`] ?? 0;
  };
  const setCurveAxis = (layerId: string, label: string, axis: number) => {
    setActiveCurveAxis((prev) => ({ ...prev, [`${layerId}|${label}`]: axis }));
  };

  const getSelectedKfsForProp = (layerId: string, p: PropRow): number[] => {
    return selection()
      .filter((s) => s.layerId === layerId && s.channels[0] === p.channels[0])
      .map((s) => s.frame);
  };

  const applyPresetToSelected = (layerId: string, p: PropRow, preset: string) => {
    const selectedFrames = getSelectedKfsForProp(layerId, p);
    if (selectedFrames.length === 0) return;
    const activeIdx = getCurveAxis(layerId, p.label);
    const ch = p.channels[activeIdx];
    if (!ch) return;
    for (const frame of selectedFrames) {
      if (preset === "linear") {
        editor.setKeyframeInterp(layerId, ch, frame, "linear");
      } else if (preset === "hold") {
        editor.setKeyframeInterp(layerId, ch, frame, "hold");
      } else if (preset === "bezier-ease") {
        editor.setKeyframeInterp(layerId, ch, frame, "bezier", [0.42, 0, 0.58, 1]);
      } else if (preset === "ease-in") {
        editor.setKeyframeInterp(layerId, ch, frame, "bezier", [0.42, 0, 1, 1]);
      } else if (preset === "ease-out") {
        editor.setKeyframeInterp(layerId, ch, frame, "bezier", [0, 0, 0.58, 1]);
      }
    }
  };

  const getTrackBounds = (layerId: string, p: PropRow) => {
    version();
    let minVal = Infinity;
    let maxVal = -Infinity;
    let minVel = Infinity;
    let maxVel = -Infinity;

    for (const ch of p.channels) {
      const track = editor.getComposition().tracks.find((t) => t.layerId === layerId && t.channel === ch);
      if (!track || track.keyframes.length === 0) continue;

      const kfs = track.keyframes;
      const totalFrames = clock.durationFrames;
      const samplePoints = new Set<number>();
      for (const kf of kfs) samplePoints.add(kf.frame);
      for (let f = 0; f <= totalFrames; f += Math.max(1, Math.floor(totalFrames / 50))) {
        samplePoints.add(f);
      }

      for (const f of samplePoints) {
        const val = sampleKeyframes(kfs, f);
        if (val < minVal) minVal = val;
        if (val > maxVal) maxVal = val;

        const kfIndex = kfs.findIndex((k) => k.frame > f) - 1;
        if (kfIndex >= 0 && kfIndex < kfs.length - 1) {
          const a = kfs[kfIndex];
          const b = kfs[kfIndex + 1];
          const raw = (f - a.frame) / (b.frame - a.frame);
          const scale = (b.value - a.value) / Math.max(1, b.frame - a.frame);
          const vel = evaluateVelocity(a.interp, a.cp, raw) * scale;
          if (vel < minVel) minVel = vel;
          if (vel > maxVel) maxVel = vel;
        } else {
          if (0 < minVel) minVel = 0;
          if (0 > maxVel) maxVel = 0;
        }
      }
    }

    if (minVal === maxVal) {
      minVal -= 1;
      maxVal += 1;
    }
    if (minVel === maxVel) {
      minVel -= 1;
      maxVel += 1;
    }

    return { minVal, maxVal, minVel, maxVel };
  };

  const trackBounds = (layerId: string, p: PropRow) => {
    return getTrackBounds(layerId, p);
  };

  const getFullValuePath = (layerId: string, ch: string, bounds: { minVal: number; maxVal: number }) => {
    version();
    const track = editor.getComposition().tracks.find((t) => t.layerId === layerId && t.channel === ch);
    if (!track || track.keyframes.length === 0) {
      const val = editor.keyframeValue(layerId, ch, 0) ?? 0;
      const y = 110 - ((val - bounds.minVal) / (bounds.maxVal - bounds.minVal)) * 100;
      return `M 0 ${y} L ${framesToPx(clock.durationFrames)} ${y}`;
    }
    const kfs = track.keyframes;
    const duration = clock.durationFrames;
    let path = `M 0 ${110 - ((sampleKeyframes(kfs, 0) - bounds.minVal) / (bounds.maxVal - bounds.minVal)) * 100}`;

    for (let f = 1; f <= duration; f++) {
      const val = sampleKeyframes(kfs, f);
      const x = framesToPx(f);
      const y = 110 - ((val - bounds.minVal) / (bounds.maxVal - bounds.minVal)) * 100;
      path += ` L ${x} ${y}`;
    }
    return path;
  };

  const getFullVelocityPath = (layerId: string, ch: string, bounds: { minVel: number; maxVel: number }) => {
    version();
    const track = editor.getComposition().tracks.find((t) => t.layerId === layerId && t.channel === ch);
    if (!track || track.keyframes.length === 0) {
      const y = 110 - ((0 - bounds.minVel) / (bounds.maxVel - bounds.minVel)) * 100;
      return `M 0 ${y} L ${framesToPx(clock.durationFrames)} ${y}`;
    }
    const kfs = track.keyframes;
    const duration = clock.durationFrames;

    const getVelAt = (f: number) => {
      const kfIndex = kfs.findIndex((k) => k.frame > f) - 1;
      if (kfIndex >= 0 && kfIndex < kfs.length - 1) {
        const a = kfs[kfIndex];
        const b = kfs[kfIndex + 1];
        const raw = (f - a.frame) / (b.frame - a.frame);
        const scale = (b.value - a.value) / Math.max(1, b.frame - a.frame);
        return evaluateVelocity(a.interp, a.cp, raw) * scale;
      }
      return 0;
    };

    let path = `M 0 ${110 - ((getVelAt(0) - bounds.minVel) / (bounds.maxVel - bounds.minVel)) * 100}`;
    for (let f = 1; f <= duration; f++) {
      const v = getVelAt(f);
      const x = framesToPx(f);
      const y = 110 - ((v - bounds.minVel) / (bounds.maxVel - bounds.minVel)) * 100;
      path += ` L ${x} ${y}`;
    }
    return path;
  };

  const getCPPositions = (
    layerId: string,
    ch: string,
    kfFrame: number,
    mode: "value" | "velocity",
    bounds: { minVal: number; maxVal: number; minVel: number; maxVel: number }
  ) => {
    version();
    const track = editor.getComposition().tracks.find((t) => t.layerId === layerId && t.channel === ch);
    if (!track) return null;
    const kfs = track.keyframes;
    const idx = kfs.findIndex((k) => k.frame === kfFrame);
    if (idx < 0 || idx >= kfs.length - 1) return null;
    const a = kfs[idx];
    const b = kfs[idx + 1];
    const f_start = a.frame;
    const f_end = b.frame;
    const duration = f_end - f_start;
    const val_start = a.value;
    const val_end = b.value;
    const val_diff = val_end - val_start;
    const scale = val_diff / Math.max(1, duration);

    const cp = a.cp || (a.interp === "linear" ? [0, 0, 1, 1] : [0.42, 0, 0.58, 1]);
    const x1 = cp[0], y1 = cp[1], x2 = cp[2], y2 = cp[3];

    if (mode === "value") {
      const val_cp1 = val_start + val_diff * y1;
      const val_cp2 = val_start + val_diff * y2;
      return {
        cp1: { x: framesToPx(f_start + x1 * duration), y: 110 - ((val_cp1 - bounds.minVal) / (bounds.maxVal - bounds.minVal)) * 100 },
        cp2: { x: framesToPx(f_start + x2 * duration), y: 110 - ((val_cp2 - bounds.minVal) / (bounds.maxVal - bounds.minVal)) * 100 }
      };
    } else {
      const V_start = x1 !== 0 ? y1 / x1 : 0;
      const V_end = (1 - x2) !== 0 ? (1 - y2) / (1 - x2) : 0;
      return {
        cp1: { x: framesToPx(f_start + x1 * duration), y: 110 - ((V_start * scale - bounds.minVel) / (bounds.maxVel - bounds.minVel)) * 100 },
        cp2: { x: framesToPx(f_start + x2 * duration), y: 110 - ((V_end * scale - bounds.minVel) / (bounds.maxVel - bounds.minVel)) * 100 }
      };
    }
  };

  const onTimelineCPDown = (
    layerId: string,
    ch: string,
    kfFrame: number,
    cpIndex: 1 | 2,
    mode: "value" | "velocity",
    bounds: { minVal: number; maxVal: number; minVel: number; maxVel: number },
    e: PointerEvent
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as SVGElement;
    const svg = target.ownerSVGElement;
    if (!svg) return;
    try {
      target.setPointerCapture(e.pointerId);
    } catch (err) {
      console.warn("Failed to set pointer capture:", err);
    }
    const rect = svg.getBoundingClientRect();

    const track = editor.getComposition().tracks.find((t) => t.layerId === layerId && t.channel === ch);
    if (!track) return;
    const kfs = track.keyframes;
    const idx = kfs.findIndex((k) => k.frame === kfFrame);
    if (idx < 0 || idx >= kfs.length - 1) return;
    const a = kfs[idx];
    const b = kfs[idx + 1];
    const f_start = a.frame;
    const f_end = b.frame;
    const duration = f_end - f_start;
    const val_start = a.value;
    const val_end = b.value;
    const val_diff = val_end - val_start;
    const scale = val_diff / Math.max(1, duration);

    const move = (ev: PointerEvent) => {
      const pointerX = ev.clientX - rect.left;
      const pointerY = ev.clientY - rect.top;

      const pointerFrame = (pointerX * clock.fps / pps()) - f_start;
      const newX = Math.max(0, Math.min(1, pointerFrame / duration));

      const cp = a.cp || (a.interp === "linear" ? [0, 0, 1, 1] : [0.42, 0, 0.58, 1]);
      let x1 = cp[0], y1 = cp[1], x2 = cp[2], y2 = cp[3];

      if (mode === "value") {
        const val = bounds.minVal + ((110 - pointerY) / 100) * (bounds.maxVal - bounds.minVal);
        let newY = 0;
        if (val_diff !== 0) {
          newY = (val - val_start) / val_diff;
        } else {
          newY = 1 - (pointerY - 10) / 100;
        }
        newY = Math.max(-0.5, Math.min(1.5, newY));

        if (cpIndex === 1) {
          x1 = newX;
          y1 = newY;
        } else {
          x2 = newX;
          y2 = newY;
        }
      } else {
        const v = bounds.minVel + ((110 - pointerY) / 100) * (bounds.maxVel - bounds.minVel);
        const v_norm = scale !== 0 ? v / scale : 0;

        if (cpIndex === 1) {
          x1 = newX;
          y1 = Math.max(-0.5, Math.min(1.5, v_norm * x1));
        } else {
          x2 = newX;
          y2 = Math.max(-0.5, Math.min(1.5, 1 - v_norm * (1 - x2)));
        }
      }

      editor.setKeyframeInterp(layerId, ch, f_start, "bezier", [x1, y1, x2, y2] as const);
    };

    const up = (ev: PointerEvent) => {
      target.releasePointerCapture(ev.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Menu contextuel d'interpolation (clic-droit sur un diamant).
  const [ctxMenu, setCtxMenu] = createSignal<{ layerId: string; channels: string[]; frame: number; x: number; y: number } | null>(null);
  // Palette de couleur de label (clic sur la pastille d'un calque).
  const [labelPalette, setLabelPalette] = createSignal<{ layerId: string; x: number; y: number } | null>(null);
  // Sous-pistes par axe (X/Y/Z) dépliées, clé = `layerId|label`.
  const [expandedProps, setExpandedProps] = createSignal<Set<string>>(new Set());
  const isPropExpanded = (layerId: string, label: string): boolean => expandedProps().has(`${layerId}|${label}`);
  const togglePropExpand = (layerId: string, label: string): void => {
    const n = new Set(expandedProps());
    const k = `${layerId}|${label}`;
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setExpandedProps(n);
  };
  /** PropRow "virtuel" mono-canal pour un axe (réutilise tous les handlers de propriété). */
  const axProp = (p: PropRow, ax: AxisRow): PropRow =>
    ({ label: `${p.label} ${ax.label}`, channels: [ax.channel], animated: ax.animated, frames: ax.frames, interps: ax.interps, axes: [] });

  // Contrainte de proportions (cadenas/chaîne AE) : éditer un axe applique le ratio aux autres.
  const [linkedProps, setLinkedProps] = createSignal<Set<string>>(new Set());
  const isPropLinked = (layerId: string, label: string): boolean => linkedProps().has(`${layerId}|${label}`);
  const togglePropLink = (layerId: string, label: string): void => {
    const n = new Set(linkedProps());
    const k = `${layerId}|${label}`;
    if (n.has(k)) n.delete(k);
    else n.add(k);
    setLinkedProps(n);
  };
  /** Édite un canal en gardant les proportions du groupe (ratio ; uniforme si l'ancienne valeur est 0). */
  const applyLinked = (layerId: string, channels: string[], edited: string, value: number): void => {
    const old = editor.readChannel(layerId, edited) ?? 0;
    const ratio = old !== 0 ? value / old : null;
    for (const ch of channels) {
      if (ch === edited) editor.setChannelValue(layerId, ch, value);
      else editor.setChannelValue(layerId, ch, ratio !== null ? (editor.readChannel(layerId, ch) ?? 0) * ratio : value);
    }
  };
  // Presse-papier de keyframes (offset relatif au 1er frame copié).
  let clipboard: { layerId: string; channels: string[]; offset: number; values: number[]; interp: Interp; cp?: readonly [number, number, number, number] }[] = [];

  let scroller: HTMLDivElement | undefined;
  let namesEl: HTMLDivElement | undefined;
  let lanesEl: HTMLDivElement | undefined;

  const timeToPx = (t: number): number => t * pps();
  const framesToPx = (n: number): number => timeToPx(clock.frameToTime(n));
  const contentWidth = (): number => Math.max(0, duration() * pps());
  const marks = (): number[] => {
    const secs = Math.max(0, Math.ceil(duration()));
    return Array.from({ length: secs + 1 }, (_, i) => i);
  };

  // ————————————————————————————— Tempo (grille BPM) —————————————————————————————
  const framesPerBeat = (): number => { const b = bpm(); return b > 0 ? (fps() * 60) / b : 0; };
  const beatPx = (): number => framesToPx(framesPerBeat());
  const barPx = (): number => beatPx() * beatsPerBar();
  /** Grille rythmique en fond (gradient CSS, zéro DOM) : ligne fine par battement, accent par mesure. */
  const gridBg = (): string | undefined => {
    const bp = beatPx();
    if (bp < 6) return undefined; // trop dense à ce zoom : masque la grille de battements
    return `repeating-linear-gradient(to right, var(--tl-beat) 0 1px, transparent 1px ${bp}px),`
      + `repeating-linear-gradient(to right, var(--tl-bar) 0 1px, transparent 1px ${barPx()}px)`;
  };
  /** Aimante un frame sur le battement le plus proche (si snap actif). */
  const snapFrame = (f: number): number => {
    if (!snapOn()) return Math.round(f);
    const fpb = framesPerBeat();
    if (fpb <= 0) return Math.round(f);
    return Math.round(Math.round(f / fpb) * fpb);
  };

  const clipGeo = (clip: Clip | undefined): { left: number; width: number } => {
    if (!clip) return { left: 0, width: contentWidth() };
    return { left: framesToPx(clip.in), width: framesToPx(clip.out - clip.in + 1) };
  };

  /** x écran → x local dans la zone des lanes (== règle). L'épinglage sticky est géré par le layout,
   *  donc le rect des lanes reflète déjà scroll horizontal + colonne de noms figée. */
  const contentX = (clientX: number): number =>
    lanesEl ? clientX - lanesEl.getBoundingClientRect().left : 0;

  const scrubTo = (clientX: number): void => {
    clock.seekFrame(clock.timeToFrame(contentX(clientX) / pps()));
  };

  /** Scrub : uniquement sur la règle temporelle (comme After Effects). */
  const onRulerDown = (e: PointerEvent): void => {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    target.classList.add("seq__ruler--scrubbing");
    scrubTo(e.clientX);
    const move = (ev: PointerEvent): void => scrubTo(ev.clientX);
    const up = (ev: PointerEvent): void => {
      target.releasePointerCapture(ev.pointerId);
      target.classList.remove("seq__ruler--scrubbing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onWheel = (e: WheelEvent): void => {
    if (e.altKey) {
      e.preventDefault();
      setWaveZoom((z) => Math.max(1, Math.min(8, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
    } else if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setPps((p) => clampPps(p * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    } else if (scroller && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
      e.preventDefault();
      scroller.scrollLeft += e.shiftKey ? e.deltaY : e.deltaX;
    }
    // sinon : scroll vertical natif du conteneur unique (noms + lanes défilent ensemble)
  };

  const fit = (): void => {
    if (!scroller || duration() <= 0) return;
    const names = namesEl?.offsetWidth ?? 0;
    setPps(clampPps((scroller.clientWidth - names) / duration()));
  };

  onMount(() => requestAnimationFrame(fit));

  /** x écran → frame clampé (dans le contenu défilable). */
  const frameAt = (clientX: number): number =>
    Math.max(0, Math.min(clock.durationFrames, clock.timeToFrame(contentX(clientX) / pps())));

  // ————————————————————————————— Clips (barre) —————————————————————————————

  /** Aperçu de drag (façon Premiere) : le clip tiré s'affiche à sa géométrie en cours en
   *  opacité réduite ; le modèle n'est muté qu'au relâché. Aucun `_emit` pendant le geste
   *  → plus de recalcul de `rows()` ni de rebuild des waveforms à chaque `pointermove`. */
  type ClipDrag =
    | { mode: "simple"; layerId: string; clip: Clip }
    | { mode: "media"; layerId: string; clipId: string; mc: MediaClip };
  const [clipDrag, setClipDrag] = createSignal<ClipDrag | null>(null);
  const simpleClipView = (row: LayerRow): Clip | undefined => {
    const d = clipDrag();
    return d?.mode === "simple" && d.layerId === row.layerId ? d.clip : row.clip;
  };
  const mediaClipView = (row: LayerRow, mc: MediaClip): MediaClip => {
    const d = clipDrag();
    return d?.mode === "media" && d.layerId === row.layerId && d.clipId === mc.id ? d.mc : mc;
  };
  const isClipDragging = (layerId: string, clipId?: string): boolean => {
    const d = clipDrag();
    if (!d || d.layerId !== layerId) return false;
    return d.mode === "media" ? d.clipId === clipId : clipId === undefined;
  };

  const onClipMove = (e: PointerEvent, row: LayerRow): void => {
    e.stopPropagation();
    if (row.locked) return;
    editor.select(row.layerId);
    if (tlTool() === "razor") { editor.splitLayer(row.layerId, snapFrame(frameAt(e.clientX)), clock.durationFrames); return; }
    const dur = clock.durationFrames;
    const base: Clip = row.clip ?? { in: 0, out: dur };
    const startFrame = frameAt(e.clientX);
    let preview = base;
    const move = (ev: PointerEvent): void => {
      const rawIn = base.in + (frameAt(ev.clientX) - startFrame);
      preview = moveClip(base, snapFrame(rawIn) - base.in, dur);
      setClipDrag({ mode: "simple", layerId: row.layerId, clip: preview });
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setClipDrag(null);
      editor.setClip(row.layerId, preview);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onClipTrim = (e: PointerEvent, row: LayerRow, edge: "in" | "out"): void => {
    e.stopPropagation();
    if (row.locked) return;
    editor.select(row.layerId);
    const dur = clock.durationFrames;
    const base: Clip = row.clip ?? { in: 0, out: dur };
    let preview = base;
    const move = (ev: PointerEvent): void => {
      const f = snapFrame(frameAt(ev.clientX));
      preview = edge === "in" ? trimIn(base, f, dur) : trimOut(base, f, dur);
      setClipDrag({ mode: "simple", layerId: row.layerId, clip: preview });
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setClipDrag(null);
      editor.setClip(row.layerId, preview);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // ————————————————————————— Montage audio (MediaClip) —————————————————————————

  let clipSeq = 0;
  const [selectedClip, setSelectedClip] = createSignal<{ layerId: string; clipId: string } | null>(null);
  const isClipSelected = (layerId: string, clipId: string): boolean => {
    const s = selectedClip();
    return !!s && s.layerId === layerId && s.clipId === clipId;
  };
  /** Applique une liste de clips au calque selon son type (audio ou vidéo). */
  const setClips = (row: LayerRow, clips: MediaClip[]): void => {
    if (row.type === "audio") editor.setAudioClips(row.layerId, clips);
    else if (row.type === "video") editor.setVideoClips(row.layerId, clips);
  };
  /** Longueur de la source en frames (clamp des trims + fenêtrage waveform). Infini si vidéo non chargée. */
  const clipSourceFrames = (row: LayerRow): number => {
    if (row.type === "audio") return row.assetId ? Math.max(1, Math.round(audio.duration(row.assetId) * clock.fps)) : 1;
    if (row.type === "video") { const f = editor.videoDurationFrames(row.layerId, clock.fps); return f > 0 ? f : Number.MAX_SAFE_INTEGER; }
    return 1;
  };

  /** Découpe un clip média au frame donné (outil rasoir : clic sur le clip). */
  const splitClipAt = (row: LayerRow, mc: MediaClip, f: number): void => {
    const parts = splitMediaClip(mc, snapFrame(f), `${mc.id}.${++clipSeq}`);
    if (!parts) return;
    setClips(row, row.mediaClips.flatMap((c) => (c.id === mc.id ? parts : [c])));
    setSelectedClip({ layerId: row.layerId, clipId: parts[1].id });
  };

  const onMediaClipMove = (e: PointerEvent, row: LayerRow, mc: MediaClip): void => {
    e.stopPropagation();
    editor.select(row.layerId);
    setSelectedClip({ layerId: row.layerId, clipId: mc.id });
    if (row.locked) return;
    if (tlTool() === "razor") { splitClipAt(row, mc, frameAt(e.clientX)); return; }
    const start = frameAt(e.clientX);
    let preview = mc;
    const move = (ev: PointerEvent): void => {
      const raw = moveMediaClip(mc, frameAt(ev.clientX) - start);
      preview = { ...raw, timelineIn: Math.max(0, snapFrame(raw.timelineIn)) };
      setClipDrag({ mode: "media", layerId: row.layerId, clipId: mc.id, mc: preview });
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setClipDrag(null);
      setClips(row, row.mediaClips.map((c) => (c.id === mc.id ? preview : c)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onMediaClipTrim = (e: PointerEvent, row: LayerRow, mc: MediaClip, edge: "in" | "out"): void => {
    e.stopPropagation();
    editor.select(row.layerId);
    setSelectedClip({ layerId: row.layerId, clipId: mc.id });
    if (row.locked) return;
    const srcMax = clipSourceFrames(row);
    let preview = mc;
    const move = (ev: PointerEvent): void => {
      const f = snapFrame(frameAt(ev.clientX));
      let t = edge === "in" ? trimMediaIn(mc, f) : trimMediaOut(mc, f);
      if (edge === "out" && t.sourceOut > srcMax) t = { ...t, sourceOut: srcMax };
      preview = t;
      setClipDrag({ mode: "media", layerId: row.layerId, clipId: mc.id, mc: preview });
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setClipDrag(null);
      setClips(row, row.mediaClips.map((c) => (c.id === mc.id ? preview : c)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Coupe le clip audio sélectionné au playhead (rasoir façon Premiere / ⌘K). */
  /** Coupe au playhead (⌘K) : le clip média sélectionné, sinon le calque sélectionné (Split Layer). */
  const splitSelectedClip = (): void => {
    const s = selectedClip();
    if (s) {
      const row = rows().find((r) => r.layerId === s.layerId);
      const mc = row?.mediaClips.find((c) => c.id === s.clipId);
      if (!row || !mc) return;
      const parts = splitMediaClip(mc, frame(), `${mc.id}.${++clipSeq}`);
      if (!parts) return;
      setClips(row, row.mediaClips.flatMap((c) => (c.id === mc.id ? parts : [c])));
      setSelectedClip({ layerId: row.layerId, clipId: parts[0].id });
      return;
    }
    const id = selectedId();
    if (id) editor.splitLayer(id, frame(), clock.durationFrames);
  };

  const deleteSelectedClip = (): boolean => {
    const s = selectedClip();
    if (!s) return false;
    const row = rows().find((r) => r.layerId === s.layerId);
    if (!row) return false;
    setClips(row,row.mediaClips.filter((c) => c.id !== s.clipId));
    setSelectedClip(null);
    return true;
  };

  /** Glisser une poignée de fondu (coin haut du clip) horizontalement → durée du fondu in/out. */
  const onFadeDrag = (e: PointerEvent, row: LayerRow, mc: MediaClip, edge: "in" | "out"): void => {
    e.stopPropagation();
    setSelectedClip({ layerId: row.layerId, clipId: mc.id });
    if (row.locked) return;
    const len = mediaClipLength(mc);
    const out = mediaClipTimelineOut(mc);
    let preview = mc;
    const setFade = (clientX: number): void => {
      const f = frameAt(clientX);
      const dur = edge === "in"
        ? Math.max(0, Math.min(len, Math.round(f - mc.timelineIn)))
        : Math.max(0, Math.min(len, Math.round(out - f)));
      preview = { ...mc, ...(edge === "in" ? { fadeIn: dur } : { fadeOut: dur }) };
      setClipDrag({ mode: "media", layerId: row.layerId, clipId: mc.id, mc: preview });
    };
    setFade(e.clientX);
    const move = (ev: PointerEvent): void => setFade(ev.clientX);
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setClipDrag(null);
      setClips(row, row.mediaClips.map((c) => (c.id === mc.id ? preview : c)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Rubber-band de volume : glisser la ligne de gain verticalement (haut = fort, bas = 0). */
  const onGainDrag = (e: PointerEvent, row: LayerRow): void => {
    e.stopPropagation();
    if (row.locked) return;
    const bar = (e.currentTarget as HTMLElement).parentElement;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const setFromY = (clientY: number): void => {
      const t = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      editor.setAudioGain(row.layerId, Number((GAIN_MAX * (1 - t)).toFixed(2)));
    };
    setFromY(e.clientY);
    const move = (ev: PointerEvent): void => setFromY(ev.clientY);
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // —————————————————————————— Réordonnancement (z) ——————————————————————————

  const [dropTarget, setDropTarget] = createSignal<{ id: string; pos: "before" | "after" } | null>(null);
  const DND_TYPE = "application/x-led-layer-id";

  const onNameDragStart = (e: DragEvent, id: string): void => {
    e.dataTransfer?.setData(DND_TYPE, id);
    if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
  };
  const onNameDragOver = (e: DragEvent, id: string): void => {
    if (!e.dataTransfer?.types.includes(DND_TYPE)) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setDropTarget({ id, pos: e.clientY - rect.top < rect.height / 2 ? "before" : "after" });
    e.dataTransfer.dropEffect = "move";
  };
  const onNameDrop = (e: DragEvent, id: string): void => {
    e.preventDefault();
    const pos = dropTarget()?.pos ?? "before";
    setDropTarget(null);
    const dragged = e.dataTransfer?.getData(DND_TYPE);
    if (dragged && dragged !== id) editor.moveLayer(dragged, id, pos);
  };

  // ————————————————————————— Keying depuis la timeline —————————————————————————

  const addKeyGroup = (layerId: string, channels: string[], frame: number): void => {
    for (const c of channels) editor.addKeyframeAt(layerId, c, frame);
  };
  const removeKeyGroup = (layerId: string, channels: string[], frame: number): void => {
    for (const c of channels) editor.removeKeyframe(layerId, c, frame);
  };
  const moveKeyGroup = (layerId: string, channels: string[], from: number, to: number): void => {
    for (const c of channels) editor.moveKeyframe(layerId, c, from, to);
  };

  /** Chronomètre (stopwatch AE) : active/désactive l'animation d'une propriété (l'éteindre supprime toutes ses clés). */
  const onStopwatch = (e: MouseEvent, row: LayerRow, p: PropRow): void => {
    e.stopPropagation();
    if (row.locked) return;
    editor.toggleAnimated(row.layerId, p.channels);
  };

  /** Navigateur de keyframe (◄ ◆ ►) : ajoute/retire UNE clé au frame courant, ou saute clé à clé. */
  const toggleKeyHere = (e: MouseEvent, row: LayerRow, p: PropRow): void => {
    e.stopPropagation();
    const f = frame();
    if (p.frames.includes(f)) removeKeyGroup(row.layerId, p.channels, f);
    else addKeyGroup(row.layerId, p.channels, f);
  };
  const gotoPrevKey = (e: MouseEvent, p: PropRow): void => {
    e.stopPropagation();
    const prev = p.frames.filter((x) => x < frame()).pop();
    if (prev !== undefined) clock.seekFrame(prev);
  };
  const gotoNextKey = (e: MouseEvent, p: PropRow): void => {
    e.stopPropagation();
    const next = p.frames.find((x) => x > frame());
    if (next !== undefined) clock.seekFrame(next);
  };

  /** Diamant (clé agrégée) : sélection (shift = multi) + glisser le groupe sélectionné. */
  const onKfDown = (e: PointerEvent, row: LayerRow, p: PropRow, f: number): void => {
    e.stopPropagation();
    if (row.locked) return;
    const key: SelKey = { layerId: row.layerId, frame: f, channels: p.channels };
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    let sel = selection();
    const already = sel.some((s) => sameKey(s, key));
    if (additive) {
      setSelection(already ? sel.filter((s) => !sameKey(s, key)) : [...sel, key]);
      return; // shift-clic = (dé)sélectionne, pas de glisser
    }
    if (!already) { sel = [key]; setSelection(sel); }
    // glisser groupé : décale toutes les clés sélectionnées du même delta
    const startFrame = frameAt(e.clientX);
    const origin = sel.map((s) => ({ ...s }));
    const cur = origin.map((s) => s.frame);
    const move = (ev: PointerEvent): void => {
      const delta = frameAt(ev.clientX) - startFrame;
      let changed = false;
      origin.forEach((s, i) => {
        const target = Math.max(0, Math.min(clock.durationFrames, s.frame + delta));
        if (target !== cur[i]) { moveKeyGroup(s.layerId, s.channels, cur[i], target); cur[i] = target; changed = true; }
      });
      if (changed) setSelection(origin.map((s, i) => ({ ...s, frame: cur[i] })));
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Double-clic sur un diamant : éditer sa valeur (façon After Effects). */
  const onKfDblClick = (e: MouseEvent, row: LayerRow, p: PropRow, _f: number): void => {
    e.stopPropagation();
    toggleCurvesExpand(row.layerId, p.label);
  };

  /** Clic-droit sur un diamant : menu d'interpolation. */
  const onKfContext = (e: MouseEvent, row: LayerRow, p: PropRow, f: number): void => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ layerId: row.layerId, channels: p.channels, frame: f, x: e.clientX, y: e.clientY });
  };
  const applyInterp = (interp: Interp): void => {
    const m = ctxMenu();
    if (m) for (const ch of m.channels) editor.setKeyframeInterp(m.layerId, ch, m.frame, interp);
    setCtxMenu(null);
  };

  // —————————————————————————— Copier / coller de clés ——————————————————————————

  const copyKeys = (): void => {
    const sel = selection();
    if (!sel.length) return;
    const minFrame = Math.min(...sel.map((s) => s.frame));
    clipboard = sel.map((s) => ({
      layerId: s.layerId,
      channels: s.channels,
      offset: s.frame - minFrame,
      values: s.channels.map((ch) => editor.keyframeValue(s.layerId, ch, s.frame) ?? 0),
      interp: editor.keyframeInterp(s.layerId, s.channels[0], s.frame) ?? "linear",
      cp: editor.keyframeCP(s.layerId, s.channels[0], s.frame),
    }));
  };
  const pasteKeys = (): void => {
    if (!clipboard.length) return;
    const base = frame();
    const pasted: SelKey[] = [];
    for (const c of clipboard) {
      const target = Math.max(0, Math.min(clock.durationFrames, base + c.offset));
      c.channels.forEach((ch, i) => editor.putKeyframe(c.layerId, ch, target, c.values[i], c.interp, c.cp));
      pasted.push({ layerId: c.layerId, frame: target, channels: c.channels });
    }
    setSelection(pasted);
  };

  // ————————————————————————— Raccourcis clavier (AE) —————————————————————————

  const allKeyframes = (): number[] => [...new Set(rows().flatMap((r) => r.keyframes))].sort((a, b) => a - b);
  const jumpKeyframe = (dir: 1 | -1): void => {
    const fs = allKeyframes();
    const f = frame();
    const target = dir > 0 ? fs.find((x) => x > f) : [...fs].reverse().find((x) => x < f);
    if (target !== undefined) clock.seekFrame(target);
  };
  const deleteSelection = (): void => {
    for (const s of selection()) removeKeyGroup(s.layerId, s.channels, s.frame);
    setSelection([]);
  };
  const isTyping = (): boolean => {
    const el = document.activeElement as HTMLElement | null;
    return !!el && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el.isContentEditable);
  };
  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") { if (ctxMenu()) setCtxMenu(null); return; }
    if (isTyping()) return;
    if (e.key === "ArrowRight") { e.preventDefault(); if (e.shiftKey) jumpKeyframe(1); else clock.stepFrame(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); if (e.shiftKey) jumpKeyframe(-1); else clock.stepFrame(-1); }
    else if (e.key === "Home") { e.preventDefault(); clock.goToStart(); }
    else if (e.key === "End") { e.preventDefault(); clock.goToEnd(); }
    else if (e.key === "Delete" || e.key === "Backspace") {
      if (deleteSelectedClip()) e.preventDefault();
      else if (selection().length) { e.preventDefault(); deleteSelection(); }
    }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); splitSelectedClip(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") { copyKeys(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") { e.preventDefault(); pasteKeys(); }
    else if (e.key.toLowerCase() === "v") { setTlTool("select"); }   // outils du rail (façon NLE)
    else if (e.key.toLowerCase() === "c") { setTlTool("razor"); }
    else if (e.key.toLowerCase() === "h") { setTlTool("hand"); }
  };
  onMount(() => window.addEventListener("keydown", onKeyDown));
  onCleanup(() => window.removeEventListener("keydown", onKeyDown));

  /** Double-clic sur la lane d'une propriété animée : poser une clé (tous canaux) au frame cliqué. */
  const onPropLaneDblClick = (e: MouseEvent, row: LayerRow, p: PropRow): void => {
    addKeyGroup(row.layerId, p.channels, frameAt(e.clientX));
  };

  // ————————————————————— Sélection multiple (marquee) —————————————————————

  const [marquee, setMarquee] = createSignal<{ left: number; top: number; width: number; height: number } | null>(null);

  const onLanesDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !lanesEl) return; // la cible est le fond des lanes (diamants/clips stoppent la propagation)
    if (tlTool() === "hand" && scroller) { // outil main : glisser pour défiler
      const sx = e.clientX, sy = e.clientY, sl = scroller.scrollLeft, st = scroller.scrollTop;
      const move = (ev: PointerEvent): void => { scroller!.scrollLeft = sl - (ev.clientX - sx); scroller!.scrollTop = st - (ev.clientY - sy); };
      const up = (): void => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    const startX = e.clientX;
    const startY = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent): void => {
      if (!lanesEl) return;
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 3) moved = true;
      const r = lanesEl.getBoundingClientRect();
      setMarquee({
        left: Math.min(startX, ev.clientX) - r.left,
        top: Math.min(startY, ev.clientY) - r.top,
        width: Math.abs(ev.clientX - startX),
        height: Math.abs(ev.clientY - startY),
      });
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setMarquee(null);
      if (!moved) { setSelection([]); return; } // clic simple sur le vide → désélectionne
      const box = {
        l: Math.min(startX, ev.clientX), t: Math.min(startY, ev.clientY),
        r: Math.max(startX, ev.clientX), b: Math.max(startY, ev.clientY),
      };
      const picked: SelKey[] = [];
      lanesEl?.querySelectorAll<HTMLElement>(".seq__kf[data-frame]").forEach((d) => {
        const dr = d.getBoundingClientRect();
        const cx = dr.left + dr.width / 2;
        const cy = dr.top + dr.height / 2;
        if (cx >= box.l && cx <= box.r && cy >= box.t && cy <= box.b) {
          picked.push({ layerId: d.dataset.layer ?? "", frame: Number(d.dataset.frame), channels: (d.dataset.channels ?? "").split(",") });
        }
      });
      setSelection(picked);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Contrôles d'une propriété (chrono + navigateur) — réutilisé pour l'agrégat ET chaque axe.
  const propCtl = (row: LayerRow, p: PropRow): JSX.Element => (
    <div class="seq__prop-ctl">
      <button
        type="button"
        class="seq__stopwatch"
        classList={{ "seq__stopwatch--on": p.animated }}
        data-tooltip={p.animated ? "Ne plus animer (supprime les clés)" : "Animer (chrono)"}
        onClick={(e) => onStopwatch(e, row, p)}
      >
        {createIcon("stopwatch", { size: 15 })}
      </button>
      <Show when={p.animated}>
        <span class="seq__kf-nav">
          <button type="button" class="seq__kf-nav-arrow seq__kf-nav-arrow--prev" data-tooltip="Clé précédente" onClick={(e) => gotoPrevKey(e, p)} />
          <button
            type="button"
            class="seq__kf-nav-dot"
            classList={{ "seq__kf-nav-dot--on": p.frames.includes(frame()) }}
            data-tooltip="Ajouter / retirer une clé (frame courant)"
            onClick={(e) => toggleKeyHere(e, row, p)}
          />
          <button type="button" class="seq__kf-nav-arrow seq__kf-nav-arrow--next" data-tooltip="Clé suivante" onClick={(e) => gotoNextKey(e, p)} />
        </span>
      </Show>
    </div>
  );

  // Contenu d'une lane de propriété (liaisons + diamants) — réutilisé pour l'agrégat ET chaque axe.
  const kfLane = (row: LayerRow, p: PropRow): JSX.Element => (
    <>
      <For each={p.frames.slice(0, -1)}>
        {(f, i) => (
          <div class="seq__kf-link" style={{ left: `${framesToPx(f)}px`, width: `${framesToPx(p.frames[i() + 1] - f)}px` }} />
        )}
      </For>
      <For each={p.frames}>
        {(f, i) => (
          <div
            class="seq__kf"
            classList={{
              "seq__kf--selected": isSelected(row.layerId, f, p.channels),
              "seq__kf--hold": p.interps[i()] === "hold",
              "seq__kf--bezier": p.interps[i()] === "bezier",
              "seq__kf--ease-in": p.interps[i()] === "ease-in",
              "seq__kf--ease-out": p.interps[i()] === "ease-out",
            }}
            style={{ left: `${framesToPx(f)}px` }}
            data-layer={row.layerId}
            data-frame={f}
            data-channels={p.channels.join(",")}
            onPointerDown={(e) => onKfDown(e, row, p, f)}
            onDblClick={(e) => onKfDblClick(e, row, p, f)}
            onContextMenu={(e) => onKfContext(e, row, p, f)}
          />
        )}
      </For>
    </>
  );

  // Valeur éditable d'une propriété : mono-canal (opacité/param/axe) → 1 champ ; multi-canal LIÉ → 1 champ
  // partagé qui édite tous les axes proportionnellement (façon cadenas Échelle AE).
  const propValue = (row: LayerRow, p: PropRow): JSX.Element => (
    <Show when={p.channels.length === 1 || isPropLinked(row.layerId, p.label)}>
      <NumberField
        class="seq__val"
        value={(frame(), version(), editor.readChannel(row.layerId, p.channels[0]) ?? 0)}
        step={0.01}
        onInput={(v) =>
          p.channels.length === 1
            ? editor.setChannelValue(row.layerId, p.channels[0], v)
            : applyLinked(row.layerId, p.channels, p.channels[0], v)
        }
      />
    </Show>
  );

  // Valeur éditable d'un axe séparé : contraint les autres axes si la propriété est liée.
  const axisValue = (row: LayerRow, p: PropRow, ax: AxisRow): JSX.Element => (
    <NumberField
      class="seq__val"
      value={(frame(), version(), editor.readChannel(row.layerId, ax.channel) ?? 0)}
      step={0.01}
      onInput={(v) =>
        isPropLinked(row.layerId, p.label)
          ? applyLinked(row.layerId, p.channels, ax.channel, v)
          : editor.setChannelValue(row.layerId, ax.channel, v)
      }
    />
  );

  const toolBtn = (tool: "select" | "razor" | "hand", icon: string, tip: string): JSX.Element => (
    <button
      type="button"
      class="seq__tool"
      classList={{ "seq__tool--on": tlTool() === tool }}
      data-tooltip={tip}
      onClick={() => setTlTool(tool)}
    >
      {createIcon(icon, { size: 16 })}
    </button>
  );

  return (
    <div class="seq" style={{ "--tl-row": `calc(var(--lane) * ${rowScale()})` }}>
      <div class="seq__tools">
        {toolBtn("select", "cursor", "Sélection (V)")}
        {toolBtn("razor", "razor", "Rasoir — cliquer un clip pour le couper (C)")}
        {toolBtn("hand", "hand", "Main — glisser pour défiler (H)")}
        <div class="seq__tools-sep" />
        <button type="button" class="seq__tool" data-tooltip="Importer une piste audio" onClick={importAudio}>
          {createIcon("waveform", { size: 16 })}
        </button>
        <button type="button" class="seq__tool" data-tooltip="Importer une vidéo (diffusée sur le mur)" onClick={importVideo}>
          {createIcon("film", { size: 16 })}
        </button>
      </div>
      <div class="seq__main">
      <div class="seq__topbar">
        <div class="seq__topbar-names">Pistes</div>
        <div class="seq__topbar-main">
          <span class="seq-meta">Durée {duration().toFixed(2)} s · {fps()} FPS</span>
          <span class="seq__topbar-actions">
            <label class="seq__tempo" data-tooltip="Tempo — grille rythmique (BPM)">
              <span class="seq__tempo-label">BPM</span>
              <NumberField class="seq__tempo-field" value={bpm()} step={1} format={(n) => String(Math.round(n))} onInput={(v) => clock.setBpm(Math.round(v))} />
            </label>
            <span class="seq__zoomers">
              <span class="seq__zoomer" data-tooltip="Zoom horizontal (durée)">
                {createIcon("sliders", { size: 13 })}
                <input class="seq__range" type="range" min="0" max="1" step="0.001" value={ppsToT(pps())} onInput={(e) => setPps(tToPps(+e.currentTarget.value))} />
              </span>
              <span class="seq__zoomer seq__zoomer--v" data-tooltip="Zoom vertical (hauteur des pistes)">
                {createIcon("layers", { size: 13 })}
                <input class="seq__range" type="range" min={ROW_SCALE_MIN} max={ROW_SCALE_MAX} step="0.05" value={rowScale()} onInput={(e) => setRowScale(+e.currentTarget.value)} />
              </span>
            </span>
            <label class="seq__switch" data-tooltip="Aimanter clips et rognages sur la grille (BPM)">
              <input type="checkbox" class="seq__switch-input" checked={snapOn()} onChange={(e) => setSnapOn(e.currentTarget.checked)} />
              <span class="seq__switch-track"><span class="seq__switch-thumb" /></span>
              <span class="seq__switch-label">Snap</span>
            </label>
            <button type="button" class="seq__zoom-btn" data-tooltip="Ajuster à la fenêtre" onClick={fit}>Ajuster</button>
          </span>
        </div>
      </div>
      <div class="seq__scroll" ref={scroller} onWheel={onWheel}>
        <div class="seq__grid" style={{ "grid-template-columns": `var(--tl-names) minmax(${contentWidth()}px, 1fr)` }}>
          <div class="seq__names" ref={namesEl}>
            <div class="seq__corner" />
            <Show when={rows().length > 0} fallback={<div class="seq__names-empty">Groupe vide</div>}>
              <Show when={audioRows().length === 0}>
                <div class="seq__section seq__section--names">Audio</div>
                <div class="seq__name seq__name--empty">A1 · piste audio vide</div>
              </Show>
              <For each={sortedRows()}>
                {(row, i) => (
                  <>
                    <Show when={sectionBefore(i())}>
                      {(label) => <div class="seq__section seq__section--names">{label()}</div>}
                    </Show>
                    <div
                      class="seq__name"
                      classList={{
                        "seq__name--selected": selectedId() === row.layerId,
                        "seq__name--locked": row.locked,
                        "seq__name--drop-before": dropTarget()?.id === row.layerId && dropTarget()?.pos === "before",
                        "seq__name--drop-after": dropTarget()?.id === row.layerId && dropTarget()?.pos === "after",
                      }}
                      draggable={!row.locked}
                      onDragStart={(e) => onNameDragStart(e, row.layerId)}
                      onDragOver={(e) => onNameDragOver(e, row.layerId)}
                      onDragLeave={() => setDropTarget(null)}
                      onDrop={(e) => onNameDrop(e, row.layerId)}
                      onClick={() => editor.select(row.layerId)}
                      onDblClick={() => { if (row.type === "precomp") editor.enterCompOf(row.layerId); }}
                    >
                      <button
                        type="button"
                        class="seq__label-chip"
                        classList={{ "seq__label-chip--set": !!row.label }}
                        style={row.label ? { background: row.label } : undefined}
                        data-tooltip="Couleur de label"
                        onClick={(e) => { e.stopPropagation(); setLabelPalette({ layerId: row.layerId, x: e.clientX, y: e.clientY }); }}
                      />
                      <button
                        type="button"
                        class="seq__twirl"
                        classList={{ "seq__twirl--open": isExpanded(row.layerId) }}
                        aria-label={isExpanded(row.layerId) ? "Replier" : "Déplier"}
                        onClick={(e) => { e.stopPropagation(); toggleExpand(row.layerId); }}
                      />
                      <span class="seq__name-label">{row.name}</span>
                      <Show
                        when={row.type === "audio"}
                        fallback={
                          <>
                            <button
                              type="button"
                              class="seq__eye"
                              classList={{ "seq__eye--off": !row.visible }}
                              data-tooltip={row.visible ? "Masquer" : "Afficher"}
                              onClick={(e) => { e.stopPropagation(); editor.setVisible(row.layerId, !row.visible); }}
                            >{createIcon(row.visible ? "eye" : "eye-off", { size: 13 })}</button>
                            <button
                              type="button"
                              class="seq__solo"
                              classList={{ "seq__solo--on": row.solo }}
                              data-tooltip="Solo (n'affiche que les calques en solo)"
                              onClick={(e) => { e.stopPropagation(); editor.setSolo(row.layerId, !row.solo); }}
                            >S</button>
                          </>
                        }
                      >
                        <button
                          type="button"
                          class="seq__mute"
                          classList={{ "seq__mute--on": !row.visible }}
                          data-tooltip={row.visible ? "Muter la piste" : "Réactiver la piste"}
                          onClick={(e) => { e.stopPropagation(); editor.setVisible(row.layerId, !row.visible); }}
                        >M</button>
                        <button
                          type="button"
                          class="seq__solo"
                          classList={{ "seq__solo--on": row.solo }}
                          data-tooltip="Solo audio (n'entend que les pistes en solo)"
                          onClick={(e) => { e.stopPropagation(); editor.setSolo(row.layerId, !row.solo); }}
                        >S</button>
                      </Show>
                      <button
                        type="button"
                        class="seq__lock"
                        classList={{ "seq__lock--on": row.locked }}
                        data-tooltip={row.locked ? "Déverrouiller" : "Verrouiller"}
                        onClick={(e) => { e.stopPropagation(); editor.setLocked(row.layerId, !row.locked); }}
                      >{createIcon("lock", { size: 12 })}</button>
                      <button
                        type="button"
                        class="seq__delete"
                        data-tooltip="Supprimer definitivement ce calque"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Supprimer "${row.name}" definitivement ? (pas juste le masquer)`)) editor.deleteLayer(row.layerId);
                        }}
                      >{createIcon("trash", { size: 12 })}</button>
                    </div>
                    <Show when={isExpanded(row.layerId)}>
                      <For each={row.props}>
                        {(p) => (
                          <>
                            <div class="seq__name seq__name--child" onClick={() => toggleCurvesExpand(row.layerId, p.label)} style={{ cursor: "pointer" }}>
                              {propCtl(row, p)}
                              <Show when={p.axes.length > 0}>
                                <button
                                  type="button"
                                  class="seq__subtwirl"
                                  classList={{ "seq__subtwirl--open": isPropExpanded(row.layerId, p.label) }}
                                  data-tooltip={isPropExpanded(row.layerId, p.label) ? "Lier les dimensions" : "Séparer les dimensions"}
                                  onClick={(e) => { e.stopPropagation(); togglePropExpand(row.layerId, p.label); }}
                                />
                                <button
                                  type="button"
                                  class="seq__link"
                                  classList={{ "seq__link--on": isPropLinked(row.layerId, p.label) }}
                                  data-tooltip="Contraindre les proportions (X/Y/Z liés)"
                                  onClick={(e) => { e.stopPropagation(); togglePropLink(row.layerId, p.label); }}
                                >{createIcon("link", { size: 12 })}</button>
                              </Show>
                              <span class="seq__name-label">{p.label}</span>
                              <div onClick={(e) => e.stopPropagation()}>
                                {propValue(row, p)}
                              </div>
                              <button
                                type="button"
                                class="seq__curves-toggle-btn"
                                classList={{ "seq__curves-toggle-btn--on": isCurvesExpanded(row.layerId, p.label) }}
                                data-tooltip="Afficher l'éditeur de courbe"
                                onClick={(e) => { e.stopPropagation(); toggleCurvesExpand(row.layerId, p.label); }}
                              >
                                {createIcon("graph", { size: 12 })}
                              </button>
                            </div>
                            <Show when={isCurvesExpanded(row.layerId, p.label)}>
                              <div class="seq__name seq__name--curves">
                                <div class="seq__curves-header">
                                  <div class="seq__curves-header-controls">
                                    <div class="seq__curves-ctrl-group">
                                      <button
                                        type="button"
                                        class="seq__curves-ctrl-btn"
                                        classList={{ "seq__curves-ctrl-btn--active": getGraphType(row.layerId, p.label) === "value" }}
                                        onClick={() => setGraphType(row.layerId, p.label, "value")}
                                      >
                                        Val
                                      </button>
                                      <button
                                        type="button"
                                        class="seq__curves-ctrl-btn"
                                        classList={{ "seq__curves-ctrl-btn--active": getGraphType(row.layerId, p.label) === "velocity" }}
                                        onClick={() => setGraphType(row.layerId, p.label, "velocity")}
                                      >
                                        Vit
                                      </button>
                                    </div>

                                    <Show when={p.channels.length > 1}>
                                      <div class="seq__curves-ctrl-group">
                                        <For each={p.channels}>
                                          {(ch, idx) => (
                                            <button
                                              type="button"
                                              class="seq__curves-ctrl-btn"
                                              style={{ "--axis-color": ["#ff5a5a", "#7fd88a", "#5a9bff", "#ffd24a"][idx()] }}
                                              classList={{ "seq__curves-ctrl-btn--active": getCurveAxis(row.layerId, p.label) === idx() }}
                                              onClick={() => setCurveAxis(row.layerId, p.label, idx())}
                                            >
                                              {channelShort(ch) || `Ch ${idx() + 1}`}
                                            </button>
                                          )}
                                        </For>
                                      </div>
                                    </Show>
                                  </div>
                                  <div class="seq__curves-presets">
                                    <button type="button" class="seq__preset-mini-btn" data-tooltip="Linéaire" onClick={() => applyPresetToSelected(row.layerId, p, "linear")}>Lin</button>
                                    <button type="button" class="seq__preset-mini-btn" data-tooltip="Ease" onClick={() => applyPresetToSelected(row.layerId, p, "bezier-ease")}>Ease</button>
                                    <button type="button" class="seq__preset-mini-btn" data-tooltip="Hold" onClick={() => applyPresetToSelected(row.layerId, p, "hold")}>Hold</button>
                                  </div>
                                </div>
                              </div>
                            </Show>
                            <Show when={p.axes.length > 0 && isPropExpanded(row.layerId, p.label)}>
                              <For each={p.axes}>
                                {(ax) => (
                                  <div class="seq__name seq__name--axis">
                                    {propCtl(row, axProp(p, ax))}
                                    <span class="seq__name-label">{p.label} {ax.label}</span>
                                    {axisValue(row, p, ax)}
                                  </div>
                                )}
                              </For>
                            </Show>
                          </>
                        )}
                      </For>
                    </Show>
                  </>
                )}
              </For>
          </Show>
          </div>
          <div class="seq__timeline">
              <div class="seq__ruler" style={{ "background-image": gridBg() }} onPointerDown={onRulerDown}>
                <For each={marks()}>
                  {(s) => (
                    <div class="seq__mark" style={{ left: `${timeToPx(s)}px` }}>
                      <span class="seq__mark-label">{s}s</span>
                    </div>
                  )}
                </For>
              </div>
              <div
                class="seq__lanes"
                classList={{ "seq__lanes--razor": tlTool() === "razor", "seq__lanes--hand": tlTool() === "hand" }}
                ref={lanesEl}
                style={{ "background-image": gridBg() }}
                onPointerDown={onLanesDown}
              >
                <Show when={audioRows().length === 0}>
                  <div class="seq__section seq__section--lane" />
                  <div class="seq__lane seq__lane--empty" />
                </Show>
                <For each={sortedRows()}>
                  {(row, i) => (
                    <>
                      <Show when={sectionBefore(i())}>
                        <div class="seq__section seq__section--lane" />
                      </Show>
                      <div class="seq__lane">
                        <Show
                          when={(row.type === "audio" || row.type === "video") && row.mediaClips.length > 0}
                          fallback={
                            <div
                              class="seq__bar seq__clip"
                              classList={{
                                "seq__clip--full": !row.clip,
                                "seq__clip--selected": selectedId() === row.layerId,
                                "seq__clip--dragging": isClipDragging(row.layerId),
                              }}
                              style={{ left: `${clipGeo(simpleClipView(row)).left}px`, width: `${clipGeo(simpleClipView(row)).width}px` }}
                              onPointerDown={(e) => onClipMove(e, row)}
                            >
                              <div class="seq__clip-handle seq__clip-handle--l" onPointerDown={(e) => onClipTrim(e, row, "in")} />
                              <div class="seq__clip-handle seq__clip-handle--r" onPointerDown={(e) => onClipTrim(e, row, "out")} />
                            </div>
                          }
                        >
                          <For each={row.mediaClips}>
                            {(mc) => {
                              const v = (): MediaClip => mediaClipView(row, mc); // géométrie affichée (preview de drag ou modèle)
                              return (
                              <div
                                class="seq__bar seq__clip"
                                classList={{
                                  "seq__clip--audio": row.type === "audio",
                                  "seq__clip--video": row.type === "video",
                                  "seq__clip--selected": isClipSelected(row.layerId, mc.id),
                                  "seq__clip--dragging": isClipDragging(row.layerId, mc.id),
                                }}
                                style={{ left: `${framesToPx(v().timelineIn)}px`, width: `${framesToPx(mediaClipLength(v()))}px` }}
                                onPointerDown={(e) => onMediaClipMove(e, row, mc)}
                              >
                                <Show when={row.type === "audio"}>
                                  <AudioWave
                                    audio={audio}
                                    assetId={row.assetId!}
                                    width={framesToPx(mediaClipLength(v()))}
                                    sourceIn={v().sourceIn}
                                    sourceOut={v().sourceOut}
                                    sourceFrames={clipSourceFrames(row)}
                                    zoom={waveZoom()}
                                    version={audioVersion()}
                                  />
                                  <div
                                    class="seq__gain-line"
                                    style={{ top: `${(1 - Math.min(row.gain, GAIN_MAX) / GAIN_MAX) * 100}%` }}
                                    data-tooltip={`Volume ${row.gain.toFixed(2)}`}
                                    onPointerDown={(e) => onGainDrag(e, row)}
                                  />
                                </Show>
                                <Show when={row.type === "video"}>
                                  <span class="seq__clip-label">{row.name}</span>
                                </Show>
                                <Show when={(v().fadeIn ?? 0) > 0}>
                                  <div class="seq__fade seq__fade--in" style={{ width: `${framesToPx(v().fadeIn!)}px` }} />
                                </Show>
                                <Show when={(v().fadeOut ?? 0) > 0}>
                                  <div class="seq__fade seq__fade--out" style={{ width: `${framesToPx(v().fadeOut!)}px` }} />
                                </Show>
                                <div class="seq__fade-handle seq__fade-handle--in" style={{ left: `${framesToPx(v().fadeIn ?? 0)}px` }} data-tooltip="Fondu d'entrée" onPointerDown={(e) => onFadeDrag(e, row, mc, "in")} />
                                <div class="seq__fade-handle seq__fade-handle--out" style={{ right: `${framesToPx(v().fadeOut ?? 0)}px` }} data-tooltip="Fondu de sortie" onPointerDown={(e) => onFadeDrag(e, row, mc, "out")} />
                                <div class="seq__clip-handle seq__clip-handle--l" onPointerDown={(e) => onMediaClipTrim(e, row, mc, "in")} />
                                <div class="seq__clip-handle seq__clip-handle--r" onPointerDown={(e) => onMediaClipTrim(e, row, mc, "out")} />
                              </div>
                              );
                            }}
                          </For>
                        </Show>
                        {/* aperçu de densité des keyframes du calque (replié), façon After Effects */}
                        <Show when={!isExpanded(row.layerId)}>
                          <For each={row.keyframes}>
                            {(f) => <div class="seq__kf seq__kf--summary" style={{ left: `${framesToPx(f)}px` }} />}
                          </For>
                        </Show>
                      </div>
                      <Show when={isExpanded(row.layerId)}>
                        <For each={row.props}>
                          {(p) => (
                            <>
                              <div class="seq__lane seq__lane--child" onDblClick={(e) => onPropLaneDblClick(e, row, p)}>
                                {kfLane(row, p)}
                              </div>
                              <Show when={isCurvesExpanded(row.layerId, p.label)}>
                                <div class="seq__lane seq__lane--curves" style={{ height: "120px", position: "relative" }}>
                                  <svg
                                    width={framesToPx(clock.durationFrames)}
                                    height="120"
                                    class="seq__curves-svg"
                                    style={{ overflow: "visible" }}
                                  >
                                    {/* Horizontal grid lines */}
                                    <line x1="0" y1="10" x2={framesToPx(clock.durationFrames)} y2="10" stroke="var(--line)" opacity="0.3" />
                                    <line x1="0" y1="60" x2={framesToPx(clock.durationFrames)} y2="60" stroke="var(--line)" opacity="0.3" />
                                    <line x1="0" y1="110" x2={framesToPx(clock.durationFrames)} y2="110" stroke="var(--line)" opacity="0.3" />
                                    
                                    {/* Curve path rendering */}
                                    <For each={p.channels}>
                                      {(ch, idx) => {
                                        const bounds = trackBounds(row.layerId, p);
                                        const color = ["#ff5a5a", "#7fd88a", "#5a9bff", "#ffd24a"][idx() % 4];
                                        const isSelectedAxis = () => getCurveAxis(row.layerId, p.label) === idx();
                                        const mode = () => getGraphType(row.layerId, p.label);
                                        return (
                                          <>
                                            {/* Value Path */}
                                            <path
                                              d={getFullValuePath(row.layerId, ch, bounds)}
                                              fill="none"
                                              stroke={color}
                                              stroke-width={mode() === "value" && isSelectedAxis() ? 2.5 : 1.2}
                                              stroke-dasharray={mode() === "velocity" ? "1,3" : undefined}
                                              opacity={mode() === "value" ? (isSelectedAxis() ? 1.0 : 0.4) : 0.25}
                                            />
                                            {/* Velocity Path */}
                                            <path
                                              d={getFullVelocityPath(row.layerId, ch, bounds)}
                                              fill="none"
                                              stroke={color}
                                              stroke-width={mode() === "velocity" && isSelectedAxis() ? 2.5 : 1.2}
                                              stroke-dasharray={mode() === "value" ? "3,3" : undefined}
                                              opacity={mode() === "velocity" ? (isSelectedAxis() ? 1.0 : 0.4) : 0.25}
                                            />

                                            {/* Edit Handles if this axis is selected */}
                                            <Show when={isSelectedAxis()}>
                                              {(() => {
                                                const track = editor.getComposition().tracks.find((t) => t.layerId === row.layerId && t.channel === ch);
                                                const kfs = track?.keyframes || [];
                                                const segments: JSX.Element[] = [];

                                                for (let i = 0; i < kfs.length - 1; i++) {
                                                  const a = kfs[i];
                                                  const b = kfs[i + 1];
                                                  const aSelected = isSelected(row.layerId, a.frame, p.channels);
                                                  const bSelected = isSelected(row.layerId, b.frame, p.channels);

                                                  if (aSelected || bSelected) {
                                                    const cp = getCPPositions(row.layerId, ch, a.frame, mode(), bounds);
                                                    if (cp) {
                                                      segments.push(
                                                        <>
                                                          {/* Guide line and circle for CP1 (outgoing from a) */}
                                                          <line
                                                            x1={framesToPx(a.frame)}
                                                            y1={mode() === "value" ? 110 - ((a.value - bounds.minVal) / (bounds.maxVal - bounds.minVal)) * 100 : 110 - ((0 - bounds.minVel) / (bounds.maxVel - bounds.minVel)) * 100}
                                                            x2={cp.cp1.x}
                                                            y2={cp.cp1.y}
                                                            stroke={color}
                                                            stroke-dasharray="2,2"
                                                            stroke-width="1"
                                                            opacity="0.6"
                                                          />
                                                          <circle
                                                            cx={cp.cp1.x}
                                                            cy={cp.cp1.y}
                                                            r="5"
                                                            fill={color}
                                                            stroke="var(--panel-2)"
                                                            stroke-width="1.5"
                                                            cursor="grab"
                                                            onPointerDown={(e) => onTimelineCPDown(row.layerId, ch, a.frame, 1, mode(), bounds, e)}
                                                          />

                                                          {/* Guide line and circle for CP2 (incoming to b) */}
                                                          <line
                                                            x1={framesToPx(b.frame)}
                                                            y1={mode() === "value" ? 110 - ((b.value - bounds.minVal) / (bounds.maxVal - bounds.minVal)) * 100 : 110 - ((0 - bounds.minVel) / (bounds.maxVel - bounds.minVel)) * 100}
                                                            x2={cp.cp2.x}
                                                            y2={cp.cp2.y}
                                                            stroke={color}
                                                            stroke-dasharray="2,2"
                                                            stroke-width="1"
                                                            opacity="0.6"
                                                          />
                                                          <circle
                                                            cx={cp.cp2.x}
                                                            cy={cp.cp2.y}
                                                            r="5"
                                                            fill="#ffffff"
                                                            stroke={color}
                                                            stroke-width="1.5"
                                                            cursor="grab"
                                                            onPointerDown={(e) => onTimelineCPDown(row.layerId, ch, a.frame, 2, mode(), bounds, e)}
                                                          />
                                                        </>
                                                      );
                                                    }
                                                  }
                                                }
                                                return segments;
                                              })()}
                                            </Show>
                                          </>
                                        );
                                      }}
                                    </For>
                                  </svg>
                                </div>
                              </Show>
                              <Show when={p.axes.length > 0 && isPropExpanded(row.layerId, p.label)}>
                                <For each={p.axes}>
                                  {(ax) => (
                                    <div class="seq__lane seq__lane--axis" onDblClick={(e) => onPropLaneDblClick(e, row, axProp(p, ax))}>
                                      {kfLane(row, axProp(p, ax))}
                                    </div>
                                  )}
                                </For>
                              </Show>
                            </>
                          )}
                        </For>
                      </Show>
                    </>
                  )}
                </For>
                <Show when={marquee()}>
                  {(m) => (
                    <div class="seq__marquee" style={{ left: `${m().left}px`, top: `${m().top}px`, width: `${m().width}px`, height: `${m().height}px` }} />
                  )}
                </Show>
              </div>
              <div class="seq__playhead" style={{ left: `${timeToPx(time())}px` }}>
                <span class="seq__playhead-tip"></span>
              </div>
          </div>
        </div>
      </div>
      </div>

      <Show when={ctxMenu()}>
        {(m) => (
          <div
            class="seq__kf-editor-backdrop"
            onPointerDown={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
          >
            <div class="seq__ctx-menu" style={{ left: `${m().x}px`, top: `${m().y}px` }} onPointerDown={(e) => e.stopPropagation()}>
              <div class="seq__ctx-title">Interpolation</div>
              <button type="button" class="seq__ctx-item" onClick={() => applyInterp("linear")}>Linéaire</button>
              <button type="button" class="seq__ctx-item" onClick={() => applyInterp("bezier")}>Bézier (ease)</button>
              <button type="button" class="seq__ctx-item" onClick={() => applyInterp("ease-in")}>Ease In</button>
              <button type="button" class="seq__ctx-item" onClick={() => applyInterp("ease-out")}>Ease Out</button>
              <button type="button" class="seq__ctx-item" onClick={() => applyInterp("hold")}>Hold</button>
            </div>
          </div>
        )}
      </Show>
      <Show when={labelPalette()}>
        {(lp) => (
          <div class="seq__kf-editor-backdrop" onPointerDown={() => setLabelPalette(null)}>
            <div class="seq__label-palette" style={{ left: `${lp().x}px`, top: `${lp().y}px` }} onPointerDown={(e) => e.stopPropagation()}>
              <button
                type="button"
                class="seq__label-swatch seq__label-swatch--none"
                data-tooltip="Aucun"
                onClick={() => { editor.setLabel(lp().layerId, undefined); setLabelPalette(null); }}
              />
              <For each={LABEL_COLORS}>
                {(c) => (
                  <button type="button" class="seq__label-swatch" style={{ background: c }} onClick={() => { editor.setLabel(lp().layerId, c); setLabelPalette(null); }} />
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
    </div>
  );
}

export function createTimelinePanel(clock: Clock, editor: Editor, audio: AudioEngine): Panel {
  return solidPanel({
    id: "timeline",
    title: "Timeline",
    modifier: "timeline",
    icon: "sliders",
    header: (header) => {
      const badge = document.createElement("span");
      badge.className = "seq-badge";
      badge.textContent = "Séquence 01";
      const spacer = document.createElement("div");
      spacer.className = "panel__header-spacer";
      header.append(badge, spacer);
    },
    body: () => <Timeline clock={clock} editor={editor} audio={audio} />,
  });
}

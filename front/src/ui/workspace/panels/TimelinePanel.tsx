import { createMemo, createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js";
import type { Clock } from "@core/Clock.ts";
import type { Editor } from "@core/Editor.ts";
import { moveClip, trimIn, trimOut, type Clip } from "@domain/Layer.ts";
import type { Interp } from "@domain/Composition.ts";
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

const MIN_PPS = 8;
const MAX_PPS = 400;
const DEFAULT_PPS = 90;

function clampPps(v: number): number {
  return Math.max(MIN_PPS, Math.min(MAX_PPS, v));
}

interface AxisRow { channel: string; label: string; animated: boolean; frames: number[]; interps: Interp[] }
interface PropRow { label: string; channels: string[]; animated: boolean; frames: number[]; interps: Interp[]; axes: AxisRow[] }
interface LayerRow { layerId: string; name: string; clip: Clip | undefined; props: PropRow[]; keyframes: number[]; solo: boolean; locked: boolean; label: string | undefined }

const LABEL_COLORS = ["#ff8a3d", "#7fd88a", "#5a9bff", "#c98bff", "#ffd24a", "#ff6b6b", "#4ad9d9", "#9aa0a6"];

/** Une clé sélectionnée = un groupe de canaux d'un calque à un frame. */
interface SelKey { layerId: string; frame: number; channels: string[] }
const sameKey = (a: SelKey, b: SelKey): boolean =>
  a.layerId === b.layerId && a.frame === b.frame && a.channels.join(",") === b.channels.join(",");

function Timeline(props: { clock: Clock; editor: Editor }): JSX.Element {
  const clock = props.clock;
  const editor = props.editor;
  const time = fromStore(clock, () => clock.time);
  const frame = fromStore(clock, () => clock.frame);
  const duration = fromStore(clock, () => clock.duration);
  const fps = fromStore(clock, () => clock.fps);
  const [pps, setPps] = createSignal(DEFAULT_PPS);

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
      return { layerId: l.id, name: l.name, clip: l.clip, props, keyframes, solo: !!l.solo, locked: !!l.locked, label: l.label };
    });
  });

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

  // Éditeur de valeur d'une clé (double-clic sur un diamant) : popover flottant.
  const [editKey, setEditKey] = createSignal<{ layerId: string; channels: string[]; frame: number; x: number; y: number } | null>(null);
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
  // Presse-papier de keyframes (offset relatif au 1er frame copié).
  let clipboard: { layerId: string; channels: string[]; offset: number; values: number[]; interp: Interp }[] = [];

  let scroller: HTMLDivElement | undefined;
  let namesList: HTMLDivElement | undefined;
  let lanesEl: HTMLDivElement | undefined;

  const timeToPx = (t: number): number => t * pps();
  const framesToPx = (n: number): number => timeToPx(clock.frameToTime(n));
  const contentWidth = (): number => Math.max(0, duration() * pps());
  const marks = (): number[] => {
    const secs = Math.max(0, Math.ceil(duration()));
    return Array.from({ length: secs + 1 }, (_, i) => i);
  };

  const clipGeo = (clip: Clip | undefined): { left: number; width: number } => {
    if (!clip) return { left: 0, width: contentWidth() };
    return { left: framesToPx(clip.in), width: framesToPx(clip.out - clip.in + 1) };
  };

  /** Aligne verticalement noms ↔ lanes : les deux colonnes scrollent ensemble. */
  const syncScroll = (from?: HTMLElement, to?: HTMLElement): void => {
    if (!from || !to) return;
    if (Math.abs(to.scrollTop - from.scrollTop) > 0.5) to.scrollTop = from.scrollTop;
  };

  const scrubTo = (clientX: number): void => {
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const x = clientX - rect.left + scroller.scrollLeft;
    clock.seekFrame(clock.timeToFrame(x / pps()));
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
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setPps((p) => clampPps(p * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    } else if (scroller && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
      e.preventDefault();
      scroller.scrollLeft += e.shiftKey ? e.deltaY : e.deltaX;
    }
    // sinon : scroll vertical natif (overflow-y) → synchronisé avec la colonne des noms
  };

  const fit = (): void => {
    if (!scroller || duration() <= 0) return;
    setPps(clampPps(scroller.clientWidth / duration()));
  };

  onMount(() => requestAnimationFrame(fit));

  /** x écran → frame clampé (dans le contenu défilable). */
  const frameAt = (clientX: number): number => {
    if (!scroller) return 0;
    const rect = scroller.getBoundingClientRect();
    const x = clientX - rect.left + scroller.scrollLeft;
    return Math.max(0, Math.min(clock.durationFrames, clock.timeToFrame(x / pps())));
  };

  // ————————————————————————————— Clips (barre) —————————————————————————————

  const onClipMove = (e: PointerEvent, row: LayerRow): void => {
    e.stopPropagation();
    if (row.locked) return;
    editor.select(row.layerId);
    const dur = clock.durationFrames;
    const base: Clip = row.clip ?? { in: 0, out: dur };
    const startFrame = frameAt(e.clientX);
    const move = (ev: PointerEvent): void => {
      editor.setClip(row.layerId, moveClip(base, frameAt(ev.clientX) - startFrame, dur));
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
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
    const move = (ev: PointerEvent): void => {
      const f = frameAt(ev.clientX);
      editor.setClip(row.layerId, edge === "in" ? trimIn(base, f, dur) : trimOut(base, f, dur));
    };
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
  const onKfDblClick = (e: MouseEvent, row: LayerRow, p: PropRow, f: number): void => {
    e.stopPropagation();
    setEditKey({ layerId: row.layerId, channels: p.channels, frame: f, x: e.clientX, y: e.clientY });
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
    }));
  };
  const pasteKeys = (): void => {
    if (!clipboard.length) return;
    const base = frame();
    const pasted: SelKey[] = [];
    for (const c of clipboard) {
      const target = Math.max(0, Math.min(clock.durationFrames, base + c.offset));
      c.channels.forEach((ch, i) => editor.putKeyframe(c.layerId, ch, target, c.values[i], c.interp));
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
    if (e.key === "Escape") { if (editKey()) setEditKey(null); if (ctxMenu()) setCtxMenu(null); return; }
    if (isTyping()) return;
    if (e.key === "ArrowRight") { e.preventDefault(); if (e.shiftKey) jumpKeyframe(1); else clock.stepFrame(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); if (e.shiftKey) jumpKeyframe(-1); else clock.stepFrame(-1); }
    else if (e.key === "Home") { e.preventDefault(); clock.goToStart(); }
    else if (e.key === "End") { e.preventDefault(); clock.goToEnd(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && selection().length) { e.preventDefault(); deleteSelection(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") { copyKeys(); }
    else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "v") { e.preventDefault(); pasteKeys(); }
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

  return (
    <div class="seq">
      <div class="seq__cols">
        <div class="seq__names">
          <div class="seq__subhead">Pistes</div>
          {/* aligne les rangées de noms avec les lanes (la colonne droite a zoombar + règle) */}
          <div class="seq__names-spacer" />
          <Show
            when={rows().length > 0}
            fallback={<div class="seq__names-list seq__names-list--empty">Groupe vide</div>}
          >
            <div class="seq__names-list" ref={namesList} onScroll={() => syncScroll(namesList, scroller)}>
              <For each={rows()}>
                {(row) => (
                  <>
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
                      <button
                        type="button"
                        class="seq__solo"
                        classList={{ "seq__solo--on": row.solo }}
                        data-tooltip="Solo (n'affiche que les calques en solo)"
                        onClick={(e) => { e.stopPropagation(); editor.setSolo(row.layerId, !row.solo); }}
                      >S</button>
                      <button
                        type="button"
                        class="seq__lock"
                        classList={{ "seq__lock--on": row.locked }}
                        data-tooltip={row.locked ? "Déverrouiller" : "Verrouiller"}
                        onClick={(e) => { e.stopPropagation(); editor.setLocked(row.layerId, !row.locked); }}
                      >{createIcon("lock", { size: 12 })}</button>
                    </div>
                    <Show when={isExpanded(row.layerId)}>
                      <For each={row.props}>
                        {(p) => (
                          <>
                            <div class="seq__name seq__name--child">
                              {propCtl(row, p)}
                              <Show when={p.axes.length > 0}>
                                <button
                                  type="button"
                                  class="seq__subtwirl"
                                  classList={{ "seq__subtwirl--open": isPropExpanded(row.layerId, p.label) }}
                                  data-tooltip="Séparer les dimensions"
                                  onClick={(e) => { e.stopPropagation(); togglePropExpand(row.layerId, p.label); }}
                                />
                              </Show>
                              <span class="seq__name-label">{p.label}</span>
                            </div>
                            <Show when={p.axes.length > 0 && isPropExpanded(row.layerId, p.label)}>
                              <For each={p.axes}>
                                {(ax) => (
                                  <div class="seq__name seq__name--axis">
                                    {propCtl(row, axProp(p, ax))}
                                    <span class="seq__name-label">{p.label} {ax.label}</span>
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
            </div>
          </Show>
        </div>
        <div class="seq__timeline">
          <div class="seq__zoombar">
            <span class="seq-meta">
              Durée {duration().toFixed(2)} s · {fps()} FPS
            </span>
            <button type="button" class="seq__zoom-btn" data-tooltip="Ajuster à la fenêtre" onClick={fit}>
              Ajuster
            </button>
          </div>
          <div class="seq__scroller" ref={scroller} onWheel={onWheel} onScroll={() => syncScroll(scroller, namesList)}>
            <div class="seq__content" style={{ width: `${contentWidth()}px` }}>
              <div class="seq__ruler" onPointerDown={onRulerDown}>
                <For each={marks()}>
                  {(s) => (
                    <div class="seq__mark" style={{ left: `${timeToPx(s)}px` }}>
                      <span class="seq__mark-label">{s}s</span>
                    </div>
                  )}
                </For>
              </div>
              <div class="seq__lanes" ref={lanesEl} onPointerDown={onLanesDown}>
                <For each={rows()}>
                  {(row) => (
                    <>
                      <div class="seq__lane">
                        <div
                          class="seq__bar seq__clip"
                          classList={{
                            "seq__clip--full": !row.clip,
                            "seq__clip--selected": selectedId() === row.layerId,
                          }}
                          style={{ left: `${clipGeo(row.clip).left}px`, width: `${clipGeo(row.clip).width}px` }}
                          onPointerDown={(e) => onClipMove(e, row)}
                        >
                          <div class="seq__clip-handle seq__clip-handle--l" onPointerDown={(e) => onClipTrim(e, row, "in")} />
                          <div class="seq__clip-handle seq__clip-handle--r" onPointerDown={(e) => onClipTrim(e, row, "out")} />
                        </div>
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
      <Show when={editKey()}>
        {(k) => (
          <div class="seq__kf-editor-backdrop" onPointerDown={() => setEditKey(null)}>
            <div class="seq__kf-editor" style={{ left: `${k().x}px`, top: `${k().y}px` }} onPointerDown={(e) => e.stopPropagation()}>
              <For each={k().channels}>
                {(ch) => (
                  <label class="seq__kf-editor-field">
                    <Show when={channelShort(ch)}>
                      <span>{channelShort(ch)}</span>
                    </Show>
                    <NumberField
                      value={editor.keyframeValue(k().layerId, ch, k().frame) ?? 0}
                      step={0.01}
                      onInput={(v) => editor.setKeyframeValue(k().layerId, ch, k().frame, v)}
                    />
                  </label>
                )}
              </For>
            </div>
          </div>
        )}
      </Show>
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

export function createTimelinePanel(clock: Clock, editor: Editor): Panel {
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
    body: () => <Timeline clock={clock} editor={editor} />,
  });
}

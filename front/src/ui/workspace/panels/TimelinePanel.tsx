import { createMemo, createSignal, For, onMount, Show, type JSX } from "solid-js";
import type { Clock } from "@core/Clock.ts";
import type { Editor } from "@core/Editor.ts";
import { findLayer } from "@domain/Layer.ts";
import { fromStore } from "@ui/solid/store.ts";
import { solidPanel } from "@ui/solid/mount.ts";
import type { Panel } from "../Panel.ts";

const MIN_PPS = 8;
const MAX_PPS = 400;
const DEFAULT_PPS = 90;

function clampPps(v: number): number {
  return Math.max(MIN_PPS, Math.min(MAX_PPS, v));
}

const PARAM_LABEL: Record<string, string> = { speed: "Vitesse", detail: "Détail", contrast: "Contraste", hue: "Teinte" };
const AXIS_LABEL: Record<string, string> = { x: "X", y: "Y", z: "Z" };
const COLOR_LABEL: Record<string, string> = { r: "Rouge", g: "Vert", b: "Bleu" };

/** Libellé lisible d'un canal ("position.x" → "Position X", "param.speed" → "Vitesse"). */
function channelLabel(channel: string): string {
  if (channel === "opacity") return "Opacité";
  const [group, key] = channel.split(".");
  if (group === "position") return `Position ${AXIS_LABEL[key] ?? key}`;
  if (group === "rotation") return `Rotation ${AXIS_LABEL[key] ?? key}`;
  if (group === "scale") return `Échelle ${AXIS_LABEL[key] ?? key}`;
  if (group === "color") return COLOR_LABEL[key] ?? key;
  if (group === "param") return PARAM_LABEL[key] ?? key;
  return channel;
}

interface Row { layerId: string; channel: string; label: string; frames: number[] }

function Timeline(props: { clock: Clock; editor: Editor }): JSX.Element {
  const clock = props.clock;
  const editor = props.editor;
  const time = fromStore(clock, () => clock.time);
  const duration = fromStore(clock, () => clock.duration);
  const fps = fromStore(clock, () => clock.fps);
  const [pps, setPps] = createSignal(DEFAULT_PPS);

  // Snapshot réactif : recalculé à chaque emit de l'Editor (jamais pendant la lecture —
  // evaluate() n'émet pas). Objets frais → <For> se redessine à chaque changement de structure.
  const version = fromStore(editor, () => editor.getComposition());
  const rows = createMemo<Row[]>(() => {
    version();
    const root = editor.getDocument().root;
    return editor.getComposition().tracks.map((t) => ({
      layerId: t.layerId,
      channel: t.channel,
      label: `${findLayer(root, t.layerId)?.name ?? t.layerId} · ${channelLabel(t.channel)}`,
      frames: t.keyframes.map((k) => k.frame),
    }));
  });
  const [sel, setSel] = createSignal<{ layerId: string; channel: string; frame: number } | null>(null);
  const isSel = (r: Row, f: number): boolean => {
    const s = sel();
    return !!s && s.layerId === r.layerId && s.channel === r.channel && s.frame === f;
  };

  let scroller: HTMLDivElement | undefined;

  const timeToPx = (t: number): number => t * pps();
  const contentWidth = (): number => Math.max(0, duration() * pps());
  const marks = (): number[] => {
    const secs = Math.max(0, Math.ceil(duration()));
    return Array.from({ length: secs + 1 }, (_, i) => i);
  };

  const scrubTo = (clientX: number): void => {
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    const x = clientX - rect.left + scroller.scrollLeft;
    clock.seekFrame(clock.timeToFrame(x / pps()));
  };

  const onPointerDown = (e: PointerEvent): void => {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    target.classList.add("seq__content--scrubbing");
    scrubTo(e.clientX);
    const move = (ev: PointerEvent): void => scrubTo(ev.clientX);
    const up = (ev: PointerEvent): void => {
      target.releasePointerCapture(ev.pointerId);
      target.classList.remove("seq__content--scrubbing");
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
    } else if (scroller) {
      e.preventDefault();
      scroller.scrollLeft += e.deltaY + e.deltaX;
    }
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

  /** Clic sur un diamant : sélection + glisser pour déplacer (stopPropagation → pas de scrub). */
  const onKeyDown = (e: PointerEvent, r: Row, f: number): void => {
    e.stopPropagation();
    setSel({ layerId: r.layerId, channel: r.channel, frame: f });
    let dragFrame = f;
    const move = (ev: PointerEvent): void => {
      const nf = frameAt(ev.clientX);
      if (nf !== dragFrame) {
        editor.moveKeyframe(r.layerId, r.channel, dragFrame, nf);
        dragFrame = nf;
        setSel({ layerId: r.layerId, channel: r.channel, frame: nf });
      }
    };
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  /** Double-clic sur un diamant : supprimer la clé. */
  const onKeyDblClick = (e: MouseEvent, r: Row, f: number): void => {
    e.stopPropagation();
    editor.removeKeyframe(r.layerId, r.channel, f);
    setSel(null);
  };

  /** Double-clic sur une lane (hors diamant) : poser une clé au frame cliqué. */
  const onLaneDblClick = (e: MouseEvent, r: Row): void => {
    editor.addKeyframeAt(r.layerId, r.channel, frameAt(e.clientX));
  };

  return (
    <div class="seq">
      <div class="seq__cols">
        <div class="seq__names">
          <div class="seq__subhead">Pistes</div>
          <Show
            when={rows().length > 0}
            fallback={<div class="seq__names-list seq__names-list--empty">Aucune piste — pose une clé (diamant) dans l'inspecteur</div>}
          >
            <div class="seq__names-list">
              <For each={rows()}>
                {(r) => (
                  <div class="seq__name">
                    <div class="seq__dot" />
                    <span class="seq__name-label">{r.label}</span>
                  </div>
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
          <div class="seq__scroller" ref={scroller} onWheel={onWheel}>
            <div
              class="seq__content"
              style={{ width: `${contentWidth()}px` }}
              onPointerDown={onPointerDown}
            >
              <div class="seq__ruler">
                <For each={marks()}>
                  {(s) => (
                    <div class="seq__mark" style={{ left: `${timeToPx(s)}px` }}>
                      <span class="seq__mark-label">{s}s</span>
                    </div>
                  )}
                </For>
              </div>
              <div class="seq__lanes">
                <For each={rows()}>
                  {(r) => (
                    <div class="seq__lane" onDblClick={(e) => onLaneDblClick(e, r)}>
                      <For each={r.frames}>
                        {(f) => (
                          <div
                            class="seq__kf"
                            classList={{ "seq__kf--selected": isSel(r, f) }}
                            style={{ left: `${timeToPx(clock.frameToTime(f))}px` }}
                            onPointerDown={(e) => onKeyDown(e, r, f)}
                            onDblClick={(e) => onKeyDblClick(e, r, f)}
                          />
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </div>
              <div class="seq__playhead" style={{ left: `${timeToPx(time())}px` }}>
                <span class="seq__playhead-tip"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
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

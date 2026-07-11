import { createSignal, For, onMount, type JSX } from "solid-js";
import type { Clock } from "@core/Clock.ts";
import { fromStore } from "@ui/solid/store.ts";
import { solidPanel } from "@ui/solid/mount.ts";
import type { Panel } from "../Panel.ts";

const MIN_PPS = 8;
const MAX_PPS = 400;
const DEFAULT_PPS = 90;

function clampPps(v: number): number {
  return Math.max(MIN_PPS, Math.min(MAX_PPS, v));
}

function Timeline(props: { clock: Clock }): JSX.Element {
  const clock = props.clock;
  const time = fromStore(clock, () => clock.time);
  const duration = fromStore(clock, () => clock.duration);
  const fps = fromStore(clock, () => clock.fps);
  const [pps, setPps] = createSignal(DEFAULT_PPS);

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
    scrubTo(e.clientX);
    const move = (ev: PointerEvent): void => scrubTo(ev.clientX);
    const up = (ev: PointerEvent): void => {
      target.releasePointerCapture(ev.pointerId);
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

  return (
    <div class="seq">
      <div class="seq__cols">
        <div class="seq__names">
          <div class="seq__subhead">Pistes</div>
          <div class="seq__names-list seq__names-list--empty">
            Aucune piste — les keyframes arrivent en slice 2
          </div>
        </div>
        <div class="seq__timeline">
          <div class="seq__zoombar">
            <span class="seq-meta">
              Durée {duration().toFixed(2)} s · {fps()} FPS
            </span>
            <button type="button" class="seq__zoom-btn" onClick={fit}>
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
              <div class="seq__lanes"></div>
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

export function createTimelinePanel(clock: Clock): Panel {
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
    body: () => <Timeline clock={clock} />,
  });
}

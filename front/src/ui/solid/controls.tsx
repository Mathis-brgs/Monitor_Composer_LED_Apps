import { createSignal, For, type JSX } from "solid-js";
import type { RGB } from "@domain/Layer.ts";
import { createIcon } from "@ui/icons/Icon.ts";
import { hexToRgb, rgbToHex } from "./color.ts";

/**
 * Kit de contrôles Solid de l'inspecteur (mêmes classes que le proto). Chaque
 * contrôle porte `insp-control` (comme l'ajoutait `row()` en impératif) → DOM identique.
 */

/** Ligne d'inspecteur : libellé (82px) + contrôle. */
export function Row(props: { label: string; children: JSX.Element }): JSX.Element {
  return (
    <div class="insp-row">
      <div class="insp-label">{props.label}</div>
      {props.children}
    </div>
  );
}

/** Section repliable : en-tête (caret + titre) + corps. État local. */
export function Section(props: { title: string; children: JSX.Element }): JSX.Element {
  const [collapsed, setCollapsed] = createSignal(false);
  return (
    <div class="insp-section" classList={{ "insp-section--collapsed": collapsed() }}>
      <div class="insp-section__head" onClick={() => setCollapsed((c) => !c)}>
        {createIcon("chevron-down", { size: 9, className: "insp-section__caret" })}
        <span class="insp-section__label">{props.title}</span>
      </div>
      <div class="insp-section__body">{props.children}</div>
    </div>
  );
}

/** Groupe de champs numériques (affichage seul pour l'instant). */
export function Fields(props: { values: string[] }): JSX.Element {
  return (
    <div class="insp-fields insp-control">
      <For each={props.values}>{(value) => <div class="insp-field">{value}</div>}</For>
    </div>
  );
}

export interface SliderProps {
  /** valeur normalisée 0..1 (graine locale : non re-liée aux émissions du store) */
  value: number;
  format?: (v: number) => string;
  /** rend le slider interactif (drag) et émet la valeur 0..1 */
  onInput?: (v: number) => void;
}

/** Slider : piste + remplissage + valeur. Valeur locale (drag fluide, pas de jitter). */
export function Slider(props: SliderProps): JSX.Element {
  const format = props.format ?? ((v: number) => v.toFixed(2));
  const [v, setV] = createSignal(props.value);
  let track!: HTMLDivElement;

  const set = (clientX: number): void => {
    const rect = track.getBoundingClientRect();
    const nv = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setV(nv);
    props.onInput?.(nv);
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (!props.onInput) return;
    track.setPointerCapture(e.pointerId);
    set(e.clientX);
    const move = (ev: PointerEvent): void => set(ev.clientX);
    const up = (ev: PointerEvent): void => {
      track.releasePointerCapture(ev.pointerId);
      track.removeEventListener("pointermove", move);
      track.removeEventListener("pointerup", up);
    };
    track.addEventListener("pointermove", move);
    track.addEventListener("pointerup", up);
  };

  return (
    <div class="insp-slider insp-control">
      <div
        ref={track}
        class="insp-slider__track"
        classList={{ "insp-slider__track--live": !!props.onInput }}
        onPointerDown={onPointerDown}
      >
        <div class="insp-slider__fill" style={{ width: `${v() * 100}%` }} />
      </div>
      <div class="insp-slider__value">{format(v())}</div>
    </div>
  );
}

/** Segmented : options à largeurs égales, une active (accent). */
export function Segmented(props: {
  options: string[];
  active: number;
  onChange?: (index: number) => void;
}): JSX.Element {
  const [active, setActive] = createSignal(props.active);
  return (
    <div class="segmented insp-control">
      <For each={props.options}>
        {(label, i) => (
          <div
            class="segmented__opt"
            classList={{ "segmented__opt--active": active() === i() }}
            onClick={() => {
              if (!props.onChange) return;
              setActive(i());
              props.onChange(i());
            }}
          >
            {label}
          </div>
        )}
      </For>
    </div>
  );
}

/** Palette : barre de dégradé + pastille. */
export function Palette(props: { gradient: string }): JSX.Element {
  return (
    <div class="insp-palette insp-control">
      <div class="insp-palette__bar" style={{ background: props.gradient }} />
      <div class="insp-palette__swatch" />
    </div>
  );
}

export interface NumberFieldProps {
  value: number;
  format?: (v: number) => string;   // défaut : 2 décimales
  step?: number;                    // sensibilité du drag (défaut 0.01/px)
  onInput?: (v: number) => void;
}

/** Champ numérique éditable : drag horizontal (valeur locale). */
export function NumberField(props: NumberFieldProps): JSX.Element {
  const format = props.format ?? ((n: number) => n.toFixed(2));
  const step = props.step ?? 0.01;
  const [v, setV] = createSignal(props.value);
  let el!: HTMLDivElement;

  const commit = (nv: number): void => { setV(nv); props.onInput?.(nv); };

  const onPointerDown = (e: PointerEvent): void => {
    if (!props.onInput) return;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX;
    const base = v();
    const move = (ev: PointerEvent): void => commit(base + (ev.clientX - x0) * step);
    const up = (ev: PointerEvent): void => {
      el.releasePointerCapture(ev.pointerId);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  return (
    <div ref={el} class="insp-field insp-field--editable insp-control" onPointerDown={onPointerDown}>
      {format(v())}
    </div>
  );
}

/** Case à cocher (pastille accent quand active). */
export function Checkbox(props: { checked: boolean; onChange?: (v: boolean) => void }): JSX.Element {
  const [on, setOn] = createSignal(props.checked);
  return (
    <div
      class="insp-check insp-control"
      classList={{ "insp-check--on": on() }}
      onClick={() => { const v = !on(); setOn(v); props.onChange?.(v); }}
    />
  );
}

/** Champ texte éditable (rename) — commit sur blur/Enter. */
export function TextField(props: { value: string; onInput?: (v: string) => void }): JSX.Element {
  return (
    <input
      class="insp-text insp-control"
      type="text"
      value={props.value}
      onChange={(e) => props.onInput?.((e.currentTarget as HTMLInputElement).value)}
    />
  );
}

export interface ColorFieldProps {
  value: RGB;
  onInput?: (rgb: RGB) => void;
}

/** Champ couleur : pastille + <input type="color"> masqué. Valeur locale (aperçu live). */
export function ColorField(props: ColorFieldProps): JSX.Element {
  let input!: HTMLInputElement;
  const [hex, setHex] = createSignal(rgbToHex(props.value));
  return (
    <div class="insp-color insp-control" onClick={() => input.click()}>
      <div class="insp-color__swatch" style={{ background: hex() }} />
      <span class="insp-color__hex">{hex()}</span>
      <input
        ref={input}
        type="color"
        class="insp-color__input"
        value={hex()}
        onInput={(e) => {
          const value = (e.currentTarget as HTMLInputElement).value;
          setHex(value);
          props.onInput?.(hexToRgb(value));
        }}
      />
    </div>
  );
}

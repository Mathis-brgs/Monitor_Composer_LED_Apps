import { createIcon } from "@ui/icons/Icon.ts";

/**
 * Kit de contrôles de l'inspecteur (styles exacts du proto) : ligne libellé+contrôle,
 * champ numérique, slider, segmented, palette, select, section repliable.
 */

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** Ligne d'inspecteur : libellé (82px) + contrôle (flex). */
export function row(label: string, control: HTMLElement): HTMLElement {
  const r = el("div", "insp-row");
  const l = el("div", "insp-label");
  l.textContent = label;
  control.classList.add("insp-control");
  r.append(l, control);
  return r;
}

/** Groupe de champs numériques (1..n champs égaux). */
export function fields(values: string[]): HTMLElement {
  const wrap = el("div", "insp-fields");
  for (const value of values) {
    const field = el("div", "insp-field");
    field.textContent = value;
    wrap.appendChild(field);
  }
  return wrap;
}

export interface SliderOptions {
  /** formate la valeur 0..1 pour l'affichage (défaut : 2 décimales) */
  format?: (v: number) => string;
  /** rend le slider interactif (drag) et émet la valeur 0..1 */
  onInput?: (v: number) => void;
}

/** Slider : piste + remplissage + valeur. `value` normalisée 0..1. Draggable si `onInput`. */
export function slider(value: number, opts: SliderOptions = {}): HTMLElement {
  const format = opts.format ?? ((v) => v.toFixed(2));
  const wrap = el("div", "insp-slider");
  const track = el("div", "insp-slider__track");
  const fill = el("div", "insp-slider__fill");
  fill.style.width = `${value * 100}%`;
  track.appendChild(fill);
  const val = el("div", "insp-slider__value");
  val.textContent = format(value);
  wrap.append(track, val);

  const onInput = opts.onInput;
  if (onInput) {
    track.classList.add("insp-slider__track--live");
    const set = (clientX: number): void => {
      const rect = track.getBoundingClientRect();
      const v = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      fill.style.width = `${v * 100}%`;
      val.textContent = format(v);
      onInput(v);
    };
    track.addEventListener("pointerdown", (e) => {
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
    });
  }
  return wrap;
}

/** Segmented : options à largeurs égales, une active (accent). Cliquable si `onChange`. */
export function segmented(options: string[], activeIndex: number, onChange?: (index: number) => void): HTMLElement {
  const wrap = el("div", "segmented");
  const opts: HTMLElement[] = [];
  options.forEach((label, i) => {
    const opt = el("div", i === activeIndex ? "segmented__opt segmented__opt--active" : "segmented__opt");
    opt.textContent = label;
    if (onChange) {
      opt.addEventListener("click", () => {
        opts.forEach((o, j) => o.classList.toggle("segmented__opt--active", j === i));
        onChange(i);
      });
    }
    opts.push(opt);
    wrap.appendChild(opt);
  });
  return wrap;
}

/** Palette : barre de dégradé + pastille de couleur. */
export function palette(gradient: string): HTMLElement {
  const wrap = el("div", "insp-palette");
  const bar = el("div", "insp-palette__bar");
  bar.style.background = gradient;
  const swatch = el("div", "insp-palette__swatch");
  wrap.append(bar, swatch);
  return wrap;
}

/** Champ select (valeur + chevron). */
export function selectField(value: string): HTMLElement {
  const field = el("div", "insp-select");
  const label = el("span", "");
  label.textContent = value;
  field.append(label, createIcon("chevron-down", { size: 10 }));
  return field;
}

/** Section repliable : en-tête (caret + titre) + corps. */
export function section(title: string, rows: HTMLElement[]): HTMLElement {
  const sec = el("div", "insp-section");

  const head = el("div", "insp-section__head");
  head.append(createIcon("chevron-down", { size: 9, className: "insp-section__caret" }));
  const label = el("span", "insp-section__label");
  label.textContent = title;
  head.appendChild(label);

  const body = el("div", "insp-section__body");
  for (const r of rows) body.appendChild(r);

  head.addEventListener("click", () => sec.classList.toggle("insp-section--collapsed"));
  sec.append(head, body);
  return sec;
}

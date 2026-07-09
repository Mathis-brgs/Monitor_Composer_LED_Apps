import type { Clock } from "@core/Clock.ts";

/** Une piste de timeline : nom, valeur courante, barre de séquence et keyframes (positions en %). */
interface SeqTrack {
  readonly name: string;
  readonly value: string;
  readonly width: number;
  readonly keyframes: readonly number[];
}

/** Durée de la timeline (règle 0–8 s, cf. proto). */
const DURATION = 8;
const MARKS = 8;

// Données de démonstration — à brancher sur le montage (@domain/Composition).
const TRACKS: readonly SeqTrack[] = [
  { name: "Plasma · Vitesse", value: "0.42", width: 82, keyframes: [12, 34, 62, 88] },
  { name: "Balayage · Position", value: "0.61", width: 96, keyframes: [2, 32, 60, 86, 99] },
  { name: "Plasma · Teinte", value: "204°", width: 44, keyframes: [6, 40] },
  { name: "Sortie · Opacité", value: "100%", width: 98, keyframes: [4, 66] },
];

/** Timeline : pistes (gauche) + règle/barres/keyframes/playhead (droite). Playhead lié à l'horloge. */
export class Sequencer {
  readonly element: HTMLElement;
  private readonly _playhead: HTMLElement;
  private readonly _names: HTMLElement[] = [];
  private readonly _lanes: HTMLElement[] = [];
  private _selected = -1;

  constructor(clock: Clock) {
    const names = div("seq__names");
    names.appendChild(subhead("Pistes"));
    const namesList = div("seq__names-list");
    TRACKS.forEach((track, i) => {
      const row = this._nameRow(track, i);
      this._names.push(row);
      namesList.appendChild(row);
    });
    names.appendChild(namesList);

    const timeline = div("seq__timeline");
    timeline.appendChild(this._ruler());
    const lanes = div("seq__lanes");
    TRACKS.forEach((track) => {
      const lane = this._lane(track);
      this._lanes.push(lane);
      lanes.appendChild(lane);
    });
    this._playhead = playhead();
    timeline.append(lanes, this._playhead);

    const cols = div("seq__cols");
    cols.append(names, timeline);

    this.element = div("seq");
    this.element.appendChild(cols);

    clock.subscribe((c) => this._syncPlayhead(c));
    this._select(0);
  }

  private _nameRow(track: SeqTrack, index: number): HTMLElement {
    const row = div("seq__name");
    row.append(div("seq__dot"));

    const label = div("seq__name-label");
    label.textContent = track.name;

    const value = div("seq__name-value");
    value.textContent = track.value;

    row.append(label, value, div("seq__name-kf"));
    row.addEventListener("click", () => this._select(index));
    return row;
  }

  private _ruler(): HTMLElement {
    const ruler = div("seq__ruler");
    for (let i = 0; i <= MARKS; i++) {
      const mark = div("seq__mark");
      mark.style.left = `${(i / DURATION) * 100}%`;
      const label = div("seq__mark-label");
      label.textContent = `${i}s`;
      mark.appendChild(label);
      ruler.appendChild(mark);
    }
    return ruler;
  }

  private _lane(track: SeqTrack): HTMLElement {
    const lane = div("seq__lane");
    const bar = div("seq__bar");
    bar.style.width = `${track.width}%`;
    lane.appendChild(bar);
    for (const pos of track.keyframes) {
      const kf = div("seq__kf");
      kf.style.left = `${pos}%`;
      lane.appendChild(kf);
    }
    return lane;
  }

  private _select(index: number): void {
    if (this._selected >= 0) {
      this._names[this._selected]?.classList.remove("seq__name--selected");
      this._lanes[this._selected]?.classList.remove("seq__lane--selected");
    }
    this._selected = index;
    this._names[index]?.classList.add("seq__name--selected");
    this._lanes[index]?.classList.add("seq__lane--selected");
  }

  private _syncPlayhead(clock: Clock): void {
    const pos = ((clock.time % DURATION) / DURATION) * 100;
    this._playhead.style.left = `${pos}%`;
  }
}

function div(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

function subhead(text: string): HTMLElement {
  const el = div("seq__subhead");
  el.textContent = text;
  return el;
}

function playhead(): HTMLElement {
  const el = div("seq__playhead");
  el.innerHTML = '<span class="seq__playhead-tip"></span>';
  return el;
}

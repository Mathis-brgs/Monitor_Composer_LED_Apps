import type { Editor } from "@core/Editor.ts";
import { insertPlasmaBallMaterial } from "@core/precomps/plasmaBallMaterial.ts";

/** Une entrée de la palette d'ajout : glyphe (même jeu que l'Outliner), libellé, action sur l'éditeur. */
interface AddItem { glyph: string; label: string; run: (editor: Editor) => void }

const ITEMS: readonly AddItem[] = [
  { glyph: "◼", label: "Cube", run: (e) => e.addShape("box") },
  { glyph: "●", label: "Sphère", run: (e) => e.addShape("sphere") },
  { glyph: "▲", label: "Cône", run: (e) => e.addShape("cone") },
  { glyph: "▮", label: "Cylindre", run: (e) => e.addShape("cylinder") },
  { glyph: "▱", label: "Plan", run: (e) => e.addShape("plane") },
  { glyph: "◍", label: "Tore", run: (e) => e.addShape("torus") },
  { glyph: "✦", label: "Projecteur", run: (e) => e.addSpot() },
  { glyph: "❋", label: "Lyre", run: (e) => e.addLyre() },
  { glyph: "✺", label: "Particules", run: (e) => e.addParticles() },
  { glyph: "⧉", label: "Précomp vide", run: (e) => e.addPrecomp() },
  { glyph: "◎", label: "Prérendu vide", run: (e) => e.addPrerender() },
  { glyph: "☀", label: "Boule plasma braise", run: (e) => insertPlasmaBallMaterial(e) },
];

const COLS = 2;

/** Insensible aux accents/casse pour le filtre-tape. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/**
 * Palette d'ajout (⇧A) : overlay command-palette qui s'ouvre n'importe où dans la vue. Filtre-tape +
 * grille de primitives/fixtures/comps, navigation clavier (flèches + Entrée), Échap ferme. Ajoute dans
 * la comp/groupe actif via l'éditeur. DOM pur (comme le reste du cadre), monté à la demande.
 */
export class AddPalette {
  private _overlay: HTMLElement | null = null;
  private _input!: HTMLInputElement;
  private _grid!: HTMLElement;
  private _filtered: AddItem[] = [];
  private _active = 0;

  constructor(private readonly _editor: Editor) {}

  get isOpen(): boolean { return this._overlay !== null; }

  open(): void {
    if (this._overlay) return;

    const overlay = document.createElement("div");
    overlay.className = "add-palette-overlay";
    overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) this.close(); });

    const panel = document.createElement("div");
    panel.className = "add-palette";

    const head = document.createElement("div");
    head.className = "add-palette__head";
    const title = document.createElement("span");
    title.className = "add-palette__title";
    title.textContent = "Ajouter";
    const hint = document.createElement("span");
    hint.className = "add-palette__hint";
    hint.textContent = "⇧A";
    head.append(title, hint);

    this._input = document.createElement("input");
    this._input.className = "add-palette__filter";
    this._input.type = "text";
    this._input.placeholder = "Filtrer…";
    this._input.spellcheck = false;
    this._input.addEventListener("input", () => this._refilter());
    this._input.addEventListener("keydown", (e) => this._onKey(e));

    this._grid = document.createElement("div");
    this._grid.className = "add-palette__grid";

    panel.append(head, this._input, this._grid);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this._overlay = overlay;

    this._refilter();
    this._input.focus();
  }

  close(): void {
    this._overlay?.remove();
    this._overlay = null;
  }

  private _refilter(): void {
    const q = norm(this._input.value.trim());
    this._filtered = q ? ITEMS.filter((it) => norm(it.label).includes(q)) : [...ITEMS];
    this._active = 0;
    this._render();
  }

  private _render(): void {
    this._grid.replaceChildren();
    this._filtered.forEach((it, i) => {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "add-palette__item";
      cell.classList.toggle("add-palette__item--active", i === this._active);
      const glyph = document.createElement("span");
      glyph.className = "add-palette__glyph";
      glyph.textContent = it.glyph;
      const label = document.createElement("span");
      label.textContent = it.label;
      cell.append(glyph, label);
      cell.addEventListener("pointerenter", () => { this._active = i; this._syncActive(); });
      cell.addEventListener("click", () => this._run(it));
      this._grid.appendChild(cell);
    });
  }

  private _syncActive(): void {
    [...this._grid.children].forEach((c, i) => c.classList.toggle("add-palette__item--active", i === this._active));
  }

  private _onKey(e: KeyboardEvent): void {
    const n = this._filtered.length;
    if (e.key === "Escape") { e.preventDefault(); this.close(); return; }
    if (e.key === "Enter") { e.preventDefault(); if (this._filtered[this._active]) this._run(this._filtered[this._active]); return; }
    if (n === 0) return;
    let d = 0;
    if (e.key === "ArrowRight") d = 1;
    else if (e.key === "ArrowLeft") d = -1;
    else if (e.key === "ArrowDown") d = COLS;
    else if (e.key === "ArrowUp") d = -COLS;
    else return;
    e.preventDefault();
    this._active = Math.max(0, Math.min(n - 1, this._active + d));
    this._syncActive();
  }

  private _run(item: AddItem): void {
    item.run(this._editor);
    this.close();
  }
}

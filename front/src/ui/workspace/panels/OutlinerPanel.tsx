import { createMemo, For, Show, createSignal, onCleanup, type Accessor, type JSX } from "solid-js";
import type { Editor } from "@core/Editor.ts";
import type { Layer } from "@domain/Layer.ts";
import { createIcon } from "@ui/icons/Icon.ts";
import { fromStore } from "@ui/solid/store.ts";
import { solidPanel } from "@ui/solid/mount.ts";
import { layerGlyph } from "./layer-display.ts";
import type { Panel } from "../Panel.ts";

/** Cible d'un menu contextuel : le calque cliqué + la position écran du curseur. */
interface CtxTarget { layer: Layer; x: number; y: number }

/** Outliner : arbre du groupe actif. Panneau unique — mêmes données en 2D (compositor) et 3D (scène). */
function LayerTree(props: { editor: Editor }): JSX.Element {
  const editor = props.editor;
  const layers = fromStore(editor, () => editor.children);
  const changed = fromStore(editor, () => editor.selectedId);
  const trail = fromStore(editor, () => editor.compTrail);
  const multi = fromStore(editor, () => editor.multiSelectedIds);
  const multiSet = createMemo(() => new Set(multi()));
  const atGroupRoot = createMemo(() => { changed(); return editor.activeGroupId === editor.rootId; });
  // Retour possible seulement s'il y a où aller : un sous-groupe interne OU une comp imbriquée (pas au main root).
  const canGoBack = createMemo(() => !atGroupRoot() || trail().length > 1);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [ctx, setCtx] = createSignal<CtxTarget | null>(null);

  // retour : d'abord remonter les groupes internes, puis sortir de la comp.
  const goBack = () => { if (!atGroupRoot()) editor.exitGroup(); else editor.exitComp(); };

  // Sélection multiple au niveau modèle (shift = plage, ctrl/cmd = ajout un par un). `editor.selectedId`
  // (unique) reste la sélection primaire pour l'Inspecteur/gizmo ; `editor.multiSelectedIds` porte le set
  // pour les actions groupées (précomposer, grouper, supprimer).
  let anchorIndex = -1;
  let root!: HTMLDivElement;

  const onRowClick = (e: MouseEvent, layer: Layer, index: number): void => {
    if (e.shiftKey && anchorIndex !== -1) {
      const [a, b] = [anchorIndex, index].sort((x, y) => x - y);
      editor.selectMany(layers().slice(a, b + 1).map((l) => l.id), layer.id);
    } else if (e.metaKey || e.ctrlKey) {
      const set = new Set(editor.multiSelectedIds);
      if (set.has(layer.id)) set.delete(layer.id); else set.add(layer.id);
      editor.selectMany([...set], layer.id);
      anchorIndex = index;
    } else {
      editor.select(layer.id);
      anchorIndex = index;
    }
    root.focus();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    if (editor.multiSelectedIds.length === 0) return;
    e.preventDefault();
    e.stopPropagation(); // évite de déclencher aussi le raccourci Suppr. de la Timeline
    editor.deleteSelected();
  };

  // Clic droit : sélectionne la ligne (sauf si déjà dans la sélection multiple) puis ouvre le menu.
  const onRowContext = (e: MouseEvent, layer: Layer): void => {
    e.preventDefault();
    if (!editor.multiSelectedIds.includes(layer.id)) editor.select(layer.id);
    setCtx({ layer, x: e.clientX, y: e.clientY });
  };

  return (
    <div class="layer-tree" ref={root} tabIndex={-1} onKeyDown={onKeyDown}>
      <div class="comp-bar">
        <Show when={canGoBack()}>
          <button type="button" class="comp-back" onClick={goBack}>‹ Retour</button>
          <span class="comp-trail__sep">|</span>
        </Show>
        <div class="comp-trail">
          <For each={trail()}>
            {(c, i) => (
              <>
                <Show when={i() > 0}><span class="comp-trail__sep">/</span></Show>
                <button
                  type="button"
                  class="comp-trail__seg"
                  classList={{ "comp-trail__seg--current": i() === trail().length - 1 }}
                  disabled={i() === trail().length - 1}
                  onClick={() => editor.exitToComp(c.id)}
                >
                  {c.name}
                </button>
              </>
            )}
          </For>
        </div>
      </div>
      <For each={layers()}>
        {(layer, i) => (
          <LayerRow editor={editor} layer={layer} changed={changed}
            editingId={editingId} setEditingId={setEditingId}
            multiSet={multiSet} onRowClick={(e) => onRowClick(e, layer, i())}
            onContext={(e) => onRowContext(e, layer)} />
        )}
      </For>
      <Show when={ctx()}>
        {(target) => (
          <ContextMenu editor={editor} target={target()} close={() => setCtx(null)} startRename={(id) => setEditingId(id)} />
        )}
      </Show>
    </div>
  );
}

/** Une action du menu contextuel : libellé, raccourci affiché, handler, état grisé. */
function MenuItem(props: { label: string; shortcut?: string; danger?: boolean; disabled?: boolean; onRun: () => void; close: () => void }): JSX.Element {
  return (
    <button
      type="button"
      class="ctx-menu__item"
      classList={{ "ctx-menu__item--danger": props.danger, "ctx-menu__item--disabled": props.disabled }}
      disabled={props.disabled}
      onClick={() => { if (!props.disabled) { props.onRun(); props.close(); } }}
    >
      <span>{props.label}</span>
      <Show when={props.shortcut}><span class="ctx-menu__key">{props.shortcut}</span></Show>
    </button>
  );
}

/**
 * Menu contextuel de l'Outliner (clic droit) : une seule liste pour tous les types, les actions non
 * pertinentes sont grisées. Se ferme au clic ailleurs, à Échap ou après une action.
 */
function ContextMenu(props: { editor: Editor; target: CtxTarget; close: () => void; startRename: (id: string) => void }): JSX.Element {
  const { editor, target, close } = props;
  const layer = target.layer;
  const isPrecomp = layer.type === "precomp";

  const onDocDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".ctx-menu")) close(); };
  const onEsc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  window.addEventListener("pointerdown", onDocDown, true);
  window.addEventListener("keydown", onEsc, true);
  onCleanup(() => {
    window.removeEventListener("pointerdown", onDocDown, true);
    window.removeEventListener("keydown", onEsc, true);
  });

  return (
    <div class="ctx-menu" style={{ left: `${target.x}px`, top: `${target.y}px` }}>
      <MenuItem label="Renommer" close={close} onRun={() => props.startRename(layer.id)} />
      <MenuItem label="Dupliquer" shortcut="⌘D" close={close} onRun={() => { editor.select(layer.id); editor.duplicateSelected(); }} />
      <MenuItem label="Ouvrir la composition" disabled={!isPrecomp} close={close} onRun={() => { if (isPrecomp) editor.enterComp(layer.compId); }} />
      <div class="ctx-menu__sep" />
      <MenuItem label="Précomposer la sélection" shortcut="⌘⇧C" close={close} onRun={() => editor.precomposeSelection()} />
      <MenuItem label="Grouper" shortcut="⌘G" close={close} onRun={() => editor.groupSelection()} />
      <div class="ctx-menu__sep" />
      <MenuItem label="Supprimer" danger close={close} onRun={() => editor.deleteSelected()} />
    </div>
  );
}

function LayerRow(props: {
  editor: Editor; layer: Layer; changed: Accessor<unknown>;
  editingId: Accessor<string | null>; setEditingId: (id: string | null) => void;
  multiSet: Accessor<Set<string>>; onRowClick: (e: MouseEvent) => void; onContext: (e: MouseEvent) => void;
}): JSX.Element {
  const { editor, layer, changed } = props;
  const editing = createMemo(() => props.editingId() === layer.id);
  const selected = createMemo(() => { changed(); return editor.selectedId === layer.id || props.multiSet().has(layer.id); });
  const visible = createMemo(() => { changed(); return layer.visible; });
  const additive = createMemo(() => { changed(); return layer.blend === "add"; });
  const opacity = createMemo(() => { changed(); return `${Math.round(layer.opacity * 100)}%`; });
  const name = createMemo(() => { changed(); return layer.name; });
  const glyph = createMemo(() => {
    changed();
    if (layer.type !== "precomp") return layerGlyph(layer);
    const kind = editor.getCompositions()[layer.compId]?.kind;
    return layerGlyph(layer, kind === "prerender" ? "prerender" : "precomp");
  });
  // blend + opacité : affichés seulement pour les calques visuels « feuille » (comme la maquette)
  const showMeta = createMemo(() => ["shader", "shape", "video", "image"].includes(layer.type));

  const [isDragging, setIsDragging] = createSignal(false);
  const [dragOverPos, setDragOverPos] = createSignal<"above" | "below" | null>(null);

  const handleDragStart = (e: DragEvent) => {
    e.stopPropagation();
    e.dataTransfer?.setData("application/x-led-layer-id", layer.id);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
    }
    setTimeout(() => setIsDragging(true), 0);
  };

  const handleDragEnd = (e: DragEvent) => {
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!e.dataTransfer?.types.includes("application/x-led-layer-id")) {
      return;
    }

    const target = e.currentTarget as HTMLElement | null;
    if (!target) return;

    const rect = target.getBoundingClientRect();
    const relY = e.clientY - rect.top;
    const isAbove = relY < rect.height / 2;
    setDragOverPos(isAbove ? "above" : "below");
    e.dataTransfer.dropEffect = "move";
  };

  const handleDragLeave = (e: DragEvent) => {
    e.stopPropagation();
    setDragOverPos(null);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const pos = dragOverPos();
    setDragOverPos(null);

    const draggedId = e.dataTransfer?.getData("application/x-led-layer-id");
    if (!draggedId || draggedId === layer.id) return;

    editor.moveLayer(draggedId, layer.id, pos === "above" ? "before" : "after");
  };

  return (
    <div
      class="layer"
      classList={{
        "layer--selected": selected(),
        "layer--hidden": !visible(),
        "layer--dragging": isDragging(),
        "layer--drag-over-above": dragOverPos() === "above",
        "layer--drag-over-below": dragOverPos() === "below",
      }}
      draggable={true}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={(e) => props.onRowClick(e)}
      onContextMenu={(e) => props.onContext(e)}
      onDblClick={() => {
        // double-clic = ENTRER dans la composition/groupe (le renommage passe par le clic droit).
        if (layer.type === "group") editor.enterGroup(layer.id);
        else if (layer.type === "precomp") editor.enterComp(layer.compId);
      }}
    >
      <span class="layer__glyph">{glyph()}</span>
      <Show
        when={editing()}
        fallback={<div class="layer__name">{name()}</div>}
      >
        <input
          class="layer__name-input"
          value={layer.name}
          ref={(el) => requestAnimationFrame(() => { el.focus(); el.select(); })}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") { editor.setName(layer.id, e.currentTarget.value.trim() || layer.name); props.setEditingId(null); }
            else if (e.key === "Escape") props.setEditingId(null);
          }}
          onBlur={(e) => { editor.setName(layer.id, e.currentTarget.value.trim() || layer.name); props.setEditingId(null); }}
        />
      </Show>
      <Show when={showMeta()}>
        <span class="layer__blend" classList={{ "layer__blend--accent": additive() }}>{additive() ? "ADDITIF" : "NORMAL"}</span>
        <span class="layer__opacity">{opacity()}</span>
      </Show>
      <button
        type="button"
        class="layer__eye"
        onClick={(e) => { e.stopPropagation(); editor.setVisible(layer.id, !layer.visible); }}
      >
        {visible() ? createIcon("eye", { size: 13 }) : createIcon("eye-off", { size: 13 })}
      </button>
    </div>
  );
}

/** Panneau Outliner (unique) : arbre de calques/objets du groupe actif. */
export function createOutlinerPanel(editor: Editor): Panel {
  return solidPanel({
    id: "outliner",
    title: "Outliner",
    modifier: "compositor",
    bodyClass: "compositor",
    header: (header) => {
      const spacer = document.createElement("div");
      spacer.className = "panel__header-spacer";
      const count = document.createElement("span");
      count.className = "outliner__count";
      const sync = () => { count.textContent = `${editor.children.length} calques`; };
      sync();
      editor.subscribe(sync);
      const add = document.createElement("button");
      add.type = "button";
      add.className = "compositor__add";
      add.appendChild(createIcon("plus", { size: 12 }));
      add.addEventListener("click", () => editor.addGroup());
      header.append(spacer, count, add);
    },
    body: () => <LayerTree editor={editor} />,
  });
}

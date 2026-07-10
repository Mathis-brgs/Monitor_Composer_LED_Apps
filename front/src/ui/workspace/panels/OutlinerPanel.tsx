import { createMemo, For, Show, createSignal, type Accessor, type JSX } from "solid-js";
import type { Editor } from "@core/Editor.ts";
import type { Layer } from "@domain/Layer.ts";
import { createIcon } from "@ui/icons/Icon.ts";
import { fromStore } from "@ui/solid/store.ts";
import { solidPanel } from "@ui/solid/mount.ts";
import { subtitle, thumbBg } from "./layer-display.ts";
import type { Panel } from "../Panel.ts";

/** Outliner : arbre du groupe actif. Panneau unique — mêmes données en 2D (compositor) et 3D (scène). */
function LayerTree(props: { editor: Editor }): JSX.Element {
  const editor = props.editor;
  const layers = fromStore(editor, () => editor.children);
  const changed = fromStore(editor, () => editor.selectedId);
  const atRoot = createMemo(() => { changed(); return editor.activeGroupId === editor.rootId; });
  const count = createMemo(() => { changed(); return editor.children.length; });

  return (
    <>
      <div class="comp-bar">
        <Show when={!atRoot()}>
          <button type="button" class="comp-back" onClick={() => editor.exitGroup()}>
            {createIcon("chevron-down", { size: 12 })} Retour
          </button>
        </Show>
        <span class="compositor__count">{count()} calques</span>
      </div>
      <For each={layers()}>
        {(layer) => <LayerRow editor={editor} layer={layer} changed={changed} />}
      </For>
    </>
  );
}

function LayerRow(props: { editor: Editor; layer: Layer; changed: Accessor<unknown> }): JSX.Element {
  const { editor, layer, changed } = props;
  const selected = createMemo(() => { changed(); return editor.selectedId === layer.id; });
  const visible = createMemo(() => { changed(); return layer.visible; });
  const additive = createMemo(() => { changed(); return layer.blend === "add"; });
  const opacity = createMemo(() => { changed(); return `${Math.round(layer.opacity * 100)}%`; });
  const thumb = createMemo(() => { changed(); return thumbBg(layer); });
  const sub = createMemo(() => { changed(); return subtitle(layer); });
  const name = createMemo(() => { changed(); return layer.name; });

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
      onClick={() => editor.select(layer.id)}
      onDblClick={() => { if (layer.type === "group") editor.enterGroup(layer.id); }}
    >
      <button
        type="button"
        class="layer__eye"
        onClick={(e) => {
          e.stopPropagation();
          editor.setVisible(layer.id, !layer.visible);
        }}
      >
        {visible() ? createIcon("eye", { size: 13 }) : createIcon("eye-off", { size: 13 })}
      </button>
      <div class="layer__thumb" style={{ background: thumb() }} />
      <div class="layer__info">
        <div class="layer__name">{name()}</div>
        <div class="layer__type">{sub()}</div>
      </div>
      <div class="layer__meta">
        <div class="layer__blend" classList={{ "layer__blend--accent": additive() }}>
          {additive() ? "Additif" : "Normal"}
        </div>
        <div class="layer__opacity">{opacity()}</div>
      </div>
    </div>
  );
}

/** Panneau Outliner (unique) : arbre de calques/objets du groupe actif. */
export function createOutlinerPanel(editor: Editor): Panel {
  return solidPanel({
    id: "outliner",
    title: "Outliner",
    modifier: "compositor",
    icon: "layers",
    bodyClass: "compositor",
    header: (header) => {
      const spacer = document.createElement("div");
      spacer.className = "panel__header-spacer";
      const add = document.createElement("button");
      add.type = "button";
      add.className = "compositor__add";
      add.appendChild(createIcon("plus", { size: 12 }));
      add.addEventListener("click", () => editor.addGroup());
      header.append(spacer, add);
    },
    body: () => <LayerTree editor={editor} />,
  });
}

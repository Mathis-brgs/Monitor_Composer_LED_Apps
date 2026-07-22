import { createEffect, createMemo, For, Show, createSignal, type Accessor, type JSX } from "solid-js";
import { Portal } from "solid-js/web";
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

  // Sélection multiple (shift = plage, ctrl/cmd = ajout un par un) — locale à l'Outliner, comme
  // la sélection de clés dans la Timeline. `editor.selectedId` (unique) reste la "sélection
  // primaire" pour l'Inspecteur/gizmo 3D ; ce set n'ajoute qu'une couche de sélection groupée
  // pour les actions en masse (supprimer).
  const [multiSelected, setMultiSelected] = createSignal<Set<string>>(new Set());
  const [ctxMenu, setCtxMenu] = createSignal<{ layer: Layer; x: number; y: number } | null>(null);
  const [editingLayerId, setEditingLayerId] = createSignal<string | null>(null);
  let anchorIndex = -1;
  let root!: HTMLDivElement;

  // Une sélection venue d'ailleurs (viewport 3D, clic Timeline...) qui ne fait pas déjà partie
  // du groupe courant réinitialise le groupe sur ce seul calque — évite un surlignage périmé.
  createEffect(() => {
    const id = editor.selectedId;
    changed();
    if (id && !multiSelected().has(id)) setMultiSelected(new Set([id]));
    else if (!id) setMultiSelected(new Set<string>());
  });

  const onRowClick = (e: MouseEvent, layer: Layer, index: number): void => {
    if (e.shiftKey && anchorIndex !== -1) {
      const [a, b] = [anchorIndex, index].sort((x, y) => x - y);
      setMultiSelected(new Set(layers().slice(a, b + 1).map((l) => l.id)));
    } else if (e.metaKey || e.ctrlKey) {
      const n = new Set(multiSelected());
      if (n.has(layer.id)) n.delete(layer.id); else n.add(layer.id);
      setMultiSelected(n);
      anchorIndex = index;
    } else {
      setMultiSelected(new Set([layer.id]));
      anchorIndex = index;
    }
    editor.select(layer.id);
    root.focus();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Delete" && e.key !== "Backspace") return;
    const ids = multiSelected();
    if (ids.size === 0) return;
    e.preventDefault();
    e.stopPropagation(); // évite de déclencher aussi le raccourci Suppr. de la Timeline
    for (const id of ids) editor.deleteLayer(id);
    setMultiSelected(new Set<string>());
  };

  return (
    <div class="layer-tree" ref={root} tabIndex={-1} onKeyDown={onKeyDown}>
      <div class="comp-bar">
        <Show when={!atRoot()}>
          <button type="button" class="comp-back" onClick={() => editor.exitGroup()}>
            {createIcon("chevron-down", { size: 12 })} Retour
          </button>
        </Show>
        <span class="compositor__count">{count()} calques</span>
      </div>
      <For each={layers()}>
        {(layer, i) => (
          <LayerRow
            editor={editor}
            layer={layer}
            multiSelected={multiSelected}
            isEditingName={editingLayerId() === layer.id}
            onRenameComplete={(newName) => {
              if (newName && newName.trim() !== "") {
                editor.setName(layer.id, newName.trim());
              }
              setEditingLayerId(null);
            }}
            onRowClick={(e) => onRowClick(e, layer, i())}
            onRowContextMenu={(e) => setCtxMenu({ layer, x: e.clientX, y: e.clientY })}
          />
        )}
      </For>

      <Show when={ctxMenu()}>
        {(m) => (
          <Portal>
            <div
              class="seq__kf-editor-backdrop"
              onPointerDown={() => setCtxMenu(null)}
              onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
            >
              <div class="seq__ctx-menu" style={{ left: `${m().x}px`, top: `${m().y}px` }} onPointerDown={(e) => e.stopPropagation()}>
                <div class="seq__ctx-title">{m().layer.name}</div>
                
                <button
                  type="button"
                  class="seq__ctx-item"
                  onClick={() => {
                    const id = m().layer.id;
                    setCtxMenu(null);
                    setEditingLayerId(id);
                  }}
                >
                  Renommer
                </button>

                <button
                  type="button"
                  class="seq__ctx-item"
                  onClick={() => {
                    const id = m().layer.id;
                    setCtxMenu(null);
                    editor.duplicateLayer(id);
                  }}
                >
                  Dupliquer
                </button>

                <button
                  type="button"
                  class="seq__ctx-item"
                  onClick={() => {
                    const id = m().layer.id;
                    const visible = m().layer.visible;
                    setCtxMenu(null);
                    editor.setVisible(id, !visible);
                  }}
                >
                  {m().layer.visible ? "Masquer" : "Afficher"}
                </button>

                <button
                  type="button"
                  class="seq__ctx-item"
                  onClick={() => {
                    const id = m().layer.id;
                    const locked = m().layer.locked;
                    setCtxMenu(null);
                    editor.setLocked(id, !locked);
                  }}
                >
                  {m().layer.locked ? "Déverrouiller" : "Verrouiller"}
                </button>

                <button
                  type="button"
                  class="seq__ctx-item"
                  onClick={() => {
                    const id = m().layer.id;
                    const solo = m().layer.solo;
                    setCtxMenu(null);
                    editor.setSolo(id, !solo);
                  }}
                >
                  {m().layer.solo ? "Désactiver le Solo" : "Activer le Solo"}
                </button>

                <button
                  type="button"
                  class="seq__ctx-item"
                  onClick={() => {
                    const id = m().layer.id;
                    const blend = m().layer.blend;
                    setCtxMenu(null);
                    editor.setBlend(id, blend === "add" ? "normal" : "add");
                  }}
                >
                  {m().layer.blend === "add" ? "Mode Normal" : "Mode Additif"}
                </button>

                <div style={{ height: "1px", background: "var(--line)", margin: "4px 0" }} />

                <button
                  type="button"
                  class="seq__ctx-item"
                  style={{ color: "var(--acc)" }}
                  onClick={() => {
                    const id = m().layer.id;
                    setCtxMenu(null);
                    editor.deleteLayer(id);
                  }}
                >
                  Supprimer
                </button>
              </div>
            </div>
          </Portal>
        )}
      </Show>
    </div>
  );
}

function LayerRow(props: {
  editor: Editor; layer: Layer;
  multiSelected: Accessor<Set<string>>; onRowClick: (e: MouseEvent) => void;
  onRowContextMenu: (e: MouseEvent) => void;
  isEditingName: boolean;
  onRenameComplete: (newName: string) => void;
}): JSX.Element {
  const { editor, layer } = props;
  const selected = fromStore(editor, () => editor.selectedId === layer.id || props.multiSelected().has(layer.id));
  const visible = fromStore(editor, () => layer.visible);
  const additive = fromStore(editor, () => layer.blend === "add");
  const opacity = fromStore(editor, () => `${Math.round(layer.opacity * 100)}%`);
  const thumb = fromStore(editor, () => thumbBg(layer));
  const sub = fromStore(editor, () => subtitle(layer));
  const name = fromStore(editor, () => layer.name);
  const locked = fromStore(editor, () => !!layer.locked);
  const solo = fromStore(editor, () => !!layer.solo);

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
        "layer--locked": locked(),
        "layer--solo": solo(),
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
      onDblClick={() => { if (layer.type === "group") editor.enterGroup(layer.id); }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        props.onRowContextMenu(e);
      }}
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
        <Show
          when={props.isEditingName}
          fallback={<div class="layer__name">{name()}</div>}
        >
          <input
            type="text"
            class="layer__name-input"
            value={name()}
            ref={(el) => {
              setTimeout(() => {
                el.focus();
                el.select();
              }, 0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                props.onRenameComplete(e.currentTarget.value);
              } else if (e.key === "Escape") {
                props.onRenameComplete(name());
              }
            }}
            onBlur={(e) => {
              props.onRenameComplete(e.currentTarget.value);
            }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />
        </Show>
        <div class="layer__type">{sub()}</div>
      </div>
      <div class="layer__meta">
        <Show when={solo()}>
          <div class="layer__solo-badge" data-tooltip="Solo actif">
            S
          </div>
        </Show>
        <Show when={locked()}>
          <div class="layer__lock-badge" data-tooltip="Calque verrouillé">
            {createIcon("lock", { size: 11 })}
          </div>
        </Show>
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

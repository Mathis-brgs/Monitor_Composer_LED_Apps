import { Show, type JSX } from "solid-js";
import type { Editor } from "@core/Editor.ts";
import type { GroupLayer, Layer, ShaderLayer, ShapeLayer, Vec3 } from "@domain/Layer.ts";
import { fromStore } from "@ui/solid/store.ts";
import { solidPanel } from "@ui/solid/mount.ts";
import { Checkbox, ColorField, NumberField, Row, Section, Segmented, Slider, TextField } from "@ui/solid/controls.tsx";
import { subtitle, thumbBg } from "./layer-display.ts";
import type { Panel } from "../Panel.ts";

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

type Axis = "x" | "y" | "z";
function axisPatch(axis: Axis, v: number): Partial<Vec3> {
  return axis === "x" ? { x: v } : axis === "y" ? { y: v } : { z: v };
}

/** Trois champs numériques (X/Y/Z) sur une ligne. */
function Vec3Field(props: {
  value: Vec3;
  step: number;
  format?: (v: number) => string;
  onInput: (axis: Axis, v: number) => void;
}): JSX.Element {
  return (
    <div class="insp-fields insp-control">
      <NumberField value={props.value.x} step={props.step} format={props.format} onInput={(v) => props.onInput("x", v)} />
      <NumberField value={props.value.y} step={props.step} format={props.format} onInput={(v) => props.onInput("y", v)} />
      <NumberField value={props.value.z} step={props.step} format={props.format} onInput={(v) => props.onInput("z", v)} />
    </div>
  );
}

/** Inspecteur : props du nœud sélectionné, contextuelles à son type. Reconstruit à la sélection. */
function Inspector(props: { editor: Editor }): JSX.Element {
  const editor = props.editor;
  const selectedId = fromStore(editor, () => editor.selectedId);
  return (
    <Show when={selectedId()} keyed fallback={<div class="insp-empty">Aucune sélection</div>}>
      <NodeBody editor={editor} node={editor.selected} />
    </Show>
  );
}

/** `node` est stable pendant la vie de cette instance (recréée à chaque sélection via `keyed`). */
function NodeBody(props: { editor: Editor; node: Layer | null }): JSX.Element {
  const { editor, node } = props;
  if (!node) return <div class="insp-empty">Aucune sélection</div>;
  return (
    <>
      <ObjectHeader node={node} />
      <Section title="Général">
        <Row label="Nom"><TextField value={node.name} onInput={(v) => editor.setName(node.id, v)} /></Row>
      </Section>
      <Show when={node.type === "shape"}>
        <ShapeBody editor={editor} node={node as ShapeLayer} />
      </Show>
      <Show when={node.type === "shader"}>
        <ShaderBody editor={editor} node={node as ShaderLayer} />
      </Show>
      <Show when={node.type === "group"}>
        <GroupBody editor={editor} node={node as GroupLayer} />
      </Show>
    </>
  );
}

function ShapeBody(props: { editor: Editor; node: ShapeLayer }): JSX.Element {
  const { editor, node } = props;
  const id = node.id;
  const t = node.transform;
  return (
    <>
      <Section title="Transform">
        <Row label="Position">
          <Vec3Field value={t.position} step={0.01} onInput={(a, v) => editor.setTransform(id, { position: axisPatch(a, v) })} />
        </Row>
        <Row label="Rotation">
          <Vec3Field
            value={{ x: t.rotation.x * R2D, y: t.rotation.y * R2D, z: t.rotation.z * R2D }}
            step={1}
            format={(v) => `${v.toFixed(0)}°`}
            onInput={(a, v) => editor.setTransform(id, { rotation: axisPatch(a, v * D2R) })}
          />
        </Row>
        <Row label="Échelle">
          <Vec3Field value={t.scale} step={0.01} onInput={(a, v) => editor.setTransform(id, { scale: axisPatch(a, v) })} />
        </Row>
      </Section>
      <Section title="Apparence">
        <Row label="Couleur"><ColorField value={node.color} onInput={(c) => editor.setColor(id, c)} /></Row>
        <Row label="Opacité">
          <Slider value={node.opacity} format={(v) => `${Math.round(v * 100)}%`} onInput={(v) => editor.setOpacity(id, v)} />
        </Row>
        <Row label="Helper"><Checkbox checked={node.showHelper} onChange={(v) => editor.setShowHelper(id, v)} /></Row>
      </Section>
    </>
  );
}

function ShaderBody(props: { editor: Editor; node: ShaderLayer }): JSX.Element {
  const { editor, node } = props;
  const id = node.id;
  return (
    <Section title={node.name}>
      <Show when={node.shader === "plasma"}>
        <Row label="Vitesse"><Slider value={node.params.speed ?? 0} onInput={(v) => editor.setParam(id, "speed", v)} /></Row>
        <Row label="Détail"><Slider value={node.params.detail ?? 0} onInput={(v) => editor.setParam(id, "detail", v)} /></Row>
        <Row label="Contraste"><Slider value={node.params.contrast ?? 0} onInput={(v) => editor.setParam(id, "contrast", v)} /></Row>
      </Show>
      <Show when={node.shader === "solid"}>
        <Row label="Couleur"><ColorField value={node.color} onInput={(c) => editor.setColor(id, c)} /></Row>
      </Show>
      <Row label="Fusion">
        <Segmented
          options={["Normal", "Additif"]}
          active={node.blend === "add" ? 1 : 0}
          onChange={(i) => editor.setBlend(id, i === 1 ? "add" : "normal")}
        />
      </Row>
      <Row label="Opacité">
        <Slider value={node.opacity} format={(v) => `${Math.round(v * 100)}%`} onInput={(v) => editor.setOpacity(id, v)} />
      </Row>
    </Section>
  );
}

function GroupBody(props: { editor: Editor; node: GroupLayer }): JSX.Element {
  const { editor, node } = props;
  const id = node.id;
  return (
    <Section title="Groupe">
      <Row label="Calques"><div class="insp-field insp-control">{`${node.children.length}`}</div></Row>
      <Row label="Fusion">
        <Segmented
          options={["Normal", "Additif"]}
          active={node.blend === "add" ? 1 : 0}
          onChange={(i) => editor.setBlend(id, i === 1 ? "add" : "normal")}
        />
      </Row>
      <Row label="Opacité">
        <Slider value={node.opacity} format={(v) => `${Math.round(v * 100)}%`} onInput={(v) => editor.setOpacity(id, v)} />
      </Row>
    </Section>
  );
}

function ObjectHeader(props: { node: Layer }): JSX.Element {
  return (
    <div class="insp-object">
      <div class="insp-object__thumb" style={{ background: thumbBg(props.node) }} />
      <div class="insp-object__info">
        <div class="insp-object__name">{props.node.name}</div>
        <div class="insp-object__sub">{subtitle(props.node)}</div>
      </div>
    </div>
  );
}

/** Fabrique du panneau Inspecteur (coquille + header à onglets + racine Solid). */
export function createInspectorPanel(editor: Editor): Panel {
  return solidPanel({
    id: "inspector",
    title: "Inspecteur",
    modifier: "inspector",
    bodyClass: "inspector",
    header: (header) => {
      const spacer = document.createElement("div");
      spacer.className = "panel__header-spacer";
      const props = document.createElement("span");
      props.className = "insp-tab insp-tab--active";
      props.textContent = "Propriétés";
      const obj = document.createElement("span");
      obj.className = "insp-tab";
      obj.textContent = "Objet";
      header.append(spacer, props, obj);
    },
    body: () => <Inspector editor={editor} />,
  });
}

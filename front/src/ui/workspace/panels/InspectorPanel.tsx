import { createMemo, createSignal, For, Show, type Accessor, type JSX } from "solid-js";
import type { Editor } from "@core/Editor.ts";
import type { Fill, GroupLayer, Layer, LyreLayer, MaterialMode, RGB, ShaderLayer, ShapeLayer, SpotLayer, Vec3 } from "@domain/Layer.ts";
import { fromStore } from "@ui/solid/store.ts";
import { solidPanel } from "@ui/solid/mount.ts";
import { Checkbox, ColorField, MediaField, NumberField, Row, Section, Segmented, Slider, TextField } from "@ui/solid/controls.tsx";
import { subtitle, thumbBg } from "./layer-display.ts";
import type { Panel } from "../Panel.ts";

const R2D = 180 / Math.PI;
const D2R = Math.PI / 180;

type Axis = "x" | "y" | "z";
function axisPatch(axis: Axis, v: number): Partial<Vec3> {
  return axis === "x" ? { x: v } : axis === "y" ? { y: v } : { z: v };
}

/** Diamant d'animation d'une propriété (groupe de canaux) : plein si animée, clic = toggle. */
function KeyDot(props: { editor: Editor; id: string; channels: string[] }): JSX.Element {
  const on = fromStore(props.editor, () => props.channels.some((c) => props.editor.isAnimated(props.id, c)));
  return (
    <div
      class="key-dot"
      classList={{ "key-dot--on": on() }}
      title="Animer cette propriété (keyframe au frame courant)"
      onClick={() => props.editor.toggleAnimated(props.id, props.channels)}
    />
  );
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

/** Sélecteur de parent (transform hérité) : « Aucun » + les autres calques du groupe actif. */
function ParentField(props: { editor: Editor; node: Layer; changed: Accessor<unknown> }): JSX.Element {
  const { editor, node, changed } = props;
  const options = createMemo(() => { changed(); return editor.children.filter((l) => l.id !== node.id); });
  const current = createMemo(() => { changed(); return node.parentId ?? ""; });
  return (
    <select
      class="insp-field insp-field--editable insp-control insp-select"
      value={current()}
      onChange={(e) => {
        editor.setParent(node.id, e.currentTarget.value || null);
        e.currentTarget.value = node.parentId ?? ""; // resync si refusé (cycle)
      }}
    >
      <option value="">Aucun</option>
      <For each={options()}>
        {(l) => <option value={l.id}>{l.name}</option>}
      </For>
    </select>
  );
}

/** Association « groupé sous un média » : le calque n'est actif que dans la fenêtre du média parent. */
function MediaGroupField(props: { editor: Editor; node: Layer; changed: Accessor<unknown> }): JSX.Element {
  const { editor, node, changed } = props;
  const options = createMemo(() => { changed(); return editor.children.filter((l) => (l.type === "audio" || l.type === "video") && l.id !== node.id); });
  const current = createMemo(() => { changed(); return node.mediaGroupId ?? ""; });
  return (
    <select
      class="insp-field insp-field--editable insp-control insp-select"
      value={current()}
      onChange={(e) => editor.setMediaGroup(node.id, e.currentTarget.value || undefined)}
    >
      <option value="">Aucun</option>
      <For each={options()}>
        {(l) => <option value={l.id}>{l.name}</option>}
      </For>
    </select>
  );
}

/** Inspecteur : props du nœud sélectionné, contextuelles à son type. Reconstruit à la sélection. */
function Inspector(props: { editor: Editor }): JSX.Element {
  const editor = props.editor;
  const selectedId = fromStore(editor, () => editor.selectedId);
  return (
    <Show when={selectedId()} keyed fallback={<div class="insp-empty">Aucune sélection</div>}>
      {/* `selectedId` sert aussi de "ping" de changement (fromStore : équivaut toujours à changé) — passé
          en `changed` pour que les champs puissent se resynchroniser sur des éditions externes (gizmo 3D). */}
      <NodeBody editor={editor} node={editor.selected} changed={selectedId} />
    </Show>
  );
}

/** `node` est stable pendant la vie de cette instance (recréée à chaque sélection via `keyed`). */
function NodeBody(props: { editor: Editor; node: Layer | null; changed: Accessor<unknown> }): JSX.Element {
  const { editor, node, changed } = props;
  if (!node) return <div class="insp-empty">Aucune sélection</div>;
  return (
    <>
      <ObjectHeader node={node} />
      <Section title="Général">
        <Row label="Nom"><TextField value={node.name} onInput={(v) => editor.setName(node.id, v)} /></Row>
        <Row label="Parent"><ParentField editor={editor} node={node} changed={changed} /></Row>
        <Show when={node.type !== "audio" && node.type !== "video"}>
          <Row label="Groupe média"><MediaGroupField editor={editor} node={node} changed={changed} /></Row>
        </Show>
      </Section>
      <Show when={node.type === "shape"}>
        <ShapeBody editor={editor} node={node as ShapeLayer} changed={changed} />
      </Show>
      <Show when={node.type === "shader"}>
        <ShaderBody editor={editor} node={node as ShaderLayer} />
      </Show>
      <Show when={node.type === "group"}>
        <GroupBody editor={editor} node={node as GroupLayer} />
      </Show>
      <Show when={node.type === "spot"}>
        <SpotBody editor={editor} node={node as SpotLayer} changed={changed} />
      </Show>
      <Show when={node.type === "lyre"}>
        <LyreBody editor={editor} node={node as LyreLayer} changed={changed} />
      </Show>
    </>
  );
}

/** Slider pour un canal DMX brut (0-255) : la valeur affichée/renvoyée est l'octet, pas le 0..1 normalisé. */
function ByteSlider(props: { value: number; onInput: (v: number) => void }): JSX.Element {
  return (
    <Slider
      value={props.value / 255}
      format={(v) => `${Math.round(v * 255)}`}
      onInput={(v) => props.onInput(Math.round(v * 255))}
    />
  );
}

const DEFAULT_FILL_COLOR: RGB = { r: 1, g: 0.541, b: 0.239 };
const FILL_TYPES: Fill["type"][] = ["solid", "gradient", "image", "video", "material"];
const FILL_LABELS: Record<Fill["type"], string> = { solid: "Couleur", gradient: "Dégradé", image: "Image", video: "Vidéo", material: "Matériau" };
const MATERIAL_MODES: MaterialMode[] = ["basic", "emission"];

/**
 * Champs du remplissage d'une shape, contextuels au type courant. Signal local
 * (comme `ColorField`/`Slider` du reste de l'inspecteur) : `node.fill` n'est pas
 * réactif en lecture, donc changer de type de remplissage doit mettre à jour cet
 * état local pour que les champs correspondants s'affichent immédiatement.
 */
function FillFields(props: { editor: Editor; id: string; fill: Fill }): JSX.Element {
  const { editor, id } = props;
  const [fill, setFill] = createSignal(props.fill);
  const emit = (next: Fill): void => {
    setFill(next);
    editor.setFill(id, next);
  };
  const asSolid = () => fill() as Extract<Fill, { type: "solid" }>;
  const asGradient = () => fill() as Extract<Fill, { type: "gradient" }>;
  const asImage = () => fill() as Extract<Fill, { type: "image" }>;
  const asVideo = () => fill() as Extract<Fill, { type: "video" }>;
  const asMaterial = () => fill() as Extract<Fill, { type: "material" }>;
  return (
    <>
      <Row label="Remplissage">
        <select
          class="insp-text insp-control"
          value={fill().type}
          onChange={(e) => {
            const type = (e.currentTarget as HTMLSelectElement).value as Fill["type"];
            if (type === "solid") emit({ type, color: DEFAULT_FILL_COLOR });
            else if (type === "gradient") emit({ type, from: DEFAULT_FILL_COLOR, to: { r: 0.11, g: 0.055, b: 0.024 }, angle: 0 });
            else if (type === "material") {
              const existing = editor.listMaterialPresets()[0];
              const presetId = existing ? existing.id : editor.addMaterialPreset(`Matériau ${editor.listMaterialPresets().length + 1}`);
              emit({ type, presetId });
            }
            else emit({ type, dataUrl: "" });
          }}
        >
          <For each={FILL_TYPES}>{(t) => <option value={t}>{FILL_LABELS[t]}</option>}</For>
        </select>
      </Row>
      <Show when={fill().type === "solid"}>
        <Row label="Couleur">
          <ColorField value={asSolid().color} onInput={(c) => emit({ type: "solid", color: c })} />
          <KeyDot editor={editor} id={id} channels={["color.r", "color.g", "color.b"]} />
        </Row>
      </Show>
      <Show when={fill().type === "gradient"}>
        <Row label="Couleur A"><ColorField value={asGradient().from} onInput={(c) => emit({ ...asGradient(), from: c })} /></Row>
        <Row label="Couleur B"><ColorField value={asGradient().to} onInput={(c) => emit({ ...asGradient(), to: c })} /></Row>
        <Row label="Angle">
          <Slider
            value={(asGradient().angle / (Math.PI * 2)) % 1}
            format={(v) => `${Math.round(v * 360)}°`}
            onInput={(v) => emit({ ...asGradient(), angle: v * Math.PI * 2 })}
          />
        </Row>
      </Show>
      <Show when={fill().type === "image"}>
        <Row label="Image">
          <MediaField kind="image" value={asImage().dataUrl || undefined} onInput={(dataUrl) => emit({ type: "image", dataUrl })} />
        </Row>
      </Show>
      <Show when={fill().type === "video"}>
        <Row label="Vidéo">
          <MediaField kind="video" value={asVideo().dataUrl || undefined} onInput={(dataUrl) => emit({ type: "video", dataUrl })} />
        </Row>
      </Show>
      <Show when={fill().type === "material"}>
        <MaterialFields editor={editor} presetId={asMaterial().presetId} onRelink={(presetId) => emit({ type: "material", presetId })} />
      </Show>
    </>
  );
}

/**
 * Champs d'un matériau personnalisé : nom + preset (lié à un preset existant du document ou
 * nouveau), mode (Basic/Émission — jamais de "Standard"/PBR, le mur est un afficheur, pas une
 * scène éclairée) et fragment TSL. Le fragment est rebaké (async, hors-écran) à chaque édition
 * validée — voir `Editor.updateMaterialPreset`/`MaterialBaker`.
 */
function MaterialFields(props: { editor: Editor; presetId: string; onRelink: (presetId: string) => void }): JSX.Element {
  const { editor } = props;
  const presets = fromStore(editor, () => editor.listMaterialPresets());
  const current = () => presets().find((p) => p.id === props.presetId);
  return (
    <Show when={current()}>
      {(preset) => (
        <>
          <Row label="Nom">
            <TextField value={preset().name} onInput={(name) => editor.updateMaterialPreset(preset().id, { name })} />
          </Row>
          <Row label="Preset">
            <select
              class="insp-text insp-control"
              value={preset().id}
              onChange={(e) => props.onRelink((e.currentTarget as HTMLSelectElement).value)}
            >
              <For each={presets()}>{(p) => <option value={p.id}>{p.name}</option>}</For>
            </select>
          </Row>
          <Row label="">
            <button
              type="button"
              class="btn"
              onClick={() => props.onRelink(editor.addMaterialPreset(`Matériau ${presets().length + 1}`))}
            >
              Nouveau preset
            </button>
          </Row>
          <Row label="Mode">
            <Segmented
              options={["Basic", "Émission"]}
              active={MATERIAL_MODES.indexOf(preset().mode)}
              onChange={(i) => editor.updateMaterialPreset(preset().id, { mode: MATERIAL_MODES[i] })}
            />
          </Row>
          <Row label="Fragment (TSL)">
            <textarea
              class="insp-code"
              value={preset().fragment}
              spellcheck={false}
              onChange={(e) => editor.updateMaterialPreset(preset().id, { fragment: (e.currentTarget as HTMLTextAreaElement).value })}
            />
          </Row>
        </>
      )}
    </Show>
  );
}

/**
 * `node.transform` est mutable et pas réactif en lecture directe : sans ces memos,
 * un changement fait ailleurs (gizmo 3D, outils du viewport) ne se reflèterait pas
 * ici tant que la sélection ne change pas (même mécanisme que le fix Outliner : on
 * accroche `changed()` pour forcer la relecture à chaque émission de l'éditeur).
 */
function ShapeBody(props: { editor: Editor; node: ShapeLayer; changed: Accessor<unknown> }): JSX.Element {
  const { editor, node, changed } = props;
  const id = node.id;
  const position = createMemo(() => { changed(); return node.transform.position; });
  const rotation = createMemo(() => { changed(); return node.transform.rotation; });
  const scale = createMemo(() => { changed(); return node.transform.scale; });
  return (
    <>
      <Section title="Transform">
        <Row label="Position">
          <Vec3Field value={position()} step={0.01} onInput={(a, v) => editor.setTransform(id, { position: axisPatch(a, v) })} />
          <KeyDot editor={editor} id={id} channels={["position.x", "position.y", "position.z"]} />
        </Row>
        <Row label="Rotation">
          <Vec3Field
            value={{ x: rotation().x * R2D, y: rotation().y * R2D, z: rotation().z * R2D }}
            step={1}
            format={(v) => `${v.toFixed(0)}°`}
            onInput={(a, v) => editor.setTransform(id, { rotation: axisPatch(a, v * D2R) })}
          />
          <KeyDot editor={editor} id={id} channels={["rotation.x", "rotation.y", "rotation.z"]} />
        </Row>
        <Row label="Échelle">
          <Vec3Field value={scale()} step={0.01} onInput={(a, v) => editor.setTransform(id, { scale: axisPatch(a, v) })} />
          <KeyDot editor={editor} id={id} channels={["scale.x", "scale.y", "scale.z"]} />
        </Row>
      </Section>
      <Section title="Apparence">
        <FillFields editor={editor} id={id} fill={node.fill} />
        <Row label="Opacité">
          <Slider value={node.opacity} format={(v) => `${Math.round(v * 100)}%`} onInput={(v) => editor.setOpacity(id, v)} />
          <KeyDot editor={editor} id={id} channels={["opacity"]} />
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
        <Row label="Vitesse">
          <Slider value={node.params.speed ?? 0} onInput={(v) => editor.setParam(id, "speed", v)} />
          <KeyDot editor={editor} id={id} channels={["param.speed"]} />
        </Row>
        <Row label="Détail">
          <Slider value={node.params.detail ?? 0} onInput={(v) => editor.setParam(id, "detail", v)} />
          <KeyDot editor={editor} id={id} channels={["param.detail"]} />
        </Row>
        <Row label="Contraste">
          <Slider value={node.params.contrast ?? 0} onInput={(v) => editor.setParam(id, "contrast", v)} />
          <KeyDot editor={editor} id={id} channels={["param.contrast"]} />
        </Row>
      </Show>
      <Show when={node.shader === "solid"}>
        <Row label="Couleur">
          <ColorField value={node.color} onInput={(c) => editor.setColor(id, c)} />
          <KeyDot editor={editor} id={id} channels={["color.r", "color.g", "color.b"]} />
        </Row>
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
        <KeyDot editor={editor} id={id} channels={["opacity"]} />
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

/** Bouton de suppression, commun aux fixtures (spot/lyre supprimables comme tout calque). */
function DeleteRow(props: { editor: Editor; id: string }): JSX.Element {
  return (
    <Row label=" ">
      <button type="button" class="insp-danger insp-control" onClick={() => props.editor.deleteLayer(props.id)}>
        Supprimer
      </button>
    </Row>
  );
}

/** Projecteur statique (doc prof) : position = repère visuel seul, pas de calcul sur le mur. */
function SpotBody(props: { editor: Editor; node: SpotLayer; changed: Accessor<unknown> }): JSX.Element {
  const { editor, node, changed } = props;
  const id = node.id;
  const position = createMemo(() => { changed(); return node.transform.position; });
  const baseChannel = createMemo(() => { changed(); return node.baseChannel; });
  const channels = createMemo(() => { changed(); return node.channels; });
  return (
    <>
      <Section title="Position (repère visuel)">
        <Row label="Position">
          <Vec3Field value={position()} step={0.01} onInput={(a, v) => editor.setTransform(id, { position: axisPatch(a, v) })} />
        </Row>
      </Section>
      <Section title="Adressage DMX">
        <Row label="Canal base">
          <NumberField value={baseChannel()} step={1} format={(v) => `${Math.round(v)}`} onInput={(v) => editor.setFixtureBaseChannel(id, v)} />
        </Row>
        <Row label=""><div class="insp-hint">Canaux {baseChannel()}-{baseChannel() + 3} : R, G, B, W</div></Row>
      </Section>
      <Section title="Couleur">
        <Row label="Couleur">
          <ColorField
            value={{ r: channels().r / 255, g: channels().g / 255, b: channels().b / 255 }}
            onInput={(c) => editor.setSpotChannels(id, { r: Math.round(c.r * 255), g: Math.round(c.g * 255), b: Math.round(c.b * 255) })}
          />
          <KeyDot editor={editor} id={id} channels={["fx.r", "fx.g", "fx.b"]} />
        </Row>
        <Row label="Blanc">
          <ByteSlider value={channels().w} onInput={(v) => editor.setSpotChannels(id, { w: v })} />
          <KeyDot editor={editor} id={id} channels={["fx.w"]} />
        </Row>
      </Section>
      <Section title="Danger"><DeleteRow editor={editor} id={id} /></Section>
    </>
  );
}

/** Lyre (13 canaux DMX bruts). */
function LyreBody(props: { editor: Editor; node: LyreLayer; changed: Accessor<unknown> }): JSX.Element {
  const { editor, node, changed } = props;
  const id = node.id;
  const position = createMemo(() => { changed(); return node.transform.position; });
  const baseChannel = createMemo(() => { changed(); return node.baseChannel; });
  const channels = createMemo(() => { changed(); return node.channels; });
  const set = (patch: Partial<LyreLayer["channels"]>): void => editor.setLyreChannels(id, patch);
  return (
    <>
      <Section title="Position (repère visuel)">
        <Row label="Position">
          <Vec3Field value={position()} step={0.01} onInput={(a, v) => editor.setTransform(id, { position: axisPatch(a, v) })} />
        </Row>
      </Section>
      <Section title="Adressage DMX">
        <Row label="Canal base">
          <NumberField value={baseChannel()} step={1} format={(v) => `${Math.round(v)}`} onInput={(v) => editor.setFixtureBaseChannel(id, v)} />
        </Row>
        <Row label=""><div class="insp-hint">Bloc de 13 canaux : {baseChannel()}-{baseChannel() + 12}</div></Row>
      </Section>
      <Section title="Mouvement">
        <Row label="Pan">
          <ByteSlider value={channels().pan} onInput={(v) => set({ pan: v })} />
          <KeyDot editor={editor} id={id} channels={["fx.pan"]} />
        </Row>
        <Row label="Pan fin">
          <ByteSlider value={channels().panFine} onInput={(v) => set({ panFine: v })} />
          <KeyDot editor={editor} id={id} channels={["fx.panFine"]} />
        </Row>
        <Row label="Tilt">
          <ByteSlider value={channels().tilt} onInput={(v) => set({ tilt: v })} />
          <KeyDot editor={editor} id={id} channels={["fx.tilt"]} />
        </Row>
        <Row label="Tilt fin">
          <ByteSlider value={channels().tiltFine} onInput={(v) => set({ tiltFine: v })} />
          <KeyDot editor={editor} id={id} channels={["fx.tiltFine"]} />
        </Row>
        <Row label="Vitesse">
          <ByteSlider value={channels().speed} onInput={(v) => set({ speed: v })} />
          <KeyDot editor={editor} id={id} channels={["fx.speed"]} />
        </Row>
      </Section>
      <Section title="Couleur & effets">
        <Row label="Dimmer">
          <ByteSlider value={channels().dimmer} onInput={(v) => set({ dimmer: v })} />
          <KeyDot editor={editor} id={id} channels={["fx.dimmer"]} />
        </Row>
        <Row label="Strobe">
          <ByteSlider value={channels().strobe} onInput={(v) => set({ strobe: v })} />
          <KeyDot editor={editor} id={id} channels={["fx.strobe"]} />
        </Row>
        <Row label="Couleur">
          <ColorField
            value={{ r: channels().r / 255, g: channels().g / 255, b: channels().b / 255 }}
            onInput={(c) => set({ r: Math.round(c.r * 255), g: Math.round(c.g * 255), b: Math.round(c.b * 255) })}
          />
          <KeyDot editor={editor} id={id} channels={["fx.r", "fx.g", "fx.b"]} />
        </Row>
        <Row label="Blanc">
          <ByteSlider value={channels().w} onInput={(v) => set({ w: v })} />
          <KeyDot editor={editor} id={id} channels={["fx.w"]} />
        </Row>
        <Row label="Spécial">
          <ByteSlider value={channels().special} onInput={(v) => set({ special: v })} />
          <KeyDot editor={editor} id={id} channels={["fx.special"]} />
        </Row>
        <Row label="Reset">
          <ByteSlider value={channels().reset} onInput={(v) => set({ reset: v })} />
          <KeyDot editor={editor} id={id} channels={["fx.reset"]} />
        </Row>
      </Section>
      <Section title="Danger"><DeleteRow editor={editor} id={id} /></Section>
    </>
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
      header.append(spacer, props);
    },
    body: () => <Inspector editor={editor} />,
  });
}

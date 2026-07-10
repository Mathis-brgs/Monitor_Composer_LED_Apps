import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LineBasicNodeMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WireframeGeometry,
  type BufferGeometry,
  type Texture,
  type WebGPURenderer,
} from "three/webgpu";
import { positionWorld, texture } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Editor } from "@core/Editor.ts";
import { fillPreviewColor, type ShapeKind, type ShapeLayer } from "@domain/Layer.ts";
import { LED_FILL } from "@core/engine/led.ts";

const N = 128;
const HALF = 1;
const PITCH = (2 * HALF) / (N - 1);      // espacement entre LEDs
const LED_RADIUS = (PITCH * LED_FILL) / 2; // rayon physique d'une LED
const ACCENT = new Color(0xff8a3d);
const HELPER_DIM = 0.28;  // opacité des helpers non sélectionnés (discrets)
const HELPER_LIT = 0.9;   // opacité du helper sélectionné
const CLICK_PX = 5;       // tolérance clic vs drag (sélection au clic)

export type OrientAxis = "x" | "y" | "z" | "-x" | "-y" | "-z";

// setColors existe en JS (three r0.180) mais pas encore dans les .d.ts de l'addon.
interface GizmoColors { setColors(x: string, y: string, z: string, active: string): void; }

/** Géométrie unité d'une primitive (le collider CPU partage la même convention d'axes/tailles). */
function unitGeometry(kind: ShapeKind): BufferGeometry {
  switch (kind) {
    case "sphere": return new SphereGeometry(1, 22, 14);
    case "box": return new BoxGeometry(2, 2, 2);
    case "cylinder": return new CylinderGeometry(1, 1, 2, 28);
    case "cone": return new ConeGeometry(1, 2, 28);
    case "plane": return new PlaneGeometry(2, 2);
    case "torus": return new TorusGeometry(0.7, 0.3, 12, 32);
  }
}

/**
 * Éditeur 3D : reflet du rendu — le mur est une grille de LEDs (sphères instanciées sur un plan
 * segmenté), + helpers wireframe des objets, gizmo de transform et sélection au clic (raycast).
 */
export class Editor3DScene {
  private readonly _renderer: WebGPURenderer;
  private readonly _editor: Editor;
  private readonly _scene = new Scene();
  private readonly _camera = new PerspectiveCamera(50, 1, 0.1, 100);
  private readonly _controls: OrbitControls;
  private readonly _gizmo: TransformControls;
  private readonly _proxy = new Object3D();
  private readonly _objects = new Group();   // helpers wireframe (visibles + showHelper)
  private readonly _picks = new Group();      // cibles de raycast (invisibles), une par shape visible
  private readonly _pickMat: MeshBasicNodeMaterial;
  private readonly _leds: InstancedMesh;
  private readonly _raycaster = new Raycaster();
  private readonly _ndc = new Vector2();
  private readonly _unsub: () => void;
  private readonly _onKey: (e: KeyboardEvent) => void;
  private readonly _onDown: (e: PointerEvent) => void;
  private readonly _onUp: (e: PointerEvent) => void;
  private _dragging = false;
  private _downX = 0;
  private _downY = 0;
  private _aspect = 0;

  constructor(renderer: WebGPURenderer, editor: Editor, engineTexture: Texture) {
    this._renderer = renderer;
    this._editor = editor;
    this._scene.background = new Color(0x0a0908);

    this._camera.position.set(1.7, 1.15, 2.6);
    this._controls = new OrbitControls(this._camera, renderer.domElement);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.08;
    this._controls.target.set(0, 0, 0);

    // Géométrie de base du mur = plan segmenté 128×128 (demain : sphère/cube → LEDs suivent).
    const base = new PlaneGeometry(2 * HALF, 2 * HALF, N - 1, N - 1);
    const pos = base.attributes.position;
    const count = pos.count; // 128×128 = 16384 LEDs

    // Une petite sphère instanciée par point ; couleur = rendu échantillonné à sa position monde.
    const ledGeo = new SphereGeometry(LED_RADIUS, 6, 4);
    const ledMat = new MeshBasicNodeMaterial();
    ledMat.colorNode = texture(engineTexture, positionWorld.xy.mul(0.5).add(0.5));
    this._leds = new InstancedMesh(ledGeo, ledMat, count);
    const m = new Matrix4();
    for (let i = 0; i < count; i++) {
      m.makeTranslation(pos.getX(i), pos.getY(i), pos.getZ(i));
      this._leds.setMatrixAt(i, m);
    }
    this._leds.instanceMatrix.needsUpdate = true;
    base.dispose();
    this._scene.add(this._leds);

    const frame = new LineSegments(
      new WireframeGeometry(new PlaneGeometry(2 * HALF, 2 * HALF)),
      lineMaterial(0x4a3f37),
    );
    this._scene.add(frame);
    this._scene.add(this._objects);

    // Cibles de raycast : maillages pleins invisibles (une par shape), jamais rendus.
    this._pickMat = new MeshBasicNodeMaterial();
    this._pickMat.colorWrite = false;
    this._pickMat.depthWrite = false;
    this._scene.add(this._picks);

    // Gizmo de transform : accroché à un proxy positionné sur l'objet sélectionné.
    this._scene.add(this._proxy);
    this._gizmo = new TransformControls(this._camera, renderer.domElement);
    this._gizmo.setSpace("local");
    this._applyGizmoColors(); // poignées aux couleurs d'axes du HUD (X=accent, Y vert, Z bleu)
    this._gizmo.addEventListener("dragging-changed", (e) => {
      this._dragging = e.value as boolean;
      this._controls.enabled = !this._dragging;
    });
    this._gizmo.addEventListener("objectChange", () => this._commitGizmo());
    this._scene.add(this._gizmo.getHelper());

    // g/r/s = outil déplacer/tourner/échelle ; Échap = curseur. Ignore si on tape dans un champ.
    this._onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "g") this._editor.setTool("translate");
      else if (e.key === "r") this._editor.setTool("rotate");
      else if (e.key === "s") this._editor.setTool("scale");
      else if (e.key === "Escape") this._editor.setTool("select");
      else if (e.key === "Delete" || e.key === "Del") {
        this._editor.deleteSelected();
      }
    };
    window.addEventListener("keydown", this._onKey);

    // Sélection au clic (raycast) : on distingue un clic d'un drag d'orbite / gizmo.
    const dom = renderer.domElement;
    this._onDown = (e: PointerEvent): void => { this._downX = e.clientX; this._downY = e.clientY; };
    this._onUp = (e: PointerEvent): void => this._pick(e);
    dom.addEventListener("pointerdown", this._onDown);
    dom.addEventListener("pointerup", this._onUp);

    this._unsub = editor.subscribe(() => this._rebuild());
    this._rebuild();
  }

  render(): void {
    const el = this._renderer.domElement;
    const aspect = el.clientHeight > 0 ? el.clientWidth / el.clientHeight : 1;
    if (aspect !== this._aspect) {
      this._aspect = aspect;
      this._camera.aspect = aspect;
      this._camera.updateProjectionMatrix();
    }
    this._controls.update();
    this._renderer.setRenderTarget(null);
    this._renderer.render(this._scene, this._camera);
  }

  /** Caméra active (le HUD lit son orientation / fov). */
  get camera(): PerspectiveCamera { return this._camera; }

  /** Recadre la caméra le long d'un axe (gizmo d'orientation), en gardant la distance à la cible. */
  snapView(axis: OrientAxis): void {
    const target = this._controls.target;
    const dist = Math.max(0.5, this._camera.position.distanceTo(target));
    const dir = new Vector3(
      axis === "x" ? 1 : axis === "-x" ? -1 : 0,
      axis === "y" ? 1 : axis === "-y" ? -1 : 0,
      axis === "z" ? 1 : axis === "-z" ? -1 : 0,
    );
    this._camera.position.copy(target).addScaledVector(dir, dist);
    this._camera.up.set(0, 1, 0);
    this._camera.lookAt(target);
    this._controls.update();
  }

  dispose(): void {
    this._unsub();
    window.removeEventListener("keydown", this._onKey);
    const dom = this._renderer.domElement;
    dom.removeEventListener("pointerdown", this._onDown);
    dom.removeEventListener("pointerup", this._onUp);
    this._clearGroup(this._objects);
    this._clearGroup(this._picks);
    this._pickMat.dispose();
    this._gizmo.detach();
    this._gizmo.dispose();
    this._controls.dispose();
    this._leds.geometry.dispose();
    (this._leds.material as MeshBasicNodeMaterial).dispose();
  }

  // ————————————————————————————————— Interne —————————————————————————————————

  /** Recolore les poignées du gizmo aux couleurs d'axes de la DA (mêmes tokens que le HUD). */
  private _applyGizmoColors(): void {
    const css = getComputedStyle(document.documentElement);
    const col = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
    (this._gizmo as unknown as GizmoColors).setColors(
      col("--acc", "#ff8a3d"), // X suit l'accent (--axis-x = var(--acc))
      col("--axis-y", "#7fd88a"),
      col("--axis-z", "#5a9bff"),
      "#ffffff", // poignée survolée / axe actif
    );
  }

  private _rebuild(): void {
    const selectedId = this._editor.selectedId;
    this._clearGroup(this._objects);
    this._clearGroup(this._picks);

    for (const l of this._editor.children) {
      if (l.type !== "shape") continue;
      const s = l as ShapeLayer;
      if (!s.visible) continue;

      // cible de raycast : volume plein invisible (même si le helper est masqué)
      const pickGeo = unitGeometry(s.shape);
      const pick = new Mesh(pickGeo, this._pickMat);
      applyTransform(pick, s);
      pick.userData.id = s.id;
      this._picks.add(pick);

      if (!s.showHelper) continue; // helper caché → pas de wireframe (mais toujours sélectionnable)

      const selected = s.id === selectedId;
      const unit = unitGeometry(s.shape);
      const wf = new WireframeGeometry(unit);
      const preview = fillPreviewColor(s.fill);
      const color = selected ? ACCENT : new Color(preview.r, preview.g, preview.b);
      const mesh = new LineSegments(wf, helperMaterial(color, selected ? HELPER_LIT : HELPER_DIM));
      applyTransform(mesh, s);
      this._objects.add(mesh);
      unit.dispose();
    }
    this._syncGizmo();
  }

  /** positionne le proxy sur l'objet sélectionné et (dé)tache le gizmo selon l'outil (hors drag). */
  private _syncGizmo(): void {
    if (this._dragging) return;
    const sel = this._editor.selected;
    const tool = this._editor.tool;
    const active = tool !== "select" && sel !== null && sel.type === "shape" && sel.visible;
    if (active && sel) {
      const t = sel.transform;
      this._proxy.position.set(t.position.x, t.position.y, t.position.z);
      this._proxy.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z);
      this._proxy.scale.set(t.scale.x, t.scale.y, t.scale.z);
      this._gizmo.setMode(tool);
      if (this._gizmo.object !== this._proxy) this._gizmo.attach(this._proxy);
    } else {
      this._gizmo.detach();
    }
  }

  /** drag du gizmo → écrit le transform dans le store (qui met à jour wireframe + collision). */
  private _commitGizmo(): void {
    const sel = this._editor.selected;
    if (!sel || sel.type !== "shape") return;
    const p = this._proxy;
    this._editor.setTransform(sel.id, {
      position: { x: p.position.x, y: p.position.y, z: p.position.z },
      rotation: { x: p.rotation.x, y: p.rotation.y, z: p.rotation.z },
      scale: { x: p.scale.x, y: p.scale.y, z: p.scale.z },
    });
  }

  /** clic (pas un drag) → sélectionne la shape sous le curseur, sinon désélectionne. */
  private _pick(e: PointerEvent): void {
    if (this._dragging) return; // relâché après un drag de gizmo
    if (Math.hypot(e.clientX - this._downX, e.clientY - this._downY) > CLICK_PX) return; // c'était un orbit
    const rect = this._renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this._ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(this._ndc, this._camera);
    const hits = this._raycaster.intersectObjects(this._picks.children, false);
    this._editor.select(hits.length ? (hits[0].object.userData.id as string) : null);
  }

  private _clearGroup(group: Group): void {
    for (const child of group.children) {
      if (child instanceof LineSegments || child instanceof Mesh) {
        child.geometry.dispose();
        if (child instanceof LineSegments) (child.material as LineBasicNodeMaterial).dispose();
      }
    }
    group.clear();
  }
}

function applyTransform(o: Object3D, s: ShapeLayer): void {
  const t = s.transform;
  o.position.set(t.position.x, t.position.y, t.position.z);
  o.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z);
  o.scale.set(t.scale.x, t.scale.y, t.scale.z);
}

function lineMaterial(hex: number): LineBasicNodeMaterial {
  const m = new LineBasicNodeMaterial();
  m.color = new Color(hex);
  return m;
}

function helperMaterial(color: Color, opacity: number): LineBasicNodeMaterial {
  const m = new LineBasicNodeMaterial();
  m.color = color;
  m.transparent = true;
  m.opacity = opacity;
  return m;
}

import {
  BoxGeometry,
  BufferAttribute,
  CameraHelper,
  Color,
  ConeGeometry,
  CylinderGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Line,
  LineBasicNodeMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicNodeMaterial,
  MOUSE,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  WireframeGeometry,
  type Texture,
  type WebGPURenderer,
} from "three/webgpu";
import { positionWorld, texture } from "three/tsl";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Editor } from "@core/Editor.ts";
import { fillPreviewColor, type ShapeKind, type ShapeLayer, type Transform } from "@domain/Layer.ts";
import { LED_FILL } from "@core/engine/led.ts";

const N = 128;
const HALF = 1;
const PITCH = (2 * HALF) / (N - 1);      // espacement entre LEDs
const LED_RADIUS = (PITCH * LED_FILL) / 2; // rayon physique d'une LED
const ACCENT = new Color(0xff8a3d);
const NEUTRAL = new Color(0x6b6560); // wireframe d'un objet NON sélectionné (neutre, plus d'orange)
const HELPER_DIM = 0.28;  // opacité des helpers non sélectionnés (discrets)
const HELPER_LIT = 0.9;   // opacité du helper sélectionné
const FIXTURE_MARKER_RADIUS = 0.06; // repère visuel spot/lyre (position seule, pas de calcul sur le mur)

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
    case "triangle": return triangleGeometry();
  }
}

/** Triangle plat (plan XY), sommets (0,1) (-1,-1) (1,-1) — même convention que le collider CPU (`engine/shapes.ts`). */
function triangleGeometry(): BufferGeometry {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array([0, 1, 0, -1, -1, 0, 1, -1, 0]), 3));
  geo.setIndex([0, 1, 2]);
  geo.computeVertexNormals();
  return geo;
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
  private readonly _path = new Group();       // motion path du calque sélectionné (ligne + poignées)
  private readonly _handleGeo = new SphereGeometry(0.03, 12, 8);
  private readonly _handleMat: MeshBasicNodeMaterial;
  private _handleDrag: { id: string; frame: number; z: number } | null = null;
  private readonly _onDownCapture: (e: PointerEvent) => void;
  private readonly _plane = new Plane();
  private readonly _hit = new Vector3();
  private readonly _pickMat: MeshBasicNodeMaterial;
  private readonly _leds: InstancedMesh;
  private _wallFrame!: LineSegments;              // cadre du mur (masqué en prérendu)
  private _originRef!: Group;                      // repère d'origine (grille + axes), visible en prérendu
  private readonly _particleViewers = new Group(); // jumeaux 3D des systèmes de particules de la comp active
  private _prerenderCam: PerspectiveCamera | OrthographicCamera | null = null;
  private _camHelper: CameraHelper | null = null; // frustum de la caméra du prérendu actif
  private _camHelperKind = "";
  private readonly _raycaster = new Raycaster();
  private readonly _ndc = new Vector2();
  private readonly _unsub: () => void;
  private readonly _onKey: (e: KeyboardEvent) => void;
  private readonly _onDown: (e: PointerEvent) => void;
  private _onUp: (e: PointerEvent) => void;
  private _dragging = false;
  private _aspect = 0;
  private _lyreBeams: { layerId: string; line: Line; ring?: Mesh; dot?: Mesh }[] = [];
  private _onMove: ((e: PointerEvent) => void) | null = null;
  private _onUpMove: ((e: PointerEvent) => void) | null = null;
  private readonly _marquee: HTMLElement;
  private readonly _onContextMenu = (e: MouseEvent): void => e.preventDefault();

  constructor(renderer: WebGPURenderer, editor: Editor, engineTexture: Texture) {
    this._renderer = renderer;
    this._editor = editor;
    this._scene.background = new Color(0x0a0908);

    this._camera.position.set(1.7, 1.15, 2.6);
    this._controls = new OrbitControls(this._camera, renderer.domElement);
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.08;
    this._controls.target.set(0, 0, 0);
    this._controls.mouseButtons = {
      LEFT: null as any,
      MIDDLE: MOUSE.PAN,
      RIGHT: MOUSE.ROTATE,
    };

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

    this._wallFrame = new LineSegments(
      new WireframeGeometry(new PlaneGeometry(2 * HALF, 2 * HALF)),
      lineMaterial(0x4a3f37),
    );
    this._scene.add(this._wallFrame);

    // Repère d'origine (masqué par défaut) : rendu quand on édite un prérendu, où le mur+cadre
    // disparaissent — sinon les objets flottent dans le noir sans centre ni orientation.
    this._originRef = buildOriginRef();
    this._originRef.visible = false;
    this._scene.add(this._originRef);
    this._scene.add(this._particleViewers);

    this._scene.add(this._objects);

    // Cibles de raycast : maillages pleins invisibles (une par shape), jamais rendus.
    this._pickMat = new MeshBasicNodeMaterial();
    this._pickMat.colorWrite = false;
    this._pickMat.depthWrite = false;
    this._scene.add(this._picks);

    // Motion path : poignées de keyframes (petites sphères accent), rendues par-dessus le reste.
    this._handleMat = new MeshBasicNodeMaterial();
    this._handleMat.color = ACCENT;
    this._handleMat.depthTest = false;
    this._path.renderOrder = 2;
    this._scene.add(this._path);

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

    // g/r/s = outil déplacer/tourner/échelle ; z = mode d'affichage ; Échap = curseur.
    // (Suppr est global — voir AppShell.) Ignore si on tape dans un champ.
    this._onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "g") this._editor.setTool("translate");
      else if (e.key === "r") this._editor.setTool("rotate");
      else if (e.key === "s") this._editor.setTool("scale");
      else if (e.key === "z") this._editor.cycleViewportMode();
      else if (e.key === "Escape") this._editor.setTool("select");
    };
    window.addEventListener("keydown", this._onKey);

    // Sélection au clic (raycast) : on distingue un clic d'un drag d'orbite / gizmo.
    const dom = renderer.domElement;
    const parent = dom.parentElement || document.body;
    const marquee = document.createElement("div");
    marquee.className = "seq__marquee";
    marquee.style.display = "none";
    parent.appendChild(marquee);
    this._marquee = marquee;

    this._onDown = (e: PointerEvent): void => {
      if (e.button === 0 && !this._dragging && !this._handleDrag) {
        const rect = dom.getBoundingClientRect();

        // Si le gizmo est actif, vérifier si on clique dessus pour éviter de changer de sélection
        if (this._gizmo.object) {
          this._ndc.set(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1,
          );
          this._raycaster.setFromCamera(this._ndc, this._camera);
          const gizmoHits = this._raycaster.intersectObject(this._gizmo.getHelper(), true);
          if (gizmoHits.length > 0) {
            return;
          }
        }

        const startX = e.clientX;
        const startY = e.clientY;
        let moved = false;

        this._onMove = (moveEvent: PointerEvent): void => {
          if (this._dragging || this._handleDrag) return;
          const currentRect = dom.getBoundingClientRect();
          if (currentRect.width === 0 || currentRect.height === 0) return;

          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;

          if (!moved && Math.hypot(dx, dy) > 4) {
            moved = true;
            marquee.style.display = "block";
          }

          if (moved) {
            const left = Math.min(startX, moveEvent.clientX) - currentRect.left;
            const top = Math.min(startY, moveEvent.clientY) - currentRect.top;
            const width = Math.abs(dx);
            const height = Math.abs(dy);

            marquee.style.left = `${left}px`;
            marquee.style.top = `${top}px`;
            marquee.style.width = `${width}px`;
            marquee.style.height = `${height}px`;
          }
        };

        this._onUpMove = (upEvent: PointerEvent): void => {
          if (this._onMove) {
            window.removeEventListener("pointermove", this._onMove);
            this._onMove = null;
          }
          if (this._onUpMove) {
            window.removeEventListener("pointerup", this._onUpMove);
            this._onUpMove = null;
          }

          marquee.style.display = "none";

          if (moved) {
            this._pickBox(startX, startY, upEvent.clientX, upEvent.clientY);
          } else {
            this._pickAt(startX, startY);
          }
        };

        window.addEventListener("pointermove", this._onMove);
        window.addEventListener("pointerup", this._onUpMove);
      }
    };
    this._onUp = (_e: PointerEvent): void => this._pick();
    // Phase capture : intercepte un clic sur une poignée de motion path AVANT l'orbite / la sélection.
    this._onDownCapture = (e: PointerEvent): void => {
      this._beginHandleDrag(e);
      if (this._handleDrag) {
        this._controls.enabled = false;
      } else {
        this._controls.enabled = true;
      }
    };
    dom.addEventListener("pointerdown", this._onDownCapture, true);
    dom.addEventListener("pointerdown", this._onDown);
    dom.addEventListener("pointerup", this._onUp);
    dom.addEventListener("contextmenu", this._onContextMenu);

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
    this._syncParticleViewers();
    this._updateLyreBeams();
    this._renderer.setRenderTarget(null);
    this._renderer.render(this._scene, this._camera);
  }

  /** Réconcilie les jumeaux 3D des particules de la comp active dans la scène de l'éditeur (mêmes buffers compute). */
  private _syncParticleViewers(): void {
    const wanted = this._editor.activeParticleViewers();
    const set = new Set(wanted);
    for (const child of [...this._particleViewers.children]) {
      if (!set.has(child)) this._particleViewers.remove(child);
    }
    for (const v of wanted) {
      if (v.parent !== this._particleViewers) this._particleViewers.add(v);
    }
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
    dom.removeEventListener("pointerdown", this._onDownCapture, true);
    dom.removeEventListener("pointerdown", this._onDown);
    dom.removeEventListener("pointerup", this._onUp);
    dom.removeEventListener("contextmenu", this._onContextMenu);
    if (this._onMove) {
      window.removeEventListener("pointermove", this._onMove);
      this._onMove = null;
    }
    if (this._onUpMove) {
      window.removeEventListener("pointerup", this._onUpMove);
      this._onUpMove = null;
    }
    this._marquee.remove();
    this._clearLyreBeams();
    this._clearGroup(this._objects);
    this._clearGroup(this._picks);
    this._clearPath();
    this._handleGeo.dispose();
    this._handleMat.dispose();
    this._pickMat.dispose();
    this._gizmo.detach();
    this._gizmo.dispose();
    this._controls.dispose();
    this._leds.geometry.dispose();
    (this._leds.material as MeshBasicNodeMaterial).dispose();
    this._originRef.traverse((o) => {
      if (o instanceof LineSegments) { o.geometry.dispose(); (o.material as LineBasicNodeMaterial).dispose(); }
    });
    if (this._camHelper) { this._scene.remove(this._camHelper); this._camHelper.dispose(); }
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
    const mode = this._editor.viewportMode;
    this._clearGroup(this._objects);
    this._clearGroup(this._picks);
    this._clearLyreBeams();
    this._syncPrerenderView();

    for (const l of this._editor.children) {
      if (l.type !== "shape") continue;
      const s = l as ShapeLayer;
      if (!s.visible) continue;

      // cible de raycast : volume plein invisible (sélection possible dans tous les modes)
      const pickGeo = unitGeometry(s.shape);
      const pick = new Mesh(pickGeo, this._pickMat);
      const transform = this._editor.worldTransform(s.id);
      applyTransform(pick, transform);
      pick.userData.id = s.id;
      this._picks.add(pick);

      if (mode === "none" || !s.showHelper) continue; // aucun helper (mais toujours sélectionnable)

      const selected = s.id === selectedId;
      const preview = fillPreviewColor(s.fill);

      if (mode === "solid") {
        // solide couleur de fill ; wireframe accent seulement sur l'objet sélectionné
        const solid = new Mesh(unitGeometry(s.shape), solidMaterial(new Color(preview.r, preview.g, preview.b)));
        applyTransform(solid, transform);
        this._objects.add(solid);
        if (selected) {
          const unit = unitGeometry(s.shape);
          const outline = new LineSegments(new WireframeGeometry(unit), helperMaterial(ACCENT, HELPER_LIT));
          applyTransform(outline, transform);
          this._objects.add(outline);
          unit.dispose();
        }
      } else {
        // wireframe : non sélectionné en neutre (plus d'orange), sélectionné en accent
        const unit = unitGeometry(s.shape);
        const mesh = new LineSegments(new WireframeGeometry(unit), helperMaterial(selected ? ACCENT : NEUTRAL, selected ? HELPER_LIT : HELPER_DIM));
        applyTransform(mesh, transform);
        this._objects.add(mesh);
        unit.dispose();
      }
    }

    for (const l of this._editor.children) {
      if (l.type !== "spot" && l.type !== "lyre") continue;
      if (!l.visible || mode === "none") continue;
      const p = l.transform.position;

      // cible de raycast (même volume simple pour les deux, pas de forme physique à représenter)
      const pick = new Mesh(new SphereGeometry(FIXTURE_MARKER_RADIUS, 12, 8), this._pickMat);
      pick.position.set(p.x, p.y, p.z);
      pick.userData.id = l.id;
      this._picks.add(pick);

      const selected = l.id === selectedId;
      const c = l.channels;
      const color = selected ? ACCENT : new Color(c.r / 255, c.g / 255, c.b / 255);
      const marker = new Mesh(new SphereGeometry(FIXTURE_MARKER_RADIUS, 12, 8), fixtureMarkerMaterial(color, selected ? HELPER_LIT : HELPER_DIM));
      marker.position.set(p.x, p.y, p.z);
      this._objects.add(marker);

      if (l.type === "lyre") {
        const lineGeo = new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]);
        const lineMat = laserMaterial(new Color(1, 1, 1), 0.5);
        const line = new Line(lineGeo, lineMat);
        this._objects.add(line);

        const hitMat = fixtureMarkerMaterial(new Color(1, 1, 1), 0.5);
        const ring = new Mesh(new TorusGeometry(0.02, 0.003, 8, 16), hitMat);
        ring.visible = false;
        this._objects.add(ring);

        const dot = new Mesh(new SphereGeometry(0.006, 6, 4), hitMat);
        dot.visible = false;
        this._objects.add(dot);

        this._lyreBeams.push({
          layerId: l.id,
          line,
          ring,
          dot,
        });
      }
    }
    this._buildPath(selectedId);
    this._syncGizmo();
  }

  /**
   * Comp active = prérendu : c'est une scène 3D filmée par une caméra, pas le mur LED. On masque
   * donc la grille de LEDs + son cadre et on montre le frustum de la caméra du prérendu (repère de
   * cadrage). Les objets restent affichés (wireframe/solide) pour les positionner. Sinon : mur visible.
   */
  private _syncPrerenderView(): void {
    const comp = this._editor.activeComp();
    const cam = comp.kind === "prerender" ? comp.scene?.camera : undefined;
    this._leds.visible = !cam;
    this._wallFrame.visible = !cam;
    this._originRef.visible = !!cam;
    if (!cam) {
      if (this._camHelper) this._camHelper.visible = false;
      return;
    }

    if (this._camHelperKind !== cam.kind || !this._prerenderCam) {
      if (this._camHelper) { this._scene.remove(this._camHelper); this._camHelper.dispose(); }
      this._prerenderCam = cam.kind === "orthographic"
        ? new OrthographicCamera(-1, 1, 1, -1, cam.near, cam.far)
        : new PerspectiveCamera(cam.fov ?? 50, 1, cam.near, cam.far);
      this._camHelper = new CameraHelper(this._prerenderCam);
      this._scene.add(this._camHelper);
      this._camHelperKind = cam.kind;
    }

    const c = this._prerenderCam;
    if (c instanceof PerspectiveCamera) { c.fov = cam.fov ?? 50; c.aspect = 1; }
    c.near = cam.near;
    c.far = cam.far;
    c.position.set(cam.position.x, cam.position.y, cam.position.z);
    c.up.set(0, 1, 0);
    c.lookAt(cam.target.x, cam.target.y, cam.target.z);
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    this._camHelper!.visible = true;
    this._camHelper!.update();
  }

  /** Motion path du calque sélectionné : polyline reliant ses positions keyframées + une poignée par clé. */
  private _buildPath(selectedId: string | null): void {
    this._clearPath();
    if (!selectedId) return;
    const points = this._editor.motionPath(selectedId);
    if (points.length === 0) return;

    const vecs = points.map((p) => new Vector3(p.x, p.y, p.z));
    if (vecs.length >= 2) {
      const line = new Line(new BufferGeometry().setFromPoints(vecs), pathLineMaterial());
      line.renderOrder = 2;
      this._path.add(line);
    }
    for (const p of points) {
      const handle = new Mesh(this._handleGeo, this._handleMat);
      handle.position.set(p.x, p.y, p.z);
      handle.renderOrder = 3;
      handle.userData.id = selectedId;
      handle.userData.frame = p.frame;
      this._path.add(handle);
    }
  }

  /** Début du drag d'une poignée de keyframe (phase capture → coupe orbite + sélection). */
  private _beginHandleDrag(e: PointerEvent): void {
    if (this._path.children.length === 0) return;
    const rect = this._renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this._ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(this._ndc, this._camera);
    const handles = this._path.children.filter((c) => c.userData.frame !== undefined);
    const hits = this._raycaster.intersectObjects(handles, false);
    if (hits.length === 0) return;

    e.stopImmediatePropagation(); // pas d'orbite ni de sélection
    const h = hits[0].object;
    this._handleDrag = { id: h.userData.id as string, frame: h.userData.frame as number, z: h.position.z };
    this._controls.enabled = false;
    const move = (ev: PointerEvent): void => this._dragHandle(ev);
    const up = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this._handleDrag = null;
      this._controls.enabled = true;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Déplace la poignée dans le plan du mur (z constant) → écrit la valeur des clés position.x/y à ce frame. */
  private _dragHandle(e: PointerEvent): void {
    const drag = this._handleDrag;
    if (!drag) return;
    const rect = this._renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    this._ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(this._ndc, this._camera);
    this._plane.set(new Vector3(0, 0, 1), -drag.z); // plan du mur à la profondeur de la clé
    if (!this._raycaster.ray.intersectPlane(this._plane, this._hit)) return;
    this._editor.setKeyframeValue(drag.id, "position.x", drag.frame, this._hit.x);
    this._editor.setKeyframeValue(drag.id, "position.y", drag.frame, this._hit.y);
  }

  private _clearPath(): void {
    for (const child of this._path.children) {
      if (child instanceof Line) {
        child.geometry.dispose();
        (child.material as LineBasicNodeMaterial).dispose();
      }
      // les poignées (Mesh) partagent _handleGeo/_handleMat → pas de dispose ici
    }
    this._path.clear();
  }

  /**
   * positionne le proxy sur l'objet sélectionné et (dé)tache le gizmo selon l'outil (hors drag).
   * spot/lyre : repère visuel seul → déplacement autorisé, pas de rotation/échelle (rien à en faire).
   */
  private _syncGizmo(): void {
    if (this._dragging) return;
    const sel = this._editor.selected;
    const tool = this._editor.tool;
    const isShape = sel !== null && sel.type === "shape" && tool !== "select";
    const isFixture = sel !== null && (sel.type === "spot" || sel.type === "lyre") && tool === "translate";
    const active = sel !== null && sel.visible && (isShape || isFixture);
    if (active && sel) {
      const t = this._editor.worldTransform(sel.id); // gizmo en espace monde (parenté inclus)
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
    if (!sel) return;
    if (sel.type !== "shape" && sel.type !== "spot" && sel.type !== "lyre") return;
    const p = this._proxy;
    // le proxy est en monde → setWorldTransform reconvertit en local (parenté incluse)
    this._editor.setWorldTransform(sel.id, {
      position: { x: p.position.x, y: p.position.y, z: p.position.z },
      rotation: { x: p.rotation.x, y: p.rotation.y, z: p.rotation.z },
      scale: { x: p.scale.x, y: p.scale.y, z: p.scale.z },
    });
  }

  /** Relâchement du pointer : ré-active OrbitControls pour les autres interactions (ex: zoom) */
  private _pick(): void {
    this._controls.enabled = true;
  }

  /** Sélectionne l'objet à la coordonnée spécifiée (raycast) sans déplacer la caméra */
  private _pickAt(clientX: number, clientY: number): void {
    if (this._dragging || this._handleDrag) return;
    const rect = this._renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this._raycaster.setFromCamera(this._ndc, this._camera);

    // Si le gizmo est actif, vérifier si on clique dessus pour éviter de changer de sélection
    if (this._gizmo.object) {
      const gizmoHits = this._raycaster.intersectObject(this._gizmo.getHelper(), true);
      if (gizmoHits.length > 0) {
        return;
      }
    }

    const hits = this._raycaster.intersectObjects(this._picks.children, false);
    this._editor.select(hits.length ? (hits[0].object.userData.id as string) : null);
  }

  /** Sélectionne le premier objet visible dont la projection 2D intersecte la boîte 2D */
  private _pickBox(startX: number, startY: number, endX: number, endY: number): void {
    const box = {
      left: Math.min(startX, endX),
      top: Math.min(startY, endY),
      right: Math.max(startX, endX),
      bottom: Math.max(startY, endY),
    };

    const rect = this._renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const tempV = new Vector3();
    const candidates: { id: string; depth: number }[] = [];

    for (const child of this._picks.children) {
      const worldPos = new Vector3();
      worldPos.setFromMatrixPosition(child.matrixWorld);

      // Projecter en NDC
      tempV.copy(worldPos).project(this._camera);

      // Convertir en coordonnées pixel écran
      const pxX = ((tempV.x + 1) / 2) * rect.width + rect.left;
      const pxY = (-(tempV.y - 1) / 2) * rect.height + rect.top;

      if (pxX >= box.left && pxX <= box.right && pxY >= box.top && pxY <= box.bottom) {
        const dist = worldPos.distanceTo(this._camera.position);
        candidates.push({ id: child.userData.id as string, depth: dist });
      }
    }

    if (candidates.length > 0) {
      // Trier par profondeur (le plus proche de la caméra en premier)
      candidates.sort((a, b) => a.depth - b.depth);
      this._editor.select(candidates[0].id);
    } else {
      this._editor.select(null);
    }
  }

  private _clearGroup(group: Group): void {
    for (const child of group.children) {
      if (child instanceof Line || child instanceof Mesh) {
        child.geometry.dispose();
        if (child instanceof Line) (child.material as LineBasicNodeMaterial).dispose();
        // Mesh dont le matériau est partagé (_pickMat, cibles de raycast) : ne pas le disposer ici.
        else if (child.material !== this._pickMat) (child.material as MeshBasicNodeMaterial).dispose();
      }
    }
    group.clear();
  }

  private _clearLyreBeams(): void {
    for (const beam of this._lyreBeams) {
      this._objects.remove(beam.line);
      beam.line.geometry.dispose();
      (beam.line.material as LineBasicNodeMaterial).dispose();

      if (beam.ring) {
        this._objects.remove(beam.ring);
        beam.ring.geometry.dispose();
        (beam.ring.material as MeshBasicNodeMaterial).dispose();
      }
      if (beam.dot) {
        this._objects.remove(beam.dot);
        beam.dot.geometry.dispose();
        (beam.dot.material as MeshBasicNodeMaterial).dispose();
      }
    }
    this._lyreBeams = [];
  }

  private _updateLyreBeams(): void {
    const selectedId = this._editor.selectedId;
    for (const beam of this._lyreBeams) {
      const l = this._editor.children.find((child) => child.id === beam.layerId);
      if (!l || l.type !== "lyre" || !l.visible) {
        beam.line.visible = false;
        if (beam.ring) beam.ring.visible = false;
        if (beam.dot) beam.dot.visible = false;
        continue;
      }

      const p = l.transform.position;
      const selected = l.id === selectedId;
      const c = l.channels;

      const pan = c.pan ?? 0;
      const panFine = c.panFine ?? 0;
      const tilt = c.tilt ?? 0;
      const tiltFine = c.tiltFine ?? 0;

      // Pan: range of 540 degrees (0 to 3*PI)
      const panAngle = ((pan + panFine / 256) / 255) * (540 * Math.PI / 180);
      // Tilt: range of 180 degrees (0 to PI)
      const tiltAngle = ((tilt + tiltFine / 256) / 255) * Math.PI;

      const baseRot = l.transform.rotation;
      const baseObj = new Object3D();
      baseObj.rotation.set(baseRot.x, baseRot.y, baseRot.z);

      const headObj = new Object3D();
      headObj.rotation.y = panAngle;

      // At tilt = 0, points behind (0, 0, 1). At tilt = 127, points straight up (0, 1, 0). At tilt = 255, points in front (0, 0, -1).
      const dirLocal = new Vector3(0, Math.sin(tiltAngle), Math.cos(tiltAngle));

      const dir = dirLocal.clone();
      dir.applyQuaternion(headObj.quaternion);
      dir.applyQuaternion(baseObj.quaternion);
      dir.normalize();

      let endPoint = new Vector3().copy(dir).multiplyScalar(2).add(new Vector3(p.x, p.y, p.z));
      let hitsWall = false;

      if (Math.abs(dir.z) > 1e-5) {
        const t = -p.z / dir.z;
        if (t > 0) {
          endPoint.set(p.x + t * dir.x, p.y + t * dir.y, 0);
          hitsWall = true;
        }
      }

      const rVal = c.r / 255;
      const gVal = c.g / 255;
      const bVal = c.b / 255;
      const wVal = (c.w || 0) / 255;

      const beamColor = new Color(
        Math.min(1, rVal + wVal),
        Math.min(1, gVal + wVal),
        Math.min(1, bVal + wVal)
      );
      if (beamColor.r === 0 && beamColor.g === 0 && beamColor.b === 0) {
        beamColor.setRGB(1, 1, 1);
      }

      const dimmerVal = (c.dimmer !== undefined ? c.dimmer : 255) / 255;
      let beamOpacity = selected ? HELPER_LIT : HELPER_DIM;
      if (dimmerVal > 0) {
        beamOpacity = Math.max(beamOpacity, dimmerVal * 0.7);
      }

      const isVisible = true;

      beam.line.visible = isVisible;
      if (isVisible) {
        const points = [new Vector3(p.x, p.y, p.z), endPoint];
        beam.line.geometry.setFromPoints(points);

        const lineMat = beam.line.material as LineBasicNodeMaterial;
        lineMat.color.copy(selected ? ACCENT : beamColor);
        lineMat.opacity = beamOpacity;
      }

      const showHits = isVisible && hitsWall;
      if (beam.ring) {
        beam.ring.visible = showHits;
        if (showHits) {
          beam.ring.position.set(endPoint.x, endPoint.y, 0.005);
          const ringMat = beam.ring.material as MeshBasicNodeMaterial;
          ringMat.color.copy(selected ? ACCENT : beamColor);
          ringMat.opacity = Math.min(1, beamOpacity * 1.3);
        }
      }
      if (beam.dot) {
        beam.dot.visible = showHits;
        if (showHits) {
          beam.dot.position.set(endPoint.x, endPoint.y, 0.005);
          const dotMat = beam.dot.material as MeshBasicNodeMaterial;
          dotMat.color.copy(selected ? ACCENT : beamColor);
          dotMat.opacity = Math.min(1, beamOpacity * 1.3);
        }
      }
    }
  }
}

function applyTransform(o: Object3D, t: Transform): void {
  o.position.set(t.position.x, t.position.y, t.position.z);
  o.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z);
  o.scale.set(t.scale.x, t.scale.y, t.scale.z);
}

function lineMaterial(hex: number): LineBasicNodeMaterial {
  const m = new LineBasicNodeMaterial();
  m.color = new Color(hex);
  return m;
}

function linesFrom(points: number[], mat: LineBasicNodeMaterial): LineSegments {
  const geo = new BufferGeometry();
  geo.setAttribute("position", new Float32BufferAttribute(new Float32Array(points), 3));
  return new LineSegments(geo, mat);
}

/**
 * Repère d'origine pour l'édition d'un prérendu (mur masqué) : grille sol XZ discrète + axes X/Y/Z
 * colorés partant de l'origine → on situe le centre et l'orientation de la scène.
 */
function buildOriginRef(): Group {
  const g = new Group();
  const HALF_GRID = 2;
  const STEP = 0.5;
  const grid: number[] = [];
  for (let i = -HALF_GRID; i <= HALF_GRID + 1e-6; i += STEP) {
    grid.push(i, 0, -HALF_GRID, i, 0, HALF_GRID); // ligne // Z
    grid.push(-HALF_GRID, 0, i, HALF_GRID, 0, i); // ligne // X
  }
  g.add(linesFrom(grid, helperMaterial(new Color(0x3a322c), 0.5)));
  const A = 0.6; // longueur des axes
  g.add(linesFrom([0, 0, 0, A, 0, 0], lineMaterial(0xd8624a))); // X (rouge)
  g.add(linesFrom([0, 0, 0, 0, A, 0], lineMaterial(0x8fce6a))); // Y (vert)
  g.add(linesFrom([0, 0, 0, 0, 0, A], lineMaterial(0x5a86c8))); // Z (bleu)
  return g;
}

function helperMaterial(color: Color, opacity: number): LineBasicNodeMaterial {
  const m = new LineBasicNodeMaterial();
  m.color = color;
  m.transparent = true;
  m.opacity = opacity;
  return m;
}

/** Matériau plein (mode « solide ») : couleur de fill, légèrement translucide pour laisser deviner le mur. */
function solidMaterial(color: Color): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.color = color;
  m.transparent = true;
  m.opacity = 0.9;
  return m;
}

/** Ligne du motion path : accent, semi-transparente, rendue par-dessus le mur. */
function pathLineMaterial(): LineBasicNodeMaterial {
  const m = new LineBasicNodeMaterial();
  m.color = ACCENT;
  m.transparent = true;
  m.opacity = 0.7;
  m.depthTest = false;
  return m;
}

/** Petite sphère pleine (pas de wireframe) pour le repère visuel d'un spot/lyre. */
function fixtureMarkerMaterial(color: Color, opacity: number): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial();
  m.color = color;
  m.transparent = true;
  m.opacity = opacity;
  return m;
}

function laserMaterial(color: Color, opacity: number): LineBasicNodeMaterial {
  const m = new LineBasicNodeMaterial();
  m.color = color;
  m.transparent = true;
  m.opacity = opacity;
  m.depthWrite = false;
  return m;
}

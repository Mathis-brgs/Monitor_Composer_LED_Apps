import {
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Mesh,
  MeshStandardNodeMaterial,
  NearestFilter,
  OrthographicCamera,
  PerspectiveCamera,
  PlaneGeometry,
  RenderTarget,
  Scene,
  SphereGeometry,
  TorusGeometry,
  type BufferGeometry,
} from "three/webgpu";
import type { ShapeKind } from "@domain/Layer.ts";
import type { PrerenderScene } from "@domain/Composition.ts";
import type { ShapeFill, ShapeInput } from "./shapes.ts";

/** Géométrie unité d'une primitive — même convention d'axes/tailles que l'éditeur 3D et le collider CPU. */
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

/** Couleur d'un fill résolu (dégradé → moyenne, bitmap → blanc : le prérendu n'échantillonne pas les bitmaps en v1). */
function fillColor(fill: ShapeFill, out: Color): Color {
  switch (fill.kind) {
    case "solid": return out.setRGB(fill.color.r, fill.color.g, fill.color.b);
    case "gradient": return out.setRGB((fill.from.r + fill.to.r) / 2, (fill.from.g + fill.to.g) / 2, (fill.from.b + fill.to.b) / 2);
    case "bitmap": return out.setRGB(1, 1, 1);
  }
}

/**
 * Producteur de prérendu : une vraie scène 3D (caméra + meshes éclairés) rendue dans sa propre
 * RenderTarget avec depth buffer. Structurellement compatible `NestedSource` (scene/camera/target),
 * donc consommé par `Engine.setNested` exactement comme un `LayerStack` — mais via `renderer.render`
 * d'une scène perspective, pas d'un quad plein-cadre. Sa texture est réinjectée dans le parent par
 * un `NestedTextureLayer`, indistincte d'une précomp côté compositing.
 */
export class Prerender3DScene {
  readonly scene = new Scene();
  camera: PerspectiveCamera | OrthographicCamera = new PerspectiveCamera(50, 1, 0.1, 100);
  readonly target: RenderTarget;

  private readonly _aspect: number;
  private readonly _meshes: Mesh[] = [];
  private readonly _dir = new DirectionalLight(0xffffff, 2.4);
  private readonly _amb = new AmbientLight(0xffffff, 0.5);
  private readonly _scratch = new Color();
  private _sig = "";

  constructor(width = 128, height = 128) {
    this._aspect = width / height;
    this.target = new RenderTarget(width, height, { depthBuffer: true });
    this.target.texture.minFilter = NearestFilter;
    this.target.texture.magFilter = NearestFilter;
    this.target.texture.generateMipmaps = false;

    this._dir.position.set(2, 3, 4);
    this.scene.add(this._dir, this._amb);
    this.scene.background = new Color(0, 0, 0);
  }

  /** Applique la caméra + le fond de la scène de prérendu (position/cible/fov/clipping/background). */
  setScene(s: PrerenderScene): void {
    const bg = this.scene.background;
    if (bg instanceof Color) bg.setRGB(s.background.r, s.background.g, s.background.b);

    const c = s.camera;
    const wantOrtho = c.kind === "orthographic";
    if (wantOrtho !== this.camera instanceof OrthographicCamera) {
      this.camera = wantOrtho
        ? new OrthographicCamera(-this._aspect, this._aspect, 1, -1, c.near, c.far)
        : new PerspectiveCamera(c.fov ?? 50, this._aspect, c.near, c.far);
    }
    if (this.camera instanceof PerspectiveCamera) {
      this.camera.fov = c.fov ?? 50;
      this.camera.aspect = this._aspect;
    }
    this.camera.near = c.near;
    this.camera.far = c.far;
    this.camera.position.set(c.position.x, c.position.y, c.position.z);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(c.target.x, c.target.y, c.target.z);
    this.camera.updateProjectionMatrix();
  }

  /** (Re)construit les meshes au changement de structure (kinds/nombre) ; met à jour transform + couleur chaque frame. */
  setShapes(shapes: readonly ShapeInput[]): void {
    const sig = shapes.map((s) => s.kind).join(",");
    if (sig !== this._sig) {
      for (const m of this._meshes) {
        this.scene.remove(m);
        m.geometry.dispose();
        (m.material as MeshStandardNodeMaterial).dispose();
      }
      this._meshes.length = 0;
      for (const s of shapes) {
        const material = new MeshStandardNodeMaterial();
        material.roughness = 0.55;
        material.metalness = 0;
        const mesh = new Mesh(unitGeometry(s.kind), material);
        this.scene.add(mesh);
        this._meshes.push(mesh);
      }
      this._sig = sig;
    }

    shapes.forEach((s, i) => {
      const mesh = this._meshes[i];
      mesh.position.set(s.position.x, s.position.y, s.position.z);
      if (s.rotation) mesh.rotation.set(s.rotation.x, s.rotation.y, s.rotation.z);
      else mesh.rotation.set(0, 0, 0);
      mesh.scale.set(s.scale.x, s.scale.y, s.scale.z);
      const material = mesh.material as MeshStandardNodeMaterial;
      fillColor(s.fill, this._scratch);
      material.color.copy(this._scratch);
      const opacity = s.opacity ?? 1;
      material.opacity = opacity;
      material.transparent = opacity < 1;
    });
  }

  dispose(): void {
    for (const m of this._meshes) {
      m.geometry.dispose();
      (m.material as MeshStandardNodeMaterial).dispose();
    }
    this._meshes.length = 0;
    this.target.dispose();
  }
}

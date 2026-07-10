export { Fixture, type FixtureEntity, type EntityRange } from "./Fixture.ts";
export { WallFixture } from "./fixtures/WallFixture.ts";
export { createProject, type Project } from "./Project.ts";
export { DEFAULT_CONFIG, type ProjectConfig } from "./ProjectConfig.ts";
export { EMPTY_COMPOSITION, type Composition, type Sequence, type Track, type Keyframe } from "./Composition.ts";
export type { SceneObject } from "./SceneObject.ts";
export {
  makeGroup, makeShape, makeShaderLayer, findLayer, findGroup, findParent, groupChildren,
} from "./Layer.ts";
export type {
  Layer, Document, ShaderLayer, ShapeLayer, GroupLayer, ImageLayer, VideoLayer,
  RGB, Vec3, Transform, ShaderId, ShapeKind, BlendMode,
} from "./Layer.ts";

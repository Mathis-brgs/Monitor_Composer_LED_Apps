export { Fixture, type FixtureEntity, type EntityRange } from "./Fixture.ts";
export { WallFixture } from "./fixtures/WallFixture.ts";
export { createProject, createSeededProject, mainComposition, serializeProject, deserializeProject, type Project } from "./Project.ts";
export { DEFAULT_CONFIG, type ProjectConfig } from "./ProjectConfig.ts";
export {
  isComposition, hasTracks, makeComposition, findComposition, defaultPrerenderScene, partitionTracks, DEFAULT_DURATION_FRAMES,
  sampleKeyframes, upsertKeyframe, removeKeyframe, moveKeyframe,
  type Composition, type CompKind, type PrerenderScene, type Track, type Keyframe, type Interp,
} from "./Composition.ts";
export type { SceneObject } from "./SceneObject.ts";
export {
  makeGroup, makeShape, makeShaderLayer, makePrecomp, findLayer, findGroup, findParent, groupChildren, collectSubtreeIds,
} from "./Layer.ts";
export type {
  Layer, Document, ShaderLayer, ShapeLayer, GroupLayer, ImageLayer, VideoLayer, PrecompLayer,
  RGB, Vec3, Transform, ShaderId, ShapeKind, BlendMode,
} from "./Layer.ts";

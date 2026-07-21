import { test } from "node:test";
import assert from "node:assert/strict";
import { createProject, mainComposition, serializeProject, deserializeProject } from "./Project.ts";
import { makeGroup, makeShape } from "./Layer.ts";

test("createProject : une comp principale vide", () => {
  const p = createProject();
  assert.equal(p.mainCompId, "main");
  const main = mainComposition(p);
  assert.equal(main.kind, "main");
  assert.deepEqual(main.tracks, []);
  assert.equal(main.root.children.length, 0);
});

test("round-trip nouveau format : préserve comps, root, tracks, durée", () => {
  const p = createProject();
  const main = mainComposition(p);
  main.root.children.push(makeShape("s1", "sphere", "Sphère"));
  main.tracks.push({ layerId: "s1", channel: "opacity", keyframes: [{ frame: 0, value: 1, interp: "linear" }] });
  main.durationFrames = 300;

  const back = deserializeProject(serializeProject(p));
  const m2 = mainComposition(back);
  assert.equal(back.mainCompId, "main");
  assert.equal(m2.durationFrames, 300);
  assert.equal(m2.root.children.length, 1);
  assert.equal(m2.tracks.length, 1);
  assert.equal(m2.tracks[0].layerId, "s1");
});

test("migration ancien format { composition, document } → comp principale", () => {
  const legacy = JSON.stringify({
    config: { name: "Old", fixture: "wall", ehub: { host: "127.0.0.1", port: 8765 }, frequency: 24 },
    composition: { tracks: [{ layerId: "L1", channel: "opacity", keyframes: [{ frame: 0, value: 0.5, interp: "linear" }] }] },
    objects: [],
    document: { root: makeGroup("root", "Composition"), activeGroupId: "root", selectedId: null },
  });
  const p = deserializeProject(legacy);
  assert.equal(p.mainCompId, "main");
  const main = mainComposition(p);
  assert.equal(main.kind, "main");
  assert.equal(main.tracks.length, 1);
  assert.equal(main.tracks[0].layerId, "L1");
  assert.equal(main.root.id, "root");
});

test("migration ancien format sans document → root vide, tracks conservées", () => {
  const legacy = JSON.stringify({
    config: { name: "Old", fixture: "wall", ehub: { host: "127.0.0.1", port: 8765 } },
    composition: { tracks: [] },
    objects: [],
  });
  const p = deserializeProject(legacy);
  const main = mainComposition(p);
  assert.equal(main.root.children.length, 0);
  assert.equal(main.tracks.length, 0);
});

test("config incomplète → valeurs par défaut", () => {
  const p = deserializeProject(JSON.stringify({ compositions: {}, mainCompId: "main" }));
  assert.equal(p.config.fixture, "wall");
  assert.equal(p.config.ehub.host, "127.0.0.1");
  // mainCompId absent des compositions → une comp principale est fabriquée
  assert.ok(mainComposition(p));
});

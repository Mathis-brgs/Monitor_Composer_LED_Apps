import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findLayer, findGroup, findParent, groupChildren,
  makeGroup, makeShape, makeShaderLayer, type Document,
} from "./Layer.ts";

function doc(): Document {
  const root = makeGroup("root", "Composition");
  root.children.push(makeShaderLayer("plasma-1", "plasma", "Plasma"));
  const grp = makeGroup("g1", "Groupe 1");
  grp.children.push(makeShape("s1", "sphere", "Sphère 01"));
  root.children.push(grp);
  return { root, activeGroupId: "root", selectedId: null };
}

test("findLayer trouve en profondeur", () => {
  const d = doc();
  assert.equal(findLayer(d.root, "s1")?.name, "Sphère 01");
  assert.equal(findLayer(d.root, "absent"), null);
});

test("findGroup ne renvoie que des groupes", () => {
  const d = doc();
  assert.equal(findGroup(d.root, "g1")?.type, "group");
  assert.equal(findGroup(d.root, "plasma-1"), null); // shader, pas un groupe
  assert.equal(findGroup(d.root, "root")?.id, "root");
});

test("findParent remonte au groupe conteneur", () => {
  const d = doc();
  assert.equal(findParent(d.root, "s1")?.id, "g1");
  assert.equal(findParent(d.root, "g1")?.id, "root");
  assert.equal(findParent(d.root, "root"), null);
});

test("groupChildren renvoie les enfants du groupe actif", () => {
  const d = doc();
  assert.deepEqual(groupChildren(d, "root").map((l) => l.id), ["plasma-1", "g1"]);
  assert.deepEqual(groupChildren(d, "g1").map((l) => l.id), ["s1"]);
});

test("makeShape a un transform et une couleur par défaut", () => {
  const s = makeShape("s2", "box", "Cube");
  assert.equal(s.type, "shape");
  assert.equal(s.transform.scale.x > 0, true);
  assert.equal(s.showHelper, true);
  assert.equal(s.fill.type, "solid");
  assert.equal(s.fill.type === "solid" && typeof s.fill.color.r, "number");
});

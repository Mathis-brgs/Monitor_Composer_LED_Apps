import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findLayer, findGroup, findParent, groupChildren,
  makeGroup, makeShape, makeShaderLayer, type Document,
  layerActiveAt, moveClip, trimIn, trimOut,
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

test("layerActiveAt : pas de clip → toujours actif", () => {
  assert.equal(layerActiveAt(undefined, 0), true);
  assert.equal(layerActiveAt(undefined, 9999), true);
});

test("layerActiveAt : bornes incluses", () => {
  const c = { in: 10, out: 20 };
  assert.equal(layerActiveAt(c, 9), false);
  assert.equal(layerActiveAt(c, 10), true);
  assert.equal(layerActiveAt(c, 20), true);
  assert.equal(layerActiveAt(c, 21), false);
});

test("moveClip garde la longueur et clampe aux bornes", () => {
  const c = { in: 10, out: 20 }; // longueur 10
  assert.deepEqual(moveClip(c, 5, 100), { in: 15, out: 25 });
  assert.deepEqual(moveClip(c, -20, 100), { in: 0, out: 10 }); // butée gauche
  assert.deepEqual(moveClip(c, 999, 100), { in: 90, out: 100 }); // butée droite
});

test("trimIn bouge in sans dépasser out ni sortir des bornes", () => {
  const c = { in: 10, out: 20 };
  assert.deepEqual(trimIn(c, 5, 100), { in: 5, out: 20 });
  assert.deepEqual(trimIn(c, 25, 100), { in: 20, out: 20 }); // min 1 frame
  assert.deepEqual(trimIn(c, -5, 100), { in: 0, out: 20 });
});

test("trimOut bouge out sans passer sous in ni sortir des bornes", () => {
  const c = { in: 10, out: 20 };
  assert.deepEqual(trimOut(c, 30, 100), { in: 10, out: 30 });
  assert.deepEqual(trimOut(c, 5, 100), { in: 10, out: 10 }); // min 1 frame
  assert.deepEqual(trimOut(c, 200, 100), { in: 10, out: 100 });
});

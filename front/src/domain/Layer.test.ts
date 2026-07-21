import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findLayer, findGroup, findParent, groupChildren,
  makeGroup, makeShape, makeShaderLayer, makeAudio, type Document,
  layerActiveAt, moveClip, trimIn, trimOut, wouldCycle,
  mediaClipLength, mediaClipTimelineOut, mediaClipActiveAt, mediaSourceFrameAt,
  moveMediaClip, trimMediaIn, trimMediaOut, splitMediaClip, mediaFadeGain, applyMap,
  mediaGroupActiveAt, collectSubtreeIds, makePrecomp, precompActiveAt, precompChildFrame,
  type MediaClip,
} from "./Layer.ts";

test("precompChildFrame : offset + vitesse, clampé à [0, durée[", () => {
  const inst = makePrecomp("p", "P", "c"); // timeOffset 0, speed 1
  assert.equal(precompChildFrame(inst, 30, 100), 30);          // 1:1
  assert.equal(precompChildFrame(inst, 200, 100), 99);         // clamp haut (durée 100 → 99)
  inst.timeOffset = 10;
  assert.equal(precompChildFrame(inst, 0, 100), 10);           // décalage
  inst.timeOffset = 0; inst.speed = 2;
  assert.equal(precompChildFrame(inst, 5, 100), 10);           // vitesse ×2
  inst.speed = 1; inst.clip = { in: 20, out: 80 };
  assert.equal(precompChildFrame(inst, 20, 100), 0);           // début local = bord in du clip
  assert.equal(precompChildFrame(inst, 35, 100), 15);
});

test("precompActiveAt : suit la fenêtre de clip (sans clip = toujours)", () => {
  const inst = makePrecomp("p", "P", "c");
  assert.equal(precompActiveAt(inst, 999), true);              // pas de clip
  inst.clip = { in: 10, out: 20 };
  assert.equal(precompActiveAt(inst, 5), false);
  assert.equal(precompActiveAt(inst, 15), true);
  assert.equal(precompActiveAt(inst, 25), false);
});

test("collectSubtreeIds : calque + descendants ; s'arrête aux precomps (opaques)", () => {
  const grp = makeGroup("g", "G");
  grp.children.push(makeShape("s1", "sphere", "S1"), makePrecomp("pc", "PC", "comp-x"));
  const inner = makeGroup("g2", "G2");
  inner.children.push(makeShape("s2", "box", "S2"));
  grp.children.push(inner);
  const ids = collectSubtreeIds(grp);
  assert.deepEqual([...ids].sort(), ["g", "g2", "pc", "s1", "s2"]);
  // une precomp est une feuille opaque : pas de descente dans SA composition
  assert.deepEqual([...collectSubtreeIds(makePrecomp("p", "P", "c"))], ["p"]);
});

const mc = (o: Partial<MediaClip> = {}): MediaClip =>
  ({ id: "c", sourceIn: 0, sourceOut: 24, timelineIn: 10, speed: 1, ...o });

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

test("makeAudio : type audio, gain 1, exclu du rendu (pas de couleur/fill)", () => {
  const a = makeAudio("a1", "Piste son", "asset-42");
  assert.equal(a.type, "audio");
  assert.equal(a.assetId, "asset-42");
  assert.equal(a.gain, 1);
  assert.equal(a.visible, true);
});

test("mediaClip : longueur et fin timeline selon vitesse", () => {
  assert.equal(mediaClipLength(mc()), 24);
  assert.equal(mediaClipTimelineOut(mc()), 34);
  assert.equal(mediaClipLength(mc({ speed: 2 })), 12); // 2x plus rapide → moitié moins long
});

test("mediaClipActiveAt : in inclus, out exclu", () => {
  const c = mc();
  assert.equal(mediaClipActiveAt(c, 9), false);
  assert.equal(mediaClipActiveAt(c, 10), true);
  assert.equal(mediaClipActiveAt(c, 33), true);
  assert.equal(mediaClipActiveAt(c, 34), false);
});

test("mediaSourceFrameAt : mappe timeline → source, clampé, tient compte de speed", () => {
  assert.equal(mediaSourceFrameAt(mc(), 10), 0);
  assert.equal(mediaSourceFrameAt(mc(), 15), 5);
  assert.equal(mediaSourceFrameAt(mc(), 999), 24); // clamp sourceOut
  assert.equal(mediaSourceFrameAt(mc({ speed: 2 }), 15), 10); // (15-10)*2
});

test("moveMediaClip décale timelineIn, borné à ≥ 0", () => {
  assert.equal(moveMediaClip(mc(), 5).timelineIn, 15);
  assert.equal(moveMediaClip(mc(), -20).timelineIn, 0);
});

test("trimMediaIn avance la source en même temps que le bord d'entrée", () => {
  assert.deepEqual(trimMediaIn(mc(), 14), { id: "c", sourceIn: 4, sourceOut: 24, timelineIn: 14, speed: 1 });
});

test("trimMediaOut ajuste sourceOut, garde ≥ 1 frame", () => {
  assert.equal(trimMediaOut(mc(), 20).sourceOut, 10);
  assert.equal(trimMediaOut(mc(), 10).sourceOut, 1); // sous timelineIn+1 → 1 frame mini
});

test("splitMediaClip coupe en deux au frame timeline (null hors bornes)", () => {
  const [l, r] = splitMediaClip(mc(), 18, "c2")!;
  assert.deepEqual(l, { id: "c", sourceIn: 0, sourceOut: 8, timelineIn: 10, speed: 1 });
  assert.deepEqual(r, { id: "c2", sourceIn: 8, sourceOut: 24, timelineIn: 18, speed: 1 });
  assert.equal(splitMediaClip(mc(), 10, "x"), null); // au bord in
  assert.equal(splitMediaClip(mc(), 34, "x"), null); // au bord out
});

test("mediaFadeGain : enveloppe des fondus in/out (1 hors fondus, 0 hors clip)", () => {
  const c = mc({ fadeIn: 4, fadeOut: 4 }); // clip timeline [10, 34], len 24
  assert.equal(mediaFadeGain(c, 10), 0);    // début du fade-in
  assert.equal(mediaFadeGain(c, 12), 0.5);
  assert.equal(mediaFadeGain(c, 14), 1);    // fin du fade-in
  assert.equal(mediaFadeGain(c, 20), 1);    // plateau
  assert.equal(mediaFadeGain(c, 32), 0.5);  // fade-out (local 22)
  assert.equal(mediaFadeGain(c, 34), 0);    // fin du fade-out
  assert.equal(mediaFadeGain(mc(), 20), 1); // sans fondu → 1
  assert.equal(mediaFadeGain(c, 5), 0);     // avant le clip
});

test("mediaGroupActiveAt : light groupé suit la fenêtre du clip média parent", () => {
  const root = makeGroup("root", "R");
  const aud = makeAudio("aud", "Son", "asset");
  aud.clips = [{ id: "c", sourceIn: 0, sourceOut: 10, timelineIn: 10, speed: 1 }]; // actif [10, 20)
  const light = makeShape("l", "sphere", "Light");
  root.children.push(aud, light);
  assert.equal(mediaGroupActiveAt(root, light, 15), true); // pas de groupe → toujours actif
  light.mediaGroupId = "aud";
  assert.equal(mediaGroupActiveAt(root, light, 5), false); // avant le clip média
  assert.equal(mediaGroupActiveAt(root, light, 15), true); // dans le clip
  assert.equal(mediaGroupActiveAt(root, light, 25), false); // après le clip
  light.mediaGroupId = "absent";
  assert.equal(mediaGroupActiveAt(root, light, 5), true); // parent introuvable → actif
});

test("applyMap : remappage linéaire clampé", () => {
  const m = { inMin: 0, inMax: 1, outMin: 0, outMax: 255 };
  assert.equal(applyMap(m, 0.5), 127.5);
  assert.equal(applyMap(m, 2), 255); // clamp haut
  assert.equal(applyMap(m, -1), 0); // clamp bas
  assert.equal(applyMap({ inMin: 5, inMax: 5, outMin: 3, outMax: 9 }, 5), 3); // dégénéré → outMin
});

test("wouldCycle détecte les cycles de parentage", () => {
  const root = makeGroup("root", "R");
  const a = makeShape("a", "box", "A");
  const b = makeShape("b", "box", "B");
  const c = makeShape("c", "box", "C");
  root.children.push(a, b, c);
  b.parentId = "a"; // b enfant de a
  c.parentId = "b"; // c enfant de b (a → b → c)
  assert.equal(wouldCycle(root, "a", "c"), true);  // parenter a à c fermerait la boucle
  assert.equal(wouldCycle(root, "a", "b"), true);  // idem
  assert.equal(wouldCycle(root, "c", "a"), false); // c déjà descendant de a, mais pas de cycle
  assert.equal(wouldCycle(root, "a", "a"), true);  // soi-même
});

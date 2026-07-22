import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleKeyframes, upsertKeyframe, removeKeyframe, moveKeyframe, type Keyframe } from "./Composition.ts";

const kf = (frame: number, value: number, interp: "linear" | "hold" = "linear"): Keyframe => ({ frame, value, interp });

test("sampleKeyframes : une seule clé → constante", () => {
  const kfs = [kf(10, 5)];
  assert.equal(sampleKeyframes(kfs, 0), 5);
  assert.equal(sampleKeyframes(kfs, 10), 5);
  assert.equal(sampleKeyframes(kfs, 99), 5);
});

test("sampleKeyframes : clamp hors bornes", () => {
  const kfs = [kf(10, 2), kf(20, 8)];
  assert.equal(sampleKeyframes(kfs, 5), 2);
  assert.equal(sampleKeyframes(kfs, 25), 8);
});

test("sampleKeyframes : linéaire à mi-chemin et aux clés", () => {
  const kfs = [kf(10, 0), kf(20, 10)];
  assert.equal(sampleKeyframes(kfs, 10), 0);
  assert.equal(sampleKeyframes(kfs, 20), 10);
  assert.equal(sampleKeyframes(kfs, 15), 5);
});

test("sampleKeyframes : hold garde la valeur de gauche", () => {
  const kfs = [kf(10, 3, "hold"), kf(20, 9)];
  assert.equal(sampleKeyframes(kfs, 10), 3);
  assert.equal(sampleKeyframes(kfs, 15), 3);
  assert.equal(sampleKeyframes(kfs, 20), 9);
});

test("sampleKeyframes : bézier = smoothstep (ease aux extrémités, milieu inchangé)", () => {
  const kfs: Keyframe[] = [{ frame: 0, value: 0, interp: "bezier" }, kf(10, 10)];
  assert.equal(sampleKeyframes(kfs, 5), 5);            // smoothstep(0.5) = 0.5
  assert.ok(Math.abs(sampleKeyframes(kfs, 2.5) - 1.5625) < 1e-6); // smoothstep(0.25) = 0.15625
  assert.ok(sampleKeyframes(kfs, 2.5) < 2.5);          // ease-in : sous la droite linéaire
});

test("sampleKeyframes : bézier avec cp personnalisés", () => {
  // Courbe très prononcée (presque hold)
  const kfs: Keyframe[] = [{ frame: 0, value: 0, interp: "bezier", cp: [0.9, 0.1, 0.9, 0.1] }, kf(10, 10)];
  // À t=0.5, la valeur doit être très proche de 0 (le changement se produit tard)
  const v5 = sampleKeyframes(kfs, 5);
  assert.ok(v5 < 1.0, `valeur à t=0.5: ${v5}`);
});

test("sampleKeyframes : ease-in et ease-out quad", () => {
  const kfsIn: Keyframe[] = [{ frame: 0, value: 0, interp: "ease-in" }, kf(10, 10)];
  assert.equal(sampleKeyframes(kfsIn, 5), 2.5); // 10 * 0.5^2 = 2.5

  const kfsOut: Keyframe[] = [{ frame: 0, value: 0, interp: "ease-out" }, kf(10, 10)];
  assert.equal(sampleKeyframes(kfsOut, 5), 7.5); // 10 * 0.5 * (2 - 0.5) = 7.5
});



test("upsertKeyframe : insère trié, remplace au même frame", () => {
  let kfs: Keyframe[] = [];
  kfs = upsertKeyframe(kfs, kf(20, 1));
  kfs = upsertKeyframe(kfs, kf(10, 2));
  assert.deepEqual(kfs.map((k) => k.frame), [10, 20]);
  kfs = upsertKeyframe(kfs, kf(10, 9));
  assert.equal(kfs.length, 2);
  assert.equal(kfs.find((k) => k.frame === 10)?.value, 9);
});

test("removeKeyframe : retire la clé ; no-op si absente", () => {
  const kfs = [kf(10, 1), kf(20, 2)];
  assert.deepEqual(removeKeyframe(kfs, 10).map((k) => k.frame), [20]);
  assert.deepEqual(removeKeyframe(kfs, 99).map((k) => k.frame), [10, 20]);
});

test("moveKeyframe : déplace la clé (valeur/interp conservés), re-trié", () => {
  const kfs = [kf(10, 2, "hold"), kf(30, 8)];
  const out = moveKeyframe(kfs, 10, 40);
  assert.deepEqual(out.map((k) => k.frame), [30, 40]);
  const moved = out.find((k) => k.frame === 40)!;
  assert.equal(moved.value, 2);
  assert.equal(moved.interp, "hold");
});

test("moveKeyframe : no-op si `from` absent ; fusion si `to` occupé", () => {
  const kfs = [kf(10, 1), kf(20, 2)];
  assert.deepEqual(moveKeyframe(kfs, 99, 5).map((k) => k.frame), [10, 20]);
  const merged = moveKeyframe(kfs, 10, 20);
  assert.deepEqual(merged.map((k) => k.frame), [20]);
  assert.equal(merged[0].value, 1);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { computePeaks } from "./audio-peaks.ts";

test("computePeaks : min/max par bucket, sortie entrelacée", () => {
  const ch = new Float32Array([0, 1, -1, 0.5]);
  // 2 buckets → [0,1) échantillons 0,1 (min 0 max 1) ; [2,4) échantillons -1,0.5 (min -1 max 0.5)
  assert.deepEqual([...computePeaks(ch, 2)], [0, 1, -1, 0.5]);
});

test("computePeaks : 1 bucket = min/max global", () => {
  // valeurs exactes en float32 (0.2/0.7 ne le sont pas → éviter la dérive de précision)
  const ch = new Float32Array([0.25, -0.75, 0.5, -0.125]);
  assert.deepEqual([...computePeaks(ch, 1)], [-0.75, 0.5]);
});

test("computePeaks : bornes dégénérées → tableau vide", () => {
  assert.equal(computePeaks(new Float32Array([1, 2, 3]), 0).length, 0);
  assert.equal(computePeaks(new Float32Array([]), 4).length, 8); // buckets demandés mais silence
  assert.deepEqual([...computePeaks(new Float32Array([]), 1)], [0, 0]);
});

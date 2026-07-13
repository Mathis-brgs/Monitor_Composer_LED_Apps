import { test } from "node:test";
import assert from "node:assert/strict";
import { Animator } from "./Animator.ts";

/** Fabrique un Animator + un journal des applications de canal. */
function make() {
  const applied: Array<{ id: string; channel: string; value: number }> = [];
  const anim = new Animator((id, channel, value) => applied.push({ id, channel, value }));
  return { anim, applied };
}

test("addChannel crée une track avec une clé = valeur lue ; idempotent", () => {
  const { anim } = make();
  anim.addChannel("L1", "opacity", 10, 0.4);
  assert.equal(anim.isAnimated("L1", "opacity"), true);
  assert.equal(anim.composition.tracks.length, 1);
  anim.addChannel("L1", "opacity", 20, 0.9); // déjà là → no-op
  assert.equal(anim.composition.tracks.length, 1);
});

test("evaluate applique la valeur échantillonnée par track", () => {
  const { anim, applied } = make();
  anim.addChannel("L1", "opacity", 0, 0);
  anim.autoKey("L1", "opacity", 10, 1); // 2e clé → rampe 0..1 sur 0..10
  anim.addChannel("L2", "position.x", 0, 5);
  applied.length = 0;
  anim.evaluate(5);
  const op = applied.find((a) => a.channel === "opacity");
  const px = applied.find((a) => a.channel === "position.x");
  assert.ok(op && Math.abs(op.value - 0.5) < 1e-9, `opacity=${op?.value}`);
  assert.ok(px && px.value === 5, `position.x=${px?.value}`);
});

test("autoKey upsert seulement si une track existe", () => {
  const { anim } = make();
  anim.autoKey("L1", "opacity", 10, 0.5); // pas de track → no-op
  assert.equal(anim.isAnimated("L1", "opacity"), false);
  anim.addChannel("L1", "opacity", 0, 0);
  anim.autoKey("L1", "opacity", 10, 0.5);
  assert.equal(anim.composition.tracks[0].keyframes.length, 2);
});

test("removeChannel et dropLayer purgent les tracks", () => {
  const { anim } = make();
  anim.addChannel("L1", "opacity", 0, 0);
  anim.addChannel("L1", "position.x", 0, 0);
  anim.removeChannel("L1", "opacity");
  assert.equal(anim.isAnimated("L1", "opacity"), false);
  assert.equal(anim.isAnimated("L1", "position.x"), true);
  anim.dropLayer("L1");
  assert.equal(anim.composition.tracks.length, 0);
});

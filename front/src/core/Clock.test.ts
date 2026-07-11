import { test } from "node:test";
import assert from "node:assert/strict";
import { Clock } from "./Clock.ts";

test("valeurs par défaut : fps 24, 192 frames (8 s), boucle off", () => {
  const c = new Clock();
  assert.equal(c.fps, 24);
  assert.equal(c.durationFrames, 192);
  assert.equal(c.duration, 8);
  assert.equal(c.loop, "off");
});

test("configure fixe fps et durationFrames ; duration/frame en découlent", () => {
  const c = new Clock();
  c.configure({ fps: 30, durationFrames: 300 });
  assert.equal(c.fps, 30);
  assert.equal(c.durationFrames, 300);
  assert.equal(c.duration, 10);
  c.seek(2);
  assert.equal(c.frame, 60);
});

test("configure ignore fps <= 0 et durationFrames négatif", () => {
  const c = new Clock();
  c.configure({ fps: 0 });
  assert.equal(c.fps, 24);
  c.configure({ durationFrames: -5 });
  assert.equal(c.durationFrames, 192);
});

test("timeToFrame / frameToTime : conversion arrondie au frame", () => {
  const c = new Clock();
  c.configure({ fps: 24 });
  assert.equal(c.timeToFrame(1), 24);
  assert.equal(c.frameToTime(24), 1);
  assert.equal(c.timeToFrame(0.51 / 24 + 1), 25); // arrondi
});

test("setLoop change le mode", () => {
  const c = new Clock();
  c.setLoop("loop");
  assert.equal(c.loop, "loop");
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { rgbToHex, hexToRgb } from "./color.ts";

test("rgbToHex", () => {
  assert.equal(rgbToHex({ r: 1, g: 0, b: 0 }), "#ff0000");
  assert.equal(rgbToHex({ r: 0, g: 1, b: 0 }), "#00ff00");
});

test("hexToRgb", () => {
  const c = hexToRgb("#3d7cff");
  assert.equal(Math.round(c.r * 255), 61);
  assert.equal(Math.round(c.b * 255), 255);
});

test("round-trip", () => {
  const hex = "#a1b2c3";
  assert.equal(rgbToHex(hexToRgb(hex)), hex);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { rasterizeShapes, type ShapeInput } from "./shapes.ts";

const W = 4, H = 4;
const pos = (x = 0, y = 0, z = 0) => ({ x, y, z });
const scl = (s: number) => ({ x: s, y: s, z: s });

test("aucune shape → tout transparent", () => {
  const buf = rasterizeShapes([], W, H);
  assert.equal(buf.length, W * H * 4);
  for (let i = 0; i < buf.length; i++) assert.equal(buf[i], 0);
});

test("un cube couvrant tout → LEDs opaques à sa couleur", () => {
  const shapes: ShapeInput[] = [{ kind: "box", position: pos(), scale: scl(4), fill: { kind: "solid", color: { r: 1, g: 0, b: 0 } } }];
  const buf = rasterizeShapes(shapes, W, H);
  let redOpaque = 0;
  for (let i = 0; i < W * H; i++) {
    if (buf[i * 4 + 3] === 255 && buf[i * 4] === 255 && buf[i * 4 + 1] === 0) redOpaque++;
  }
  assert.equal(redOpaque, W * H);
});

test("avant-plan gagne : dernier shape écrase", () => {
  const shapes: ShapeInput[] = [
    { kind: "box", position: pos(), scale: scl(4), fill: { kind: "solid", color: { r: 1, g: 0, b: 0 } } },
    { kind: "box", position: pos(), scale: scl(4), fill: { kind: "solid", color: { r: 0, g: 0, b: 1 } } },
  ];
  const buf = rasterizeShapes(shapes, W, H);
  assert.equal(buf[2], 255); // bleu du 2e
  assert.equal(buf[0], 0);   // plus de rouge
});

test("échelle non-uniforme : bande horizontale (ellipsoïde plat)", () => {
  const shapes: ShapeInput[] = [{ kind: "sphere", position: pos(), scale: { x: 4, y: 0.5, z: 4 }, fill: { kind: "solid", color: { r: 0, g: 1, b: 0 } } }];
  const buf = rasterizeShapes(shapes, W, H);
  const litRow1 = buf[(1 * W + 0) * 4 + 3];  // j=1 (y=-0.33) → dans la bande
  const darkRow0 = buf[(0 * W + 0) * 4 + 3]; // j=0 (y=-1) → hors bande
  assert.equal(litRow1, 255);
  assert.equal(darkRow0, 0);
});

test("rotation Z 45° : le collider tourne (losange), pas un carré axis-aligned", () => {
  const W2 = 9, H2 = 9; // coords : x = -1 + 0.25 i, y = 1 - 0.25 j
  const flat: ShapeInput = { kind: "box", position: pos(), scale: { x: 0.6, y: 0.6, z: 1 }, fill: { kind: "solid", color: { r: 1, g: 1, b: 1 } } };
  const spun: ShapeInput = { ...flat, rotation: { x: 0, y: 0, z: Math.PI / 4 } };
  const alpha = (buf: Uint8Array, i: number, j: number): number => buf[(j * W2 + i) * 4 + 3];

  const bf = rasterizeShapes([flat], W2, H2);
  const bs = rasterizeShapes([spun], W2, H2);

  // coin (0.5, 0.5) : dans le carré droit, hors du losange
  assert.equal(alpha(bf, 6, 2), 255);
  assert.equal(alpha(bs, 6, 2), 0);
  // pointe (0.75, 0) : hors du carré droit, dans le losange
  assert.equal(alpha(bf, 7, 4), 0);
  assert.equal(alpha(bs, 7, 4), 255);
});

test("opacité : module la luminosité de la LED (pas l'alpha)", () => {
  const shapes: ShapeInput[] = [{ kind: "box", position: pos(), scale: scl(4), fill: { kind: "solid", color: { r: 1, g: 1, b: 1 } }, opacity: 0.5 }];
  const buf = rasterizeShapes(shapes, 2, 2);
  assert.equal(buf[0], 128); // 255 * 0.5
  assert.equal(buf[3], 255); // LED toujours présente
});

test("cône : triangle (base large en bas, apex étroit en haut)", () => {
  const W2 = 9, H2 = 9; // y = 1 - 0.25 j ; apex en +Y (j faible), base en -Y (j élevé)
  const cone: ShapeInput = { kind: "cone", position: pos(), scale: { x: 0.8, y: 0.8, z: 0.8 }, fill: { kind: "solid", color: { r: 1, g: 1, b: 1 } } };
  const a = (buf: Uint8Array, i: number, j: number): number => buf[(j * W2 + i) * 4 + 3];
  const b = rasterizeShapes([cone], W2, H2);
  assert.equal(a(b, 6, 7), 255); // (0.5, -0.75) proche base → dans le cône
  assert.equal(a(b, 6, 1), 0);   // (0.5, +0.75) proche apex → hors du cône
});

test("tore : anneau allumé, centre éteint", () => {
  const W2 = 9, H2 = 9;
  const torus: ShapeInput = { kind: "torus", position: pos(), scale: { x: 1, y: 1, z: 1 }, fill: { kind: "solid", color: { r: 1, g: 1, b: 1 } } };
  const a = (buf: Uint8Array, i: number, j: number): number => buf[(j * W2 + i) * 4 + 3];
  const b = rasterizeShapes([torus], W2, H2);
  assert.equal(a(b, 4, 4), 0);   // centre (0,0) → trou du tore
  assert.equal(a(b, 7, 4), 255); // (0.75, 0) → sur l'anneau
});

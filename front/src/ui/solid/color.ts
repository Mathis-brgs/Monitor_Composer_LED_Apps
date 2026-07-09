import type { RGB } from "@domain/Layer.ts";

/** RGB 0..1 → hex `#rrggbb` (pour <input type="color"> + swatch). */
export function rgbToHex(c: RGB): string {
  const h = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 255).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** hex `#rrggbb` → RGB 0..1. */
export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}

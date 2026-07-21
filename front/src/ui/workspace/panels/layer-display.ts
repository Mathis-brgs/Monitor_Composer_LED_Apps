import { fillPreviewColor, type Layer, type RGB, type ShaderId } from "@domain/Layer.ts";

/** Dégradés de vignette par shader (pour compositor + inspecteur). */
export const SHADER_THUMB: Record<ShaderId, string> = {
  sweep: "linear-gradient(115deg, transparent 25%, var(--acc) 50%, transparent 75%)",
  plasma: "linear-gradient(120deg, var(--acc), var(--pv-b))",
  solid: "var(--acc-fill)",
};

export function rgbToCss(c: RGB): string {
  return `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)})`;
}

/** Fond de la vignette d'un calque selon son type. */
export function thumbBg(l: Layer): string {
  if (l.type === "shader") return SHADER_THUMB[l.shader];
  if (l.type === "shape") return rgbToCss(fillPreviewColor(l.fill));
  if (l.type === "spot") return rgbToCss({ r: l.channels.r / 255, g: l.channels.g / 255, b: l.channels.b / 255 });
  if (l.type === "lyre") return rgbToCss({ r: l.channels.r / 255, g: l.channels.g / 255, b: l.channels.b / 255 });
  return "var(--row-hi)";
}

/** Glyphe monochrome représentant le type d'un calque (outliner compact). `precompKind` distingue précomp/prérendu. */
export function layerGlyph(l: Layer, precompKind?: "precomp" | "prerender"): string {
  switch (l.type) {
    case "precomp": return precompKind === "prerender" ? "◎" : "⧉";
    case "shader": return l.shader === "solid" ? "▭" : "◐";
    case "shape":
      switch (l.shape) {
        case "sphere": return "●";
        case "box": return "◼";
        case "cone": return "▲";
        case "cylinder": return "▮";
        case "plane": return "▱";
        case "torus": return "◍";
      }
      return "◆";
    case "group": return "▸";
    case "image": return "▨";
    case "video": return "▷";
    case "audio": return "♪";
    case "spot": return "✦";
    case "lyre": return "❋";
  }
}

/** Sous-libellé (type lisible) d'un calque. */
export function subtitle(l: Layer): string {
  switch (l.type) {
    case "shader": return l.shader === "sweep" ? "Sweep · balayage" : l.shader === "plasma" ? "Effet procédural" : "Fond uni";
    case "shape": return l.shape === "sphere" ? "Sphère · objet" : "Cube · objet";
    case "group": return `${l.children.length} calques`;
    case "image": return "Image";
    case "video": return "Vidéo";
    case "audio": return "Audio";
    case "spot": return "Projecteur statique";
    case "lyre": return `Lyre · canaux ${l.baseChannel}-${l.baseChannel + 12}`;
    case "precomp": return "Précomposition";
  }
}

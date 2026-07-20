import type { Layer } from "@domain/Layer.ts";

/** Une propriété animable = un libellé + ses canaux scalaires (keyés ensemble). */
export interface PropGroup {
  readonly label: string;
  readonly channels: string[];
}

const PARAM_LABEL: Record<string, string> = { speed: "Vitesse", detail: "Détail", contrast: "Contraste", hue: "Teinte" };

const POSITION: PropGroup = { label: "Position", channels: ["position.x", "position.y", "position.z"] };
const ROTATION: PropGroup = { label: "Rotation", channels: ["rotation.x", "rotation.y", "rotation.z"] };
const SCALE: PropGroup = { label: "Échelle", channels: ["scale.x", "scale.y", "scale.z"] };
const OPACITY: PropGroup = { label: "Opacité", channels: ["opacity"] };
const COLOR: PropGroup = { label: "Couleur", channels: ["color.r", "color.g", "color.b"] };
const VOLUME: PropGroup = { label: "Volume", channels: ["gain"] };

/** Catalogue des propriétés animables d'un calque, contextuel à son type (aligné sur l'inspecteur). */
export function animatableProps(layer: Layer): PropGroup[] {
  switch (layer.type) {
    case "shape": {
      const g = [POSITION, ROTATION, SCALE, OPACITY];
      return layer.fill.type === "solid" ? [...g, COLOR] : g;
    }
    case "shader": {
      const params = Object.keys(layer.params).map((k) => ({ label: PARAM_LABEL[k] ?? k, channels: ["param." + k] }));
      return layer.shader === "solid" ? [...params, COLOR, OPACITY] : [...params, OPACITY];
    }
    case "spot":
    case "lyre":
      return [POSITION, OPACITY];
    case "audio":
      return [VOLUME]; // automation de volume : gain keyframé (lu chaque frame par l'AudioSync)
    default: // group / image / video
      return [OPACITY];
  }
}

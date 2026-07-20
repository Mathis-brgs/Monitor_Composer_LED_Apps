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

// Canaux DMX bruts (spot/lyre) : ce sont les seuls canaux qui font réellement quelque
// chose pour ces calques (position = repère visuel, opacité = sans effet sur le DMX).
const FX_COLOR: PropGroup = { label: "Couleur", channels: ["fx.r", "fx.g", "fx.b"] };
const FX_WHITE: PropGroup = { label: "Blanc", channels: ["fx.w"] };
const FX_PAN: PropGroup = { label: "Pan", channels: ["fx.pan"] };
const FX_PAN_FINE: PropGroup = { label: "Pan fin", channels: ["fx.panFine"] };
const FX_TILT: PropGroup = { label: "Tilt", channels: ["fx.tilt"] };
const FX_TILT_FINE: PropGroup = { label: "Tilt fin", channels: ["fx.tiltFine"] };
const FX_SPEED: PropGroup = { label: "Vitesse", channels: ["fx.speed"] };
const FX_DIMMER: PropGroup = { label: "Dimmer", channels: ["fx.dimmer"] };
const FX_STROBE: PropGroup = { label: "Strobe", channels: ["fx.strobe"] };
const FX_SPECIAL: PropGroup = { label: "Spécial", channels: ["fx.special"] };
const FX_RESET: PropGroup = { label: "Reset", channels: ["fx.reset"] };

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
      return [FX_COLOR, FX_WHITE];
    case "lyre":
      return [FX_PAN, FX_PAN_FINE, FX_TILT, FX_TILT_FINE, FX_SPEED, FX_DIMMER, FX_STROBE, FX_COLOR, FX_WHITE, FX_SPECIAL, FX_RESET];
    case "audio":
      return [VOLUME]; // automation de volume : gain keyframé (lu chaque frame par l'AudioSync)
    default: // group / image / video
      return [OPACITY];
  }
}

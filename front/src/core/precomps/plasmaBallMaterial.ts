import type { Editor } from "../Editor.ts";

const PRESET_NAME = "Plasma braise";

/**
 * Même formule que `Plasma.layer.ts` (4 sinus dont un radial), recolorée en braise (jaune-blanc
 * chaud → rouge sombre) au lieu du orange→rose par défaut. Vrai TSL (voir `MaterialBaker` —
 * espace de noms `three/tsl` complet en scope, pas du JS-maison).
 *
 * `uv()` d'un matériau est TOUJOURS 0..1 sur la forme, quelle que soit sa taille réelle à
 * l'écran — mapper ça directement sur les 0..128 px de la formule fait tenir PLUSIEURS cycles
 * complets des sinus dans la forme (motif dense/agité, "le soleil"). La version pré-rendue
 * (`emberPlasmaBall.ts`) n'échantillonnait qu'une petite fenêtre (rayon ~0.22) du même champ —
 * un calme et simple morceau du motif, pas plusieurs vagues compressées. `SCALE` reproduit cette
 * même fenêtre ici, quelle que soit la taille réelle de la sphère.
 */
const FRAGMENT = `const scale = 0.22;
const px = uv().x.mul(2).sub(1).mul(scale).add(1).mul(0.5).mul(128);
const py = uv().y.mul(2).sub(1).mul(scale).add(1).mul(0.5).mul(128);
const s1 = px.mul(0.09).add(time.mul(1.2)).sin();
const s2 = py.mul(0.08).sub(time.mul(0.9)).sin();
const s3 = px.add(py).mul(0.05).add(time.mul(1.6)).sin();
const dist = length(vec2(px.sub(64), py.sub(64)));
const s4 = dist.mul(0.11).sub(time.mul(2.0)).sin();
const field = s1.add(s2).add(s3).add(s4).mul(0.25);
const v = field.mul(0.5).add(0.5).saturate();
const colA = vec3(1.0, 0.85, 0.35);
const colB = vec3(0.75, 0.08, 0.02);
return mix(colA, colB, v);`;

/**
 * Insère une sphère (cercle vu du mur) avec le matériau "Plasma braise" — réutilise le preset
 * s'il existe déjà dans le document (une seule formule éditable qui met à jour toutes les
 * sphères qui la partagent), en crée un sinon. Item de la toolbox globale (⇧A) — voir
 * `ui/frame/AddPalette.ts`.
 */
export function insertPlasmaBallMaterial(editor: Editor): string {
  const existing = editor.listMaterialPresets().find((p) => p.name === PRESET_NAME);
  const presetId = existing ? existing.id : editor.addMaterialPreset(PRESET_NAME, "emission", FRAGMENT);

  const id = editor.addShape("sphere");
  editor.setName(id, "Boule plasma braise");
  editor.setFill(id, { type: "material", presetId });
  return id;
}

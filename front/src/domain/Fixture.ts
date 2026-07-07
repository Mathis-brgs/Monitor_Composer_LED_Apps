/**
 * Une entité = un pixel adressable (une LED RGB). Le front ne raisonne QU'EN
 * entités ; le câblage (IP/univers/canal) est l'affaire du routage Go.
 */
export interface FixtureEntity {
  /** identifiant eHuB, unique, pas forcément séquentiel */
  readonly ehubId: number;
  /** colonne dans la source 2D échantillonnée (0..width-1) */
  readonly x: number;
  /** ligne dans la source 2D (0 = bas) */
  readonly y: number;
  /** partition eHuB (ici : index contrôleur 0..3) */
  readonly group: number;
}

export interface EntityRange {
  readonly startEntity: number;
  readonly endEntity: number;
}

/** Une installation : sa taille 2D (pour l'échantillonnage) et ses entités. */
export abstract class Fixture {
  abstract readonly id: string;
  abstract readonly width: number;
  abstract readonly height: number;
  abstract readonly entities: readonly FixtureEntity[];

  /** groupes eHuB présents (triés) */
  groups(): number[] {
    return [...new Set(this.entities.map((e) => e.group))].sort((a, b) => a - b);
  }

  /** plages d'ehubId contiguës d'un groupe (pour le message eHuB config) */
  ranges(group: number): EntityRange[] {
    const ids = this.entities
      .filter((e) => e.group === group)
      .map((e) => e.ehubId)
      .sort((a, b) => a - b);

    const out: EntityRange[] = [];
    let start = -1;
    let prev = -1;
    for (const id of ids) {
      if (start === -1) start = id;
      else if (id !== prev + 1) {
        out.push({ startEntity: start, endEntity: prev });
        start = id;
      }
      prev = id;
    }
    if (start !== -1) out.push({ startEntity: start, endEntity: prev });
    return out;
  }
}

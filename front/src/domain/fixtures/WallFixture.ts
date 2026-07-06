import { Fixture, type FixtureEntity } from "../Fixture.ts";
import segments from "./wall.segments.json";

// entité de départ (LED physique 0) de chaque bande = 1er segment (univers pair).
const STRIP_START: number[] = [];
for (let s = 0; s < 64; s++) STRIP_START[s] = segments.strips[s * 2].entityStart;

/**
 * Mur de test LAPS : 128×128, 64 bandes serpentin. Convertit chaque pixel (x,y)
 * en entité eHuB (données réelles de Ecran.xlsx). group = index contrôleur (0..3).
 *
 * Géométrie serpentin flippable si le mur s'affiche en miroir/retourné.
 */
export class WallFixture extends Fixture {
  readonly id = "wall";
  readonly width = segments.width;
  readonly height = segments.height;
  readonly entities: readonly FixtureEntity[];

  constructor(
    private readonly upIsEvenColumn = true,
    private readonly originBottom = true,
  ) {
    super();
    this.entities = this._build();
  }

  private _build(): FixtureEntity[] {
    const out: FixtureEntity[] = [];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const strip = Math.floor(x / 2);
        const even = x % 2 === 0;
        const up = this.upIsEvenColumn ? even : !even;
        const yy = this.originBottom ? y : this.height - 1 - y;
        const physical = up ? 1 + yy : 130 + (this.height - 1 - yy);
        out.push({
          ehubId: STRIP_START[strip] + physical,
          x,
          y,
          group: Math.floor(strip / 16), // 0..3 = contrôleur .45..48
        });
      }
    }
    return out;
  }
}

import { Fixture, type FixtureEntity } from "@domain/Fixture.ts";
import segments from "./wall.segments.json";

// entité de départ (LED physique 0) de chaque bande = 1er segment (univers pair).
const STRIP_START: number[] = [];
for (let s = 0; s < 64; s++) STRIP_START[s] = segments.strips[s * 2].entityStart;

/** Fixture personnalisée à dimensions variables, mappée sur la géométrie physique du mur LAPS. */
export class CustomFixture extends Fixture {
  readonly id = "custom";
  readonly entities: readonly FixtureEntity[];

  constructor(readonly width: number, readonly height: number) {
    super();
    const entities: FixtureEntity[] = [];

    // Limiter aux dimensions physiques maximales du mur (128x128)
    const W = Math.min(128, width);
    const H = Math.min(128, height);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const strip = Math.floor(x / 2);
        const even = x % 2 === 0;
        const up = even; // upIsEvenColumn = true par défaut
        const yy = y;    // originBottom = true par défaut
        // La hauteur physique d'une bande est 128 visible
        const physical = up ? 1 + yy : 130 + (128 - 1 - yy);

        entities.push({
          ehubId: STRIP_START[strip] + physical,
          x,
          y,
          group: Math.floor(strip / 16),
        });
      }
    }
    this.entities = entities;
  }
}

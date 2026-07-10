import { Fixture, type FixtureEntity } from "@domain/Fixture.ts";
import segments from "./wall.segments.json";

// entité de départ (LED physique 0) de chaque bande = 1er segment (univers pair).
const STRIP_START: number[] = [];
for (let s = 0; s < 64; s++) STRIP_START[s] = segments.strips[s * 2].entityStart;

/** Fixture de test compacte de 32x32 pixels, mappée sur le serpentin physique LAPS. */
export class TinyWallFixture extends Fixture {
  readonly id = "tiny-wall";
  readonly width = 32;
  readonly height = 32;
  readonly entities: readonly FixtureEntity[];

  constructor() {
    super();
    const entities: FixtureEntity[] = [];
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const strip = Math.floor(x / 2);
        const even = x % 2 === 0;
        const up = even;
        const yy = y;
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

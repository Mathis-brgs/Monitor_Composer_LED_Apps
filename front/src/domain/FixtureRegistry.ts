import type { Fixture } from "./Fixture.ts";
import { WallFixture } from "./fixtures/WallFixture.ts";
import { TinyWallFixture } from "./fixtures/TinyWallFixture.ts";
import { CustomFixture } from "./fixtures/CustomFixture.ts";

/** Registre des fixtures supportées par l'application. */
export class FixtureRegistry {
  private static readonly _registry = new Map<string, () => Fixture>();

  static register(id: string, factory: () => Fixture): void {
    this._registry.set(id, factory);
  }

  static resolve(id: string, customWidth = 128, customHeight = 128): Fixture {
    if (id === "custom") {
      return new CustomFixture(customWidth, customHeight);
    }
    const factory = this._registry.get(id);
    if (!factory) {
      console.warn(`Fixture "${id}" inconnue, repli sur "wall".`);
      return new WallFixture();
    }
    return factory();
  }

  static getAvailableIds(): string[] {
    return Array.from(this._registry.keys());
  }
}

// Enregistrement par défaut
FixtureRegistry.register("wall", () => new WallFixture());
FixtureRegistry.register("tiny-wall", () => new TinyWallFixture());
FixtureRegistry.register("custom", () => new CustomFixture(128, 128));

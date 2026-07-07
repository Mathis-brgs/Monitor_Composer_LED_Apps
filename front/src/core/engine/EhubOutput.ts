import type { RenderTarget, WebGPURenderer } from "three/webgpu";
import type { Fixture, FixtureEntity } from "@domain/Fixture.ts";
import type { Transport } from "@core/transport.ts";
import { encodeConfig, encodeUpdate, gzipBrowser, type EhubEntity, type EhubRange } from "@core/ehub.ts";
import type { Project } from "@domain/Project.ts";

/**
 * Site unique de SORTIE : lit la render target (readback GPU→CPU), construit les
 * messages eHuB `update` par groupe (1 univers eHuB = 1 contrôleur) et les pousse
 * sur le transport. Cadencé ~40 Hz par ThreeDevice, découplé du rendu.
 *
 * ⚠ Y-flip possible du readback à vérifier sur le vrai rendu (origine bas/haut).
 */
export class EhubOutput {
  private _busy = false;
  private readonly _byGroup = new Map<number, FixtureEntity[]>();

  constructor(
    private readonly _renderer: WebGPURenderer,
    private readonly _target: RenderTarget,
    private readonly _fixture: Fixture,
    private readonly _transport: Transport,
    private readonly _project: Project,
  ) {
    for (const group of _fixture.groups()) {
      this._byGroup.set(group, _fixture.entities.filter((e) => e.group === group));
    }
  }

  async tick(): Promise<void> {
    if (this._busy || !this._transport.connected) return;
    this._busy = true;
    try {
      const w = this._fixture.width;
      const rgba = (await this._renderer.readRenderTargetPixelsAsync(
        this._target,
        0,
        0,
        w,
        this._fixture.height,
      )) as Uint8Array;

      const drawings = this._project.config.drawings ?? {};

      for (const [group, entities] of this._byGroup) {
        const payload: EhubEntity[] = entities.map((e) => {
          const drawColor = drawings[e.ehubId];
          if (drawColor === "red") {
            return { id: e.ehubId, r: 255, g: 0, b: 0, w: 0 };
          } else if (drawColor === "blue") {
            return { id: e.ehubId, r: 0, g: 0, b: 255, w: 0 };
          } else if (drawColor === "green") {
            return { id: e.ehubId, r: 0, g: 255, b: 0, w: 0 };
          } else if (drawColor === "white") {
            return { id: e.ehubId, r: 255, g: 255, b: 255, w: 255 };
          }

          const o = (e.y * w + e.x) * 4;
          return {
            id: e.ehubId,
            r: rgba[o],
            g: rgba[o + 1],
            b: rgba[o + 2],
            w: 0,
          };
        });
        this._transport.send(await encodeUpdate(group, payload, gzipBrowser));
      }
    } finally {
      this._busy = false;
    }
  }

  async sendConfig(): Promise<void> {
    if (!this._transport.connected) return;
    for (const [group, entities] of this._byGroup) {
      const sortedIds = entities.map((e) => e.ehubId).sort((a, b) => a - b);
      const fixtureRanges = this._fixture.ranges(group);

      const ranges: EhubRange[] = fixtureRanges.map((r) => {
        const startSextet = sortedIds.indexOf(r.startEntity);
        const endSextet = sortedIds.indexOf(r.endEntity);
        return {
          startSextet,
          startEntity: r.startEntity,
          endSextet,
          endEntity: r.endEntity,
        };
      });

      const configPacket = await encodeConfig(group, ranges, gzipBrowser);
      this._transport.send(configPacket);
    }
  }
}

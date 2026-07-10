import type { RenderTarget, WebGPURenderer } from "three/webgpu";
import type { Fixture, FixtureEntity } from "@domain/Fixture.ts";
import type { Transport } from "@core/transport.ts";
import { encodeConfig, encodeUpdate, gzipBrowser, type EhubEntity, type EhubRange } from "@core/ehub.ts";

// Un groupe entier (~4096 entités) tient largement dans les 65 Ko max d'un
// message eHuB, mais dépasse la taille qu'un datagramme UDP peut envoyer d'un
// coup (EMSGSIZE dès ~16 Ko sur boucle locale macOS, une vraie carte Ethernet
// est encore plus stricte avec sa MTU ~1500o). sendBlackout découpe donc en
// plusieurs messages `update`, 200 entités brutes = 1200o, marge de sécurité
// même si le payload compresse mal.
const MAX_ENTITIES_PER_MESSAGE = 200;

/**
 * Site unique de SORTIE : lit la render target (readback GPU→CPU), construit les
 * messages eHuB `update` par groupe (1 univers eHuB = 1 contrôleur) et les pousse
 * sur le transport. Cadencé ~40 Hz par ThreeDevice, découplé du rendu.
 *
 * ⚠ Y-flip possible du readback à vérifier sur le vrai rendu (origine bas/haut).
 */
export class EhubOutput {
  private _busy = false; // tick() : ignore l'appel si un readback est déjà en cours (best-effort temps réel, on droppe la frame plutôt que d'empiler)
  private _pending: Promise<void> | null = null; // opération d'envoi en cours (tick ou blackout) — sendBlackout s'y enchaîne pour rester TOUJOURS le dernier paquet envoyé
  private readonly _byGroup = new Map<number, FixtureEntity[]>();

  constructor(
    private readonly _renderer: WebGPURenderer,
    private readonly _target: RenderTarget,
    private readonly _fixture: Fixture,
    private readonly _transport: Transport,
  ) {
    for (const group of _fixture.groups()) {
      this._byGroup.set(group, _fixture.entities.filter((e) => e.group === group));
    }
  }

  async tick(): Promise<void> {
    if (this._busy || !this._transport.connected) return;
    this._busy = true;
    const work = this._doTick().finally(() => { this._busy = false; });
    this._pending = work;
    return work;
  }

  private async _doTick(): Promise<void> {
    const w = this._fixture.width;
    const rgba = (await this._renderer.readRenderTargetPixelsAsync(
      this._target,
      0,
      0,
      w,
      this._fixture.height,
    )) as Uint8Array;

    for (const [group, entities] of this._byGroup) {
      const payload: EhubEntity[] = entities.map((e) => {
        const o = (e.y * w + e.x) * 4;
        return { id: e.ehubId, r: rgba[o], g: rgba[o + 1], b: rgba[o + 2], w: 0 };
      });
      this._transport.send(await encodeUpdate(group, payload, gzipBrowser));
    }
  }

  /**
   * Envoie une frame entièrement noire (éteint le mur), sans lire le rendu.
   * Utilisé à la sortie du mode LIVE : sans ça, le mur resterait figé sur la
   * dernière image envoyée au lieu de s'éteindre. Découpé en plusieurs
   * messages UDP par groupe pour rester sous la taille qu'un datagramme peut
   * transporter d'un coup (voir MAX_ENTITIES_PER_MESSAGE).
   *
   * Attend d'abord un éventuel tick() en cours : sinon le readback GPU en vol
   * peut renvoyer sa frame "allumée" APRÈS le noir (course gagnée au hasard
   * selon le timing GPU), et le mur reste partiellement allumé.
   */
  async sendBlackout(): Promise<void> {
    if (!this._transport.connected) return;
    if (this._pending) await this._pending.catch(() => {});
    const work = this._doBlackout();
    this._pending = work;
    await work;
  }

  private async _doBlackout(): Promise<void> {
    for (const [group, entities] of this._byGroup) {
      const payload: EhubEntity[] = entities.map((e) => ({ id: e.ehubId, r: 0, g: 0, b: 0, w: 0 }));
      for (let i = 0; i < payload.length; i += MAX_ENTITIES_PER_MESSAGE) {
        const chunk = payload.slice(i, i + MAX_ENTITIES_PER_MESSAGE);
        this._transport.send(await encodeUpdate(group, chunk, gzipBrowser));
      }
    }
  }

  /** Envoie la config des plages de contrôleurs au routage Go. */
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

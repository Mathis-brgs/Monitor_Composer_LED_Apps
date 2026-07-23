// Encodage eHuB (contrat avec le routage Go de Mathis). SOURCE UNIQUE du format.
//
// ⚠ À VERROUILLER AVEC MATHIS avant l'intégration réelle :
//   - endianness des unsigned short (ici LITTLE-endian)
//   - octet de type du message `config` (ici 1 ; le cours ne fixe que update=2)
//   - découpage en univers eHuB pour rester < 65 Ko UDP (ici 1 univers = 1 contrôleur)

export interface EhubEntity {
  readonly id: number;
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly w: number;
}

export interface EhubRange {
  readonly startSextet: number;
  readonly startEntity: number;
  readonly endSextet: number;
  readonly endEntity: number;
}

export type Gzip = (data: Uint8Array) => Promise<Uint8Array>;

const MAGIC = [0x65, 0x48, 0x75, 0x42]; // "eHuB"
const TYPE_CONFIG = 1;
const TYPE_UPDATE = 2;
const LE = true;

/** Payload `update` non compressé : sextets (6 o) triés par id croissant. */
export function buildUpdatePayload(entities: EhubEntity[]): Uint8Array {
  const sorted = [...entities].sort((a, b) => a.id - b.id);
  const buf = new Uint8Array(sorted.length * 6);
  const dv = new DataView(buf.buffer);
  let o = 0;
  for (const e of sorted) {
    dv.setUint16(o, e.id, LE);
    buf[o + 2] = e.r;
    buf[o + 3] = e.g;
    buf[o + 4] = e.b;
    buf[o + 5] = e.w;
    o += 6;
  }
  return buf;
}

/** Message `update` : en-tête (10 o) + payload GZip. */
export async function encodeUpdate(
  universe: number,
  entities: EhubEntity[],
  gzip: Gzip,
): Promise<Uint8Array> {
  const compressed = await gzip(buildUpdatePayload(entities));
  const out = new Uint8Array(10 + compressed.length);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = TYPE_UPDATE;
  out[5] = universe & 0xff;
  dv.setUint16(6, entities.length, LE);
  dv.setUint16(8, compressed.length, LE);
  out.set(compressed, 10);
  return out;
}

/** Payload `config` non compressé : plages (8 o chacune). */
export function buildConfigPayload(ranges: EhubRange[]): Uint8Array {
  const buf = new Uint8Array(ranges.length * 8);
  const dv = new DataView(buf.buffer);
  let o = 0;
  for (const r of ranges) {
    dv.setUint16(o, r.startSextet, LE);
    dv.setUint16(o + 2, r.startEntity, LE);
    dv.setUint16(o + 4, r.endSextet, LE);
    dv.setUint16(o + 6, r.endEntity, LE);
    o += 8;
  }
  return buf;
}

/** Message `config` : en-tête (10 o, même format que `update`) + plages GZip. */
export async function encodeConfig(
  universe: number,
  ranges: EhubRange[],
  gzip: Gzip,
): Promise<Uint8Array> {
  const compressed = await gzip(buildConfigPayload(ranges));
  const out = new Uint8Array(10 + compressed.length);
  const dv = new DataView(out.buffer);
  out.set(MAGIC, 0);
  out[4] = TYPE_CONFIG;
  out[5] = universe & 0xff;
  dv.setUint16(6, ranges.length, LE);
  dv.setUint16(8, compressed.length, LE);
  out.set(compressed, 10);
  return out;
}

/** GZip navigateur (CompressionStream). Côté Node, injecter zlib à la place. */
export const gzipBrowser: Gzip = async (data) => {
  const cs = new CompressionStream("gzip");
  const stream = new Response(data as BodyInit).body!.pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

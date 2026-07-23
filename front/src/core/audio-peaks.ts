/**
 * Réduit un canal PCM (`Float32Array`, échantillons -1..1) en `buckets` paires
 * (min, max) pour tracer une waveform. Sortie entrelacée
 * `[min0, max0, min1, max1, …]` de longueur `buckets * 2`. Pur (testable node).
 */
export function computePeaks(channel: Float32Array, buckets: number): Float32Array {
  const n = Math.max(0, Math.floor(buckets));
  const out = new Float32Array(n * 2);
  if (channel.length === 0 || n === 0) return out;
  const per = channel.length / n;
  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(channel.length, Math.max(start + 1, Math.floor((b + 1) * per)));
    let min = channel[start];
    let max = channel[start];
    for (let i = start + 1; i < end; i++) {
      const v = channel[i];
      if (v < min) min = v;
      else if (v > max) max = v;
    }
    out[b * 2] = min;
    out[b * 2 + 1] = max;
  }
  return out;
}

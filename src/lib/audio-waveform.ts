/** Bounded PCM WAV sampling. Compressed/unsupported formats use a progress line. */
export function audioWaveform(bytes: Uint8Array, count = 40): number[] | null {
  if (bytes.length < 44 || count < 1 || count > 100) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let channels = 0;
  let bits = 0;
  let pcm = false;
  let dataOffset = 0;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (length > bytes.length - start) return null;
    const name = tag(offset);
    if (name === 'fmt ' && length >= 16) {
      pcm = view.getUint16(start, true) === 1;
      channels = view.getUint16(start + 2, true);
      bits = view.getUint16(start + 14, true);
    } else if (name === 'data') {
      dataOffset = start;
      dataLength = length;
    }
    offset = start + length + (length % 2);
  }
  if (!pcm || channels < 1 || channels > 8 || ![8, 16].includes(bits)) return null;
  const stride = channels * (bits / 8);
  const frames = Math.floor(dataLength / stride);
  if (!frames || !dataOffset) return null;
  const peaks = Array.from({ length: count }, (_, bar) => {
    const start = Math.floor((bar * frames) / count);
    const end = Math.floor(((bar + 1) * frames) / count);
    const step = Math.max(1, Math.floor((end - start) / 64));
    let energy = 0;
    let samples = 0;
    for (let frame = start; frame < end; frame += step) {
      for (let channel = 0; channel < channels; channel++) {
        const offset = dataOffset + frame * stride + channel * (bits / 8);
        const sample =
          bits === 16 ? view.getInt16(offset, true) / 32768 : (view.getUint8(offset) - 128) / 128;
        energy += sample * sample;
        samples++;
      }
    }
    return samples ? Math.sqrt(energy / samples) : 0;
  });
  const peak = Math.max(...peaks);
  return peaks.map((value) => (peak ? value / peak : 0));
}

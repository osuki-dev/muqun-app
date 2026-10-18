import { expect, test } from 'bun:test';
import { VoicePcmEncoder } from '../voice-pcm';

function encode(samples: Float32Array, rate: number, size: number) {
  const encoder = new VoicePcmEncoder();
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < samples.length; offset += size) {
    chunks.push(encoder.push(samples.slice(offset, offset + size).buffer, rate, 1).bytes);
  }
  chunks.push(encoder.flush().bytes);
  return { bytes: Buffer.concat(chunks), seconds: encoder.seconds };
}

test('24 kHz mono capture stays bit-exact and reports time from frames', () => {
  const encoder = new VoicePcmEncoder();
  const samples = new Float32Array([0, 1, -1, 0.5]);
  const { bytes } = encoder.push(samples.buffer, 24000, 1);
  expect([...new Int16Array(bytes.buffer)]).toEqual([0, 32767, -32768, 16384]);
  expect(encoder.seconds).toBe(4 / 24000);
  expect(encoder.flush().bytes.length).toBe(0);
});

test('fallback rates preserve duration and phase across irregular native buffers', () => {
  for (const rate of [48000, 44100, 16000, 22050, 8000]) {
    const samples = Float32Array.from(
      { length: rate / 10 },
      (_, i) => 0.5 * Math.sin((2 * Math.PI * 1000 * i) / rate)
    );
    const whole = encode(samples, rate, samples.length);
    const fragmented = encode(samples, rate, 137);
    expect(fragmented.bytes).toEqual(whole.bytes);
    expect(fragmented.bytes.length).toBe(2400 * 2);
    expect(fragmented.seconds).toBeCloseTo(0.1);
    for (let i = 32; i < 2368; i++) {
      const actual = fragmented.bytes.readInt16LE(i * 2) / 32768;
      const expected = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / 24000);
      expect(Math.abs(actual - expected)).toBeLessThan(0.015);
    }
  }
});

test('downsampling suppresses out-of-band energy instead of aliasing it into speech', () => {
  const samples = Float32Array.from(
    { length: 4800 },
    (_, i) => 0.5 * Math.sin((2 * Math.PI * 18000 * i) / 48000)
  );
  const { bytes } = encode(samples, 48000, 480);
  for (let i = 32; i < 2368; i++)
    expect(Math.abs(bytes.readInt16LE(i * 2) / 32768)).toBeLessThan(0.01);
});

test('stereo is mixed to mono and invalid or changing formats fail explicitly', () => {
  const encoder = new VoicePcmEncoder();
  expect([...encoder.push(new Float32Array([1, -1, 0.5, 0.5]).buffer, 24000, 2).bytes]).toEqual([
    0, 0, 0, 64,
  ]);
  expect(() => encoder.push(new ArrayBuffer(3), 24000, 1)).toThrow();
  expect(() => encoder.push(new ArrayBuffer(8), 48000, 1)).toThrow();
  expect(() => new VoicePcmEncoder().push(new ArrayBuffer(8), 24000, 0)).toThrow();
});

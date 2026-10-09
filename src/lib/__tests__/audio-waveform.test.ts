import { describe, expect, test } from 'bun:test';
import { audioWaveform } from '../audio-waveform';

function wav(samples: number[]) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string) => bytes.set(new TextEncoder().encode(value), offset);
  tag(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => view.setInt16(44 + index * 2, sample, true));
  return bytes;
}

describe('PCM waveform sampling', () => {
  test('reads actual relative energy and keeps silence flat', () => {
    expect(audioWaveform(wav([0, 0, 1000, -1000, 2000, -2000, 0, 0]), 4)).toEqual([0, 0.5, 1, 0]);
    expect(audioWaveform(wav([0, 0, 0, 0]), 2)).toEqual([0, 0]);
  });
  test('refuses compressed, unsupported and truncated data', () => {
    expect(audioWaveform(new TextEncoder().encode('ID3 compressed audio'))).toBeNull();
    const bytes = wav([100, 200]);
    expect(audioWaveform(bytes.subarray(0, bytes.length - 1))).toBeNull();
    new DataView(bytes.buffer).setUint16(20, 3, true);
    expect(audioWaveform(bytes)).toBeNull();
  });
  test('handles a view into another buffer without reading adjacent bytes', () => {
    const source = wav([1000, -1000]);
    const backing = new Uint8Array(source.length + 12);
    backing.set(source, 6);
    expect(audioWaveform(backing.subarray(6, 6 + source.length), 1)).toEqual([1]);
  });
});

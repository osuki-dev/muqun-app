import { describe, expect, it } from 'bun:test';
import { VoiceMeterHistory, VOICE_METER_SAMPLES } from '../voice-meter-history';

describe('microphone waveform history', () => {
  it('keeps silence still and never invents an amplitude', () => {
    const meter = new VoiceMeterHistory();
    for (let sample = 0; sample < 40; sample++)
      expect(meter.push(0, sample / 10)).toEqual(Array(VOICE_METER_SAMPLES).fill(0));
  });

  it('retains the actual temporal pattern and peaks between display samples', () => {
    const meter = new VoiceMeterHistory();
    meter.push(0, 0);
    expect(meter.push(0.81, 0.02)).toBeUndefined();
    const first = meter.push(0.04, 0.08)!;
    expect(first.at(-1)).toBe(0.9);
    const second = meter.push(0.25, 0.16)!;
    expect(second.slice(-2)).toEqual([0.9, 0.5]);
    expect(first.at(-1)).toBe(0.9); // Published animation targets are immutable.
    expect(second.length).toBe(VOICE_METER_SAMPLES);
  });

  it('clamps amplitudes and rejects invalid or stale native samples', () => {
    const meter = new VoiceMeterHistory();
    expect(meter.push(9, 1)?.at(-1)).toBe(1);
    expect(meter.push(NaN, 2)).toBeUndefined();
    expect(meter.push(1, Infinity)).toBeUndefined();
    expect(meter.push(1, 0.5)).toBeUndefined();
    expect(meter.push(-2, 2)?.at(-1)).toBe(0);
  });

  it('ages a speech peak out using subsequent real silent samples', () => {
    const meter = new VoiceMeterHistory();
    meter.push(1, 0);
    let values: number[] | undefined;
    for (let sample = 1; sample <= VOICE_METER_SAMPLES; sample++)
      values = meter.push(0, sample / 10);
    expect(values).toEqual(Array(VOICE_METER_SAMPLES).fill(0));
  });
});

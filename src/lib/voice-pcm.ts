import { voicePcm16 } from './voice-realtime-protocol';

const OUTPUT_RATE = 24000;
const RADIUS = 16;

/** Converts Expo's interleaved float buffers to mono PCM16. Most devices supply
 * 24 kHz directly. A windowed-sinc filter handles hardware fallback rates
 * without changing pitch or losing phase at buffer boundaries. */
export class VoicePcmEncoder {
  private rate = 0;
  private pending = new Float32Array(0);
  private base = 0;
  private inputFrames = 0;
  private outputFrames = 0;

  push(data: ArrayBuffer, sampleRate: number, channels: number) {
    if (
      !Number.isInteger(channels) ||
      channels < 1 ||
      channels > 2 ||
      !Number.isFinite(sampleRate) ||
      sampleRate < 8000 ||
      sampleRate > 96000 ||
      data.byteLength % (4 * channels)
    ) {
      throw new Error('Unexpected microphone format');
    }
    if (this.rate && this.rate !== sampleRate) throw new Error('Microphone format changed');
    this.rate = sampleRate;
    const interleaved = new Float32Array(data);
    const mono = new Float32Array(interleaved.length / channels);
    for (let frame = 0; frame < mono.length; frame++) {
      let value = 0;
      for (let channel = 0; channel < channels; channel++)
        value += interleaved[frame * channels + channel]! / channels;
      mono[frame] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    }
    this.inputFrames += mono.length;
    if (sampleRate === OUTPUT_RATE) return voicePcm16([mono], mono.length, OUTPUT_RATE);
    const joined = new Float32Array(this.pending.length + mono.length);
    joined.set(this.pending);
    joined.set(mono, this.pending.length);
    this.pending = joined;
    return this.encode(false);
  }

  flush() {
    if (!this.rate || this.rate === OUTPUT_RATE)
      return voicePcm16([new Float32Array(0)], 0, OUTPUT_RATE);
    return this.encode(true);
  }

  get seconds() {
    return this.rate ? this.inputFrames / this.rate : 0;
  }

  private encode(flush: boolean) {
    const step = this.rate / OUTPUT_RATE;
    const cutoff = Math.min(1, 1 / step) * 0.9;
    const samples: number[] = [];
    const ceiling = Math.floor(this.inputFrames / step);
    while (this.outputFrames < ceiling) {
      const position = this.outputFrames * step;
      if (!flush && position + RADIUS >= this.inputFrames) break;
      const center = Math.floor(position);
      let sum = 0;
      let weights = 0;
      for (let index = center - RADIUS + 1; index <= center + RADIUS; index++) {
        const distance = position - index;
        const x = Math.PI * distance * cutoff;
        const sinc = Math.abs(x) < 1e-8 ? 1 : Math.sin(x) / x;
        const weight = sinc * (0.5 + 0.5 * Math.cos((Math.PI * distance) / RADIUS));
        const cursor = Math.max(0, Math.min(this.pending.length - 1, index - this.base));
        sum += this.pending[cursor]! * weight;
        weights += weight;
      }
      samples.push(sum / weights);
      this.outputFrames++;
    }
    const keepFrom = Math.max(this.base, Math.floor(this.outputFrames * step) - RADIUS);
    this.pending = this.pending.slice(keepFrom - this.base);
    this.base = keepFrom;
    const output = Float32Array.from(samples);
    return voicePcm16([output], output.length, OUTPUT_RATE);
  }
}

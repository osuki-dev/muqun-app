export const VOICE_METER_SAMPLES = 24;

/** A rolling history of actual microphone peaks, bounded independently of native buffer size. */
export class VoiceMeterHistory {
  private samples = Array<number>(VOICE_METER_SAMPLES).fill(0);
  private lastSeconds = -Infinity;
  private peak = 0;

  push(level: number, seconds: number): number[] | undefined {
    if (!Number.isFinite(level) || !Number.isFinite(seconds) || seconds < this.lastSeconds)
      return undefined;
    this.peak = Math.max(this.peak, Math.max(0, Math.min(1, level)));
    if (seconds - this.lastSeconds < 0.075) return undefined;
    // Both capture backends provide normalized dB. Square root makes quiet
    // speech legible without inventing activity when the measured level is zero.
    this.samples = [...this.samples.slice(1), Math.sqrt(this.peak)];
    this.peak = 0;
    this.lastSeconds = seconds;
    return this.samples;
  }
}

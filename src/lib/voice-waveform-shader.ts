import { VOICE_METER_SAMPLES } from './voice-meter-history';

/** Transparent continuous ribbons; measured energy shapes them, time only adds breath. */
export const VOICE_WAVEFORM_SKSL = `
uniform float2 size;
uniform float time;
uniform float motion;
uniform float processing;
uniform float amplitudes[${VOICE_METER_SAMPLES}];
uniform float3 tint;
uniform float3 highlight;
uniform float tintOpacity;

float sampleAt(float position) {
  float value = 0.0;
  ${Array.from({ length: VOICE_METER_SAMPLES }, (_, index) => `value += amplitudes[${index}] * max(0.0, 1.0 - abs(position - ${index}.0));`).join('\n  ')}
  return clamp(value, 0.0, 1.0);
}

half4 main(float2 coord) {
  float width = max(size.x, 1.0);
  float height = max(size.y, 1.0);
  float phase = time * motion;
  float progress = clamp(processing, 0.0, 1.0);
  float2 center = float2(width, height) * 0.5;
  float spread = mix(width, min(width, height * 1.5), progress);
  float x = (coord.x - center.x) / spread + 0.5;
  float boundedX = clamp(x, 0.0, 1.0);
  float envelope = pow(max(0.0, sin(boundedX * 3.14159265)), 0.8);
  // Interpolated samples avoid the hard steps of a discrete meter. The recent
  // sample gives the whole ribbon an immediate response to a new syllable.
  float energy = mix(sampleAt(boundedX * ${VOICE_METER_SAMPLES - 1}.0), amplitudes[${VOICE_METER_SAMPLES - 1}], 0.35);
  float breath = 0.8 + 0.4 * sin(phase * 1.8);
  float amplitude = (breath + energy * height * 0.30) * envelope;
  float y = coord.y - center.y;
  float waveA = sin(x * 12.56637 - phase * 2.6) * amplitude;
  float waveB = sin(x * 12.56637 - phase * 2.6 + 1.15) * amplitude * 0.72;
  float waveC = sin(x * 9.42478 - phase * 2.0 - 1.2) * amplitude * 0.45;
  float inkA = 1.0 - smoothstep(0.45, 1.5, abs(y - waveA));
  float inkB = 1.0 - smoothstep(0.3, 1.25, abs(y - waveB));
  float inkC = 1.0 - smoothstep(0.2, 1.15, abs(y - waveC));
  float edge = smoothstep(0.0, 0.09, boundedX) * smoothstep(0.0, 0.09, 1.0 - boundedX);
  float wave = (inkA * 0.72 + inkB * 0.28 + inkC * 0.16) * edge * (1.0 - progress);

  float2 p = coord - center;
  float angle = atan(p.y, p.x);
  float radius = min(height * 0.28, 12.0);
  float orbitRadius = radius + sin(angle * 3.0 - phase * 2.2) * 0.65;
  float ring = 1.0 - smoothstep(0.45, 1.5, abs(length(p) - orbitRadius));
  float orbit = 0.35 + 0.55 * pow(0.5 + 0.5 * cos(angle - phase * 3.0), 2.0);
  float alpha = clamp(wave + ring * orbit * progress, 0.0, 0.95) * clamp(tintOpacity, 0.0, 1.0);
  float3 color = mix(tint, highlight, inkB * 0.12 * (1.0 - progress));
  return half4(color * alpha, alpha);
}`;

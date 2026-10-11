import { VOICE_METER_SAMPLES } from './voice-meter-history';

/** Single-pass capsule/bloom shader. Time changes light, never recorded amplitude. */
export const VOICE_WAVEFORM_SKSL = `
uniform float2 size;
uniform float time;
uniform float motion;
uniform float amplitudes[${VOICE_METER_SAMPLES}];
uniform float3 tint;
uniform float3 highlight;

half4 main(float2 coord) {
  float width = max(size.x, 1.0);
  float height = max(size.y, 1.0);
  float lane = width / ${VOICE_METER_SAMPLES}.0;
  int index = int(clamp(floor(coord.x / lane), 0.0, ${VOICE_METER_SAMPLES - 1}.0));
  float amplitude = 0.0;
  ${Array.from({ length: VOICE_METER_SAMPLES }, (_, index) => `if (index == ${index}) amplitude = amplitudes[${index}];`).join('\n  ')}
  amplitude = clamp(amplitude, 0.0, 1.0);
  float radius = min(1.5, lane * 0.23);
  float extent = amplitude * max(0.0, height * 0.5 - radius - 2.0) * motion;
  float2 p = float2(coord.x - (float(index) + 0.5) * lane,
    max(abs(coord.y - height * 0.5) - extent, 0.0));
  float distance = length(p) - radius;
  float ink = 1.0 - smoothstep(-0.5, 0.6, distance);
  float bloom = exp(-max(distance, 0.0) / (1.3 + amplitude * 0.8));

  // The slow glint is recording activity, separate from measured bar height.
  // It remains restrained on a silent microphone and freezes in reduced motion.
  float sweep = fract(time * 0.22 * motion) * 1.5 - 0.25;
  float glint = exp(-pow((coord.x / width - sweep) / 0.16, 2.0));
  float edge = smoothstep(0.0, 2.0, coord.y) * smoothstep(0.0, 2.0, height - coord.y);
  float halo = bloom * (0.045 + amplitude * 0.15 + glint * 0.055);
  float alpha = clamp(ink * (0.38 + amplitude * 0.48 + glint * 0.12) + halo, 0.0, 1.0) * edge;
  float3 color = mix(tint, highlight, glint * (0.18 + amplitude * 0.22));
  return half4(color * alpha, alpha);
}`;

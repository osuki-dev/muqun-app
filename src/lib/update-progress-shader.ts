/** Time moves light inside the downloaded area; only SDK progress moves its edge. */
export const UPDATE_PROGRESS_SKSL = `
uniform float2 size;
uniform float progress;
uniform float time;
uniform float3 tint;
half4 main(float2 p) {
  float edge = clamp(progress, 0.0, 1.0) * size.x;
  if (p.x >= edge || edge <= 0.0) return half4(0.0);
  float y = abs(p.y - size.y * 0.5);
  float core = 1.0 - smoothstep(1.0, 2.0, y);
  float glow = exp(-y * y / 6.0) * 0.25;
  float wave = 0.5 + 0.5 * sin(p.x * 0.06 - time * 2.8);
  float tip = exp(-pow((p.x - edge + 4.0) / 14.0, 2.0));
  float light = 0.10 * wave + 0.22 * tip;
  float alpha = min(1.0, core * 0.9 + glow);
  return half4(mix(tint, float3(1.0), light) * alpha, alpha);
}`;

export function measuredUpdateProgress(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

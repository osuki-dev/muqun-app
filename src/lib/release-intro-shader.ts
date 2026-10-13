/**
 * A decorative particle field, not a loading indicator. Two analytical grain
 * layers keep fragment work constant: no particle arrays, textures or blur
 * surfaces. Scene changes reshape the same field rather than restart a loop.
 */
export const RELEASE_INTRO_SKSL = /* sksl */ `
uniform float2 size;
uniform float time;
uniform float scene;
uniform float3 tint;
uniform float3 ink;

float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453);
}

float ring(float2 p, float radius, float width) {
  return exp(-pow((length(p) - radius) / width, 2.0));
}

float field(float2 p) {
  float angle = atan(p.y, p.x);
  float orbit = ring(p * float2(1.0, 1.13),
    0.29 + 0.022 * sin(angle * 3.0 - time * 0.45), 0.033);
  orbit += 0.65 * ring(p * float2(1.15, 0.91), 0.36, 0.017);
  orbit += 0.5 * exp(-dot(p, p) * 55.0);

  float fork = 0.23 * (1.0 - smoothstep(-0.16, 0.19, p.y));
  float branchDistance = min(abs(p.x), abs(abs(p.x) - fork));
  float branches = exp(-pow(branchDistance / 0.029, 2.0));
  branches *= smoothstep(-0.4, -0.3, p.y) * (1.0 - smoothstep(0.25, 0.39, p.y));
  branches += ring(p - float2(-0.23, -0.26), 0.041, 0.015);
  branches += ring(p - float2(0.23, -0.26), 0.041, 0.015);
  branches += ring(p - float2(0.0, 0.29), 0.041, 0.015);

  float waves = ring(p, 0.23 + 0.009 * sin(time * 0.6), 0.018);
  waves += 0.65 * ring(p, 0.32 + 0.012 * sin(time * 0.6 - 0.8), 0.012);
  waves += 0.3 * ring(p, 0.40, 0.009);
  waves *= 0.68 + 0.32 * sin(angle * 2.0 - time * 0.55);

  return mix(mix(orbit, branches, clamp(scene, 0.0, 1.0)),
    waves, clamp(scene - 1.0, 0.0, 1.0));
}

float grains(float2 pos, float cell, float seed, float density) {
  float2 grid = floor(pos / cell);
  float h = hash(grid + seed);
  float h2 = hash(grid.yx + seed + 29.0);
  float2 centre = (grid + float2(0.5)) * cell;
  centre += float2(sin(time * 0.32 + h * 6.28), cos(time * 0.27 + h2 * 6.28)) * cell * 0.22;
  float radius = mix(0.65, 1.7, h2) * (0.55 + density * 0.65);
  float dot = 1.0 - smoothstep(radius * 0.25, radius + 0.65, length(pos - centre));
  float breath = 0.72 + 0.28 * sin(time * 0.7 + h * 6.28);
  return dot * density * breath * (0.45 + 0.55 * h);
}

half4 main(float2 pos) {
  float2 p = (pos - size * 0.5) / min(size.x, size.y);
  float density = clamp(field(p), 0.0, 1.0);
  float veil = density * 0.055;
  float dust = grains(pos, 6.0, 0.0, density) + grains(pos + float2(2.1, 3.4), 10.0, 43.0, density) * 0.6;
  float edge = 1.0 - smoothstep(0.43, 0.5, length(p));
  float alpha = clamp((dust * 1.25 + veil) * edge, 0.0, 0.9);
  float3 color = mix(tint, ink, 0.14 + 0.1 * sin(p.y * 5.0 + time * 0.15));
  return half4(color * alpha, alpha);
}
`;

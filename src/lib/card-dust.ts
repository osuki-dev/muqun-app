/**
 * A card eroding into ash from one side: the launch snap's grain and drift
 * (`snap-dissolve.ts`), with the erosion front starting at the edge the
 * reader pulls towards instead of at every edge, and the ash blowing that
 * way. Run with progress falling from 1, the same field reforms a card out of
 * the ash, which is how the deck brings the next computer in.
 *
 * `axis` picks the edge the front starts at: 0 for a side (the deck's
 * cards), 1 for the top or the bottom (Home's reply sheet). Along a side,
 * `direction` is -1 when the front starts at the left edge and the grains
 * drift left, +1 for the right; along the height it is -1 for the top edge
 * and +1 for the bottom, the grains drifting that way too. A card's ash lifts
 * as it blows sideways; a sheet's spreads outwards from its middle as it
 * falls. Coordinates and grain spacing are in points.
 */
export const CARD_DUST_SKSL = /* sksl */ `
uniform shader image;
uniform float2 size;
uniform float cell;
uniform float progress;
uniform float direction;
uniform float axis;
uniform float4 tint;

float hash12(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + float2(1.0, 0.0)), f.x),
    mix(hash12(i + float2(0.0, 1.0)), hash12(i + float2(1.0)), f.x), f.y);
}

half4 main(float2 pos) {
  if (progress <= 0.0) return image.eval(pos);
  if (progress >= 1.0) return half4(0.0);

  float2 uv = pos / max(size, float2(1.0));
  // Distance from the leading edge, the one the pull is going towards.
  float along = axis < 0.5 ? uv.x : uv.y;
  float depth = clamp(direction < 0.0 ? along : 1.0 - along, 0.0, 1.0);
  // The way the ash blows, and the way it spreads as it goes.
  float2 ahead = axis < 0.5 ? float2(direction, 0.0) : float2(0.0, direction);
  float2 aside = axis < 0.5 ? float2(0.0, -1.0) : float2((uv.x - 0.5) * 2.0, 0.0);
  float billow = noise(pos / 58.0);
  float start = depth * 0.54 + billow * 0.14;
  float q = clamp((progress * 1.10 - start) / 0.42, 0.0, 1.0);
  if (q <= 0.0) return image.eval(pos);

  float loosen = smoothstep(0.0, 0.72, q);
  float2 drift = (ahead * (18.0 + 24.0 * billow) + aside * (24.0 + 30.0 * billow)) * loosen;
  drift += float2(sin(pos.y / 75.0 + q * 3.0), cos(pos.x / 89.0 + q * 2.0)) * 7.0 * loosen;
  float2 source = pos - drift;
  float cloud = noise(source / 24.0 + float2(q * 0.7, -q * 0.4));
  float2 grainFlow = (ahead * 18.0 + aside * 28.0) * progress;
  grainFlow += float2(sin(pos.y / 90.0 + progress * 3.0), cos(pos.x / 80.0 + progress * 2.0)) * 2.0 * progress;
  float2 grid = (pos - grainFlow) / max(cell, 1.0);
  float grainHash = hash12(floor(grid));
  float otherHash = hash12(floor(grid) + 19.0);
  float2 centre = float2(0.18 + grainHash * 0.64, 0.18 + otherHash * 0.64);
  float grain = 1.0 - smoothstep(0.04, 0.16 + 0.22 * otherHash, length(fract(grid) - centre));
  grain *= (0.45 + 0.55 * grainHash) * smoothstep(0.1, 0.25, grainHash);

  float intact = 1.0 - smoothstep(0.01, 0.4, q);
  float life = 1.0 - smoothstep(0.12, 1.0, q);
  float dust = (grain * 0.62 + cloud * cloud * 0.28) * life;
  half4 original = image.eval(pos);
  half4 sample = image.eval(source);
  // Keep premultiplied alpha while tinting grains with the active theme.
  half3 colour = mix(sample.rgb, half3(tint.rgb) * sample.a, 0.45);
  half dustAlpha = half((1.0 - intact) * dust);
  return original * half(intact) + half4(colour, sample.a) * dustAlpha;
}
`;

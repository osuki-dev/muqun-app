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
 *
 * Three uniforms fit the field to the surface; a deck card passes 1, 0, 0.
 * `spread` scales how far the ash travels: 1 is a card's few dozen points; a
 * sheet several times a card's height passes more, so its grains are seen to
 * gather from a distance rather than shiver in place. `gather` (0..0.3) is
 * how early in the erosion the grains come loose: higher, and run backwards
 * they land before the picture forms, so it crystallises out of grains at
 * rest rather than fading in under grains still moving. `glow` (0..1) lights
 * the grains with the theme's tint, for a dark surface over a dark page.
 */
export const CARD_DUST_SKSL = /* sksl */ `
uniform shader image;
uniform float2 size;
uniform float cell;
uniform float progress;
uniform float direction;
uniform float axis;
uniform float spread;
uniform float gather;
uniform float glow;
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

  // Below gather the grains sit where they belong: run backwards, they land
  // first and the picture then crystallises out of them, instead of fading
  // in while they are still on their way.
  float loosen = smoothstep(gather, 0.72 + gather * 0.4, q);
  // How far the ash travels: spread times a card's, so a surface several
  // times a card's size blows (and gathers) over a matching distance; the
  // sideways spread grows more slowly, or a sheet's edges would leave the canvas.
  float side = 0.5 + 0.5 * spread;
  float2 drift = (ahead * (18.0 + 24.0 * billow) * spread + aside * (24.0 + 30.0 * billow) * side) * loosen;
  drift += float2(sin(pos.y / 75.0 + q * 3.0), cos(pos.x / 89.0 + q * 2.0)) * 7.0 * spread * loosen;
  float2 source = pos - drift;
  float cloud = noise(source / 24.0 + float2(q * 0.7, -q * 0.4));
  float2 grainFlow = (ahead * 18.0 * spread + aside * 28.0 * side) * progress;
  grainFlow += float2(sin(pos.y / 90.0 + progress * 3.0), cos(pos.x / 80.0 + progress * 2.0)) * 2.0 * spread * progress;
  float2 grid = (pos - grainFlow) / max(cell, 1.0);
  float grainHash = hash12(floor(grid));
  float otherHash = hash12(floor(grid) + 19.0);
  float2 centre = float2(0.18 + grainHash * 0.64, 0.18 + otherHash * 0.64);
  float grain = 1.0 - smoothstep(0.04, 0.16 + 0.22 * otherHash, length(fract(grid) - centre));
  grain *= (0.45 + 0.55 * grainHash) * smoothstep(0.1, 0.25, grainHash);

  float intact = 1.0 - smoothstep(0.01, 0.4, q);
  float life = 1.0 - smoothstep(0.12, 1.0, q);
  // Glowing grains carry the theme's light: a dark sheet's ash over a dark
  // page is otherwise a faint haze, and grains have to be seen to gather.
  float dust = min(1.0, (grain * (0.62 + 0.5 * glow) + cloud * cloud * 0.28) * life);
  half4 original = image.eval(pos);
  half4 sample = image.eval(source);
  // Keep premultiplied alpha while tinting grains with the active theme.
  half3 colour = mix(sample.rgb, half3(tint.rgb) * sample.a, 0.45 + 0.35 * glow);
  half dustAlpha = half((1.0 - intact) * dust);
  return original * half(intact) + half4(colour, sample.a) * dustAlpha;
}
`;

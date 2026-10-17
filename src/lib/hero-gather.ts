/**
 * The launch picture coming together out of dust, in the same grain the exit
 * blows it away in (`snap-dissolve.ts`).
 *
 * The opening ends with the finished frame turning to ash and leaving Home
 * behind. Until now the picture sat untouched from the first frame to that
 * exit; the rim woke around it and the world bloomed behind it, but the
 * picture itself did nothing. This is its own beat: as the rim closes the
 * picture loosens from its outline inward into the same drifting grains,
 * and as the front leaves it behind the grains fly back and the drawing is
 * whole again. One language on both ends -- the picture arrives the way it
 * will leave -- and the exit then reads as the second half of something the
 * opening began rather than a different effect.
 *
 * The arithmetic is the exit's, run on one rectangle and with the front
 * turned inside out. There, erosion starts at the frame's edges and works
 * in; here, `start` is small at the silhouette's rim and large at its core,
 * so a rising `progress` loosens the outside first and a falling one gathers
 * the core first and the rim last. Grains drift *away* from the picture's
 * centre while loose, so the dust they are drawn from always lies inside the
 * drawing and the cloud sits just outside its outline, where a hero on a
 * transparent ground has pixels to lose and nothing to invent. Two texture
 * samples and fixed noise per fragment, no CPU particles, and the fragment
 * returns the untouched picture the moment `progress` is 0 -- which is also
 * what the snapshot the exit cuts up will contain.
 *
 * Free of every React Native import, so `bun test` can load it.
 */

/**
 * How far the picture loosens at the top of its beat, as the shader's
 * `progress`. Short of 1: the core keeps a shimmer of the drawing through the
 * whole beat, so what the reader sees is a picture reassembling rather than
 * one appearing from nothing -- it was the frame native handed over, and it
 * must never read as having been replaced.
 */
export const HERO_GATHER_PEAK = 0.62;

/**
 * Room around the picture's rectangle for grains to fly into, in points.
 * The shader's furthest displacement is about 50 points; the margin covers it
 * with the swirl's own amplitude to spare.
 */
export const HERO_GATHER_MARGIN = 64;

/**
 * `origin`/`size` are the picture's rectangle in the canvas's points; `cell`
 * is the exit's grain spacing so the two share one grain.
 */
export const HERO_GATHER_SKSL = /* sksl */ `
uniform shader image;
uniform float2 origin;
uniform float2 size;
uniform float cell;
uniform float progress;

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

  float2 extent = max(size, float2(1.0));
  float2 c = (pos - origin) / extent - 0.5;
  // Normalised so the core and the rim are judged by the same distance on a
  // portrait and a landscape picture alike.
  float radial = clamp(length(c * float2(extent.x / min(extent.x, extent.y),
    extent.y / min(extent.x, extent.y))) * 1.35, 0.0, 1.0);
  float billow = noise(pos / 42.0);
  // Inside out: the rim loosens first and gathers last.
  float start = (1.0 - radial) * 0.56 + billow * 0.2;
  float q = clamp((progress * 1.10 - start) / 0.45, 0.0, 1.0);
  if (q <= 0.0) return image.eval(pos);

  float loosen = smoothstep(0.0, 0.72, q);
  float2 away = c / max(length(c), 0.02);
  float2 drift = away * (20.0 + 26.0 * billow) * loosen;
  drift += float2(sin(pos.y / 61.0 + q * 3.0), cos(pos.x / 71.0 + q * 2.0)) * 6.0 * loosen;
  // Dust at this point is drawn from the pixel it drifted away from, which
  // lies inward of it: the cloud forms outside the outline out of the
  // drawing's own ink.
  float2 source = pos - drift;
  float cloud = noise(source / 24.0 + float2(q * 0.7, -q * 0.4));
  float2 grainFlow = away * 14.0 * progress;
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
  half grey = mix(dot(sample.rgb, half3(0.2126, 0.7152, 0.0722)), sample.a * 0.52, 0.5);
  half3 colour = mix(sample.rgb, half3(grey), 0.72);
  half dustAlpha = half((1.0 - intact) * dust);
  return original * half(intact) + half4(colour, sample.a) * dustAlpha;
}
`;

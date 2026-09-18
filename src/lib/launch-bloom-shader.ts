import { Skia } from '@shopify/react-native-skia';

/**
 * The launch opening's one drawing: the pack's world bleeding outward from the
 * hero, on the GPU.
 *
 * ## The idea in two sentences
 *
 * One full-screen fragment program decides, for every pixel, whether the front
 * has reached it yet -- and the front is not a circle but a radius displaced by
 * two bands of value noise, one indexed by angle (which gives it lobes) and one
 * indexed by position (which breaks those lobes up), so the boundary reads as
 * ink soaking into paper rather than as a geometric wipe. Inside the front the
 * pack's wallpaper is sampled through a cover fit that starts a touch zoomed
 * and settles, outside it is the pack's own paper, and exactly at the boundary
 * a thin rim in the pack's lightest tone sits on a bank of its `primary` with a
 * one-or-two-pixel chromatic split -- three samples at the rim, one everywhere
 * else, because the split is the only place in the frame that needs them.
 *
 * ## Why a runtime effect rather than views
 *
 * A circular iris is a clip and a counter-scale, which React Native can do.
 * A *ragged* front is per-pixel: there is no view whose outline is a noise
 * field, and animating one as a path would mean rebuilding geometry sixty
 * times a second on the thread the app is starting up on. Here the whole
 * boundary is three lines of arithmetic that the GPU runs for free, the
 * uniforms come off Reanimated shared values on the UI thread, and JavaScript
 * does nothing per frame at all.
 *
 * ## Modes
 *
 * `uMode` chooses what "the world" means, because a theme pack is not obliged
 * to ship a painting:
 *
 *  - `0` -- a painted world. The child shader is the pack's wallpaper and is
 *    sampled through {@link worldAt}'s cover fit.
 *  - `1` -- a palette world. Packs that are a palette and nothing else (and
 *    every custom pack imported without artwork) get a field built from
 *    `background`, `surface` and `primary`, drifting once into place. It is
 *    the pack's colours arranged rather than the pack's colours absent.
 *  - `2` -- not yet. The painting is still decoding, so inside the front is
 *    the same paper as outside it and what shows is the rim alone, breathing
 *    around the hero. Not a dead screen and not a lie about what is ready.
 *
 * The child shader is bound in every mode, because a runtime effect that
 * declares one must be given one; in modes 1 and 2 it is never evaluated.
 */

/**
 * The SkSL.
 *
 * Coordinates are screen pixels throughout -- the canvas is full-bleed, so the
 * fragment coordinate is the screen coordinate, and every radius, width and
 * offset below is in the same units the uniforms are computed in.
 */
const LAUNCH_BLOOM_SKSL = `
uniform shader uWorld;

uniform float2 uResolution;   // the screen, in px
uniform float2 uCentre;       // the hero's centre, in px: where the world comes from
uniform float2 uWorldOrigin;  // the fitted painting's top-left, in px
uniform float  uWorldScale;   // the fit's scale, before the arrival zoom
uniform float  uZoom;         // the arrival zoom, easing to 1
uniform float  uFront;        // the front's radius, in px, before displacement
uniform float  uWobble;       // how far the noise displaces it, as a fraction
uniform float  uTime;         // seconds since the handover, for the drift
uniform float  uRimWidth;     // the bright rim's half-width, in px
uniform float  uGlowIn;       // how far the primary bank reaches behind the front
uniform float  uGlowOut;      // and how far its light spills onto the paper
uniform float  uChroma;       // the chromatic split at the rim, in px
uniform float  uMode;         // 0 painted, 1 palette, 2 not yet
uniform float  uWorldAlpha;   // the slot's own opacity, over the paper
uniform float  uDrift;        // the palette field's one drift, 1 -> 0
uniform float4 uPaper;        // colors.background
uniform float4 uPrimary;      // colors.primary
uniform float4 uRimColor;     // colors.surface, the pack's lightest tone
uniform float4 uSurface;      // colors.surface again, as a field stop

float hash21(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453123);
}

// Value noise: four corners of the cell, smoothstepped between.
float vnoise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + float2(1.0, 0.0));
  float c = hash21(i + float2(0.0, 1.0));
  float d = hash21(i + float2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Three octaves. A fourth is not visible at this amplitude and costs a frame
// budget that the launch does not have to spend.
float fbm(float2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    sum += amp * vnoise(p);
    p = p * 2.03;
    amp = amp * 0.5;
  }
  return sum;
}

// What a pack without a painting opens into: its three tones as one soft
// field, lit under the hero, arriving with a small drift that stops.
float3 paletteField(float2 p) {
  float2 q = p / uResolution.y;
  float2 c = uCentre / uResolution.y;
  float2 origin = float2(0.18, 0.12) + float2(uDrift * 0.10, uDrift * -0.06);
  float sweep = smoothstep(0.0, 1.45, length(q - origin));
  float pool = smoothstep(1.0, 0.0, length(q - c) * 1.15);
  float3 col = mix(uSurface.rgb, uPaper.rgb, sweep);
  return mix(col, uPrimary.rgb, pool * 0.30);
}

// The wallpaper, fitted the way Home fits it -- worldFit did the fitting and
// handed over a scale and an origin -- and magnified about the screen's centre
// by the arrival zoom, so the world has somewhere to settle back from.
//
// The child shader is sampled with decal tiling, so a contain fit returns
// nothing at all outside the picture rather than smearing its edge pixels
// across the paper. That is why the composite is over the painting's own alpha
// and not a straight swap: outside a contained picture, and wherever a pack
// asked for a partial opacity, what shows through is the pack's paper.
float4 worldAt(float2 p) {
  if (uMode > 1.5) return uPaper;
  if (uMode > 0.5) return float4(paletteField(p), 1.0);
  float2 mid = uResolution * 0.5;
  float2 q = (p - mid) / uZoom + mid;
  float4 painted = float4(uWorld.eval((q - uWorldOrigin) / uWorldScale));
  return mix(uPaper, painted, painted.a * uWorldAlpha);
}

half4 main(float2 p) {
  float2 d = p - uCentre;
  float r = length(d);
  float2 dir = r > 0.5 ? d / r : float2(1.0, 0.0);

  // The front. Lobes follow the angle, so the shape is stable as it grows;
  // the grain follows position, so the lobes come apart at their edges.
  float ang = atan(d.y, d.x);
  float lobes = fbm(float2(cos(ang), sin(ang)) * 2.6 + float2(uTime * 0.30, 0.0));
  float grain = fbm(d / uResolution.y * 5.0 - float2(0.0, uTime * 0.18));
  float front = uFront * (1.0 + (lobes - 0.5) * uWobble + (grain - 0.5) * uWobble * 0.55);

  float dr = r - front;
  float inside = 1.0 - smoothstep(-1.5, 1.5, dr);

  float rim = exp(-(dr * dr) / (uRimWidth * uRimWidth));
  float gw = dr < 0.0 ? uGlowIn : uGlowOut;
  float glow = exp(-(dr * dr) / (gw * gw));

  float3 col = uPaper.rgb;
  if (inside > 0.002) {
    // The chromatic split, and only where the eye already is. Everywhere but
    // the rim this is one sample, which is what keeps the shader cheap.
    float ca = uChroma * rim;
    float3 w;
    if (ca > 0.25) {
      w = float3(worldAt(p - dir * ca).r, worldAt(p).g, worldAt(p + dir * ca).b);
    } else {
      w = worldAt(p).rgb;
    }
    col = mix(col, w, inside);
  }
  col = mix(col, uPrimary.rgb, clamp(glow * uPrimary.a * 0.60, 0.0, 1.0));
  col = mix(col, uRimColor.rgb, clamp(rim * uRimColor.a, 0.0, 1.0));
  return half4(half3(col), 1.0);
}
`;

/**
 * Compiled once, at module scope.
 *
 * Two reasons. Compiling SkSL is not free and the launch is the one frame in
 * the app's life that cannot afford anything; and `Skia.RuntimeEffect.Make`
 * returns `null` on a compile error rather than throwing, so a typo would
 * otherwise be discovered per mount. Null here means the opening quietly takes
 * the Reanimated iris instead -- see `chooseLaunchWorld`.
 */
export const LAUNCH_BLOOM_EFFECT = Skia.RuntimeEffect.Make(LAUNCH_BLOOM_SKSL);

/** The rim's half-width, in points. Thin on purpose: a line, not a band. */
export const BLOOM_RIM_WIDTH = 2.4;

/** How far the bank of `primary` reaches back behind the front, in points. */
export const BLOOM_GLOW_IN = 54;

/** And how far its light spills forward onto the paper. Shorter, so the front leads. */
export const BLOOM_GLOW_OUT = 22;

/** The chromatic split at the rim, in points. Two pixels is a hint; four is a gimmick. */
export const BLOOM_CHROMA = 2.2;

/** How far the noise displaces the front, as a fraction of its radius. */
export const BLOOM_WOBBLE = 0.13;

/** `uMode`: what the front is revealing. */
export const BLOOM_MODE = {
  /** The pack's wallpaper, through the child shader. */
  painted: 0,
  /** A field built from the pack's own three tones. */
  palette: 1,
  /** Nothing yet -- the rim alone, breathing around the hero. */
  waiting: 2,
} as const;

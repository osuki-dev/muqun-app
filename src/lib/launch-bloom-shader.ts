import { Skia } from '@shopify/react-native-skia';

/**
 * The launch opening's one drawing: the pack's world bleeding outward from the
 * hero.
 *
 * ## The idea in two sentences
 *
 * The pack's wallpaper is an ordinary full-bleed image layer, and over it sits
 * one fragment program that is nothing but the *cover* -- the pack's paper,
 * with a hole in it that grows from the hero's centre, and light on the hole's
 * edge. The hole is not a circle: its radius is displaced by a noise field
 * indexed by direction and depth, so the boundary reads as ink soaking into
 * paper rather than as a geometric wipe, and right at the boundary a thin rim
 * in the pack's lightest tone splits into a warm and a cool line -- the
 * chromatic fringe of a lit edge -- over a short bank of the pack's `primary`.
 *
 * ## Why the shader does not draw the wallpaper
 *
 * It did, and that was the whole performance problem. Sampling the painting
 * inside the front meant every one of the screen's two and a half million
 * pixels went through a fragment program with a texture read in it, on every
 * frame of the opening. Measured on an emulator with no GPU at all, mounting
 * this canvas cost about 145 ms per frame: the opening ran at eleven frames a
 * second, and without the canvas the same opening ran at forty.
 *
 * Moving the painting out to its own image layer and leaving the shader as a
 * mask changes what each pixel costs from "sample a bitmap through a matrix
 * and blend" to "one square root and two comparisons". It also deletes a whole
 * decode: the intro used to hand the wallpaper to Skia while Home handed the
 * same file to `expo-image`, so a cold start decoded the same painting twice.
 * Now both are the one `expo-image` draw, and the arrival zoom is a composited
 * transform on that layer rather than a matrix inside the sampler.
 *
 * The rule the shape follows: **every pixel that is not near the edge must pay
 * for a comparison and nothing else.** Noise, rim and light all live inside a
 * band around the front, and the band announces its own width in `uSlack` so
 * the program can leave early for everything outside it.
 *
 * ## Modes
 *
 * `uMode` chooses what is behind the hole, because a theme pack is not obliged
 * to ship a painting:
 *
 *  - `0` -- a painted world. The hole is genuinely a hole: the program returns
 *    nothing at all and the image layer underneath is what shows.
 *  - `1` -- a palette world. Packs that are a palette and nothing else (and
 *    every custom pack imported without artwork) have no image layer, so the
 *    hole is filled with a field built from `background`, `surface` and
 *    `primary`, drifting once into place. It is the pack's colours arranged
 *    rather than the pack's colours absent.
 *  - `2` -- not yet. The painting has not finished loading, so the hole is the
 *    same paper as the cover and what shows is the rim alone, breathing around
 *    the hero. Not a dead screen and not a lie about what is ready.
 *
 * Colours come out premultiplied, which is what Skia expects of a runtime
 * effect, and is why the compositing at the bottom of `main` is written the
 * way it is rather than as a chain of `mix`es.
 */

/**
 * The SkSL.
 *
 * Coordinates are screen points throughout -- the canvas is full-bleed, so the
 * fragment coordinate is the screen coordinate, and every radius and width
 * below is in the same units the uniforms are computed in.
 */
const LAUNCH_BLOOM_SKSL = `
uniform float2 uResolution;   // the screen
uniform float2 uCentre;       // the hero centre: where the world comes from
uniform float  uFront;        // the front's radius, before displacement
uniform float  uWobble;       // how far the noise displaces it, as a fraction
uniform float  uSlack;        // how far from the front anything can still happen
uniform float  uTime;         // the drift, in noise units rather than seconds
uniform float  uRimWidth;     // the bright rim's half-width
uniform float  uGlowIn;       // how far the primary bank reaches behind the front
uniform float  uGlowOut;      // and how far its light spills onto the paper
uniform float  uGlowStrength; // how much of that bank actually lands
uniform float  uChroma;       // how far the rim's warm and cool lines separate
uniform float  uMode;         // 0 painted, 1 palette, 2 not yet
uniform float  uDrift;        // the palette field's one drift, 1 -> 0
uniform float4 uPaper;        // colors.background
uniform float4 uPrimary;      // colors.primary
uniform float4 uRimColor;     // colors.surface, the pack's lightest tone
uniform float4 uSurface;      // colors.surface again, as a field stop

// A hash with no trigonometry in it.
//
// The obvious one is fract(sin(dot(p, k)) * 43758.5453), and it is what this
// shader was first written with. It is also twenty-four sines per pixel once
// it is inside two three-octave fbms, and on a device without a GPU that is
// most of a second per frame. This is the sine-free standard, and it measured
// an order of magnitude cheaper for a field no eye can tell apart.
float hash21(float2 p) {
  float3 q = fract(float3(p.x, p.y, p.x) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
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

// Two octaves, normalised to 0..1. A third is not visible at this amplitude
// and is half again as much work on every pixel of the edge band.
float fbm(float2 p) {
  return (0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03)) / 0.75;
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

// What is behind the hole, premultiplied. For a painted world this is nothing
// at all -- the image layer underneath the canvas is the answer, and the
// cheapest possible thing this program can do is get out of its way.
float4 revealed(float2 p) {
  if (uMode > 1.5) return float4(uPaper.rgb, 1.0);
  if (uMode > 0.5) return float4(paletteField(p), 1.0);
  return float4(0.0);
}

half4 main(float2 p) {
  float2 d = p - uCentre;
  float r = length(d);

  // The cheap path, and it is most of the screen on most frames. Everything
  // this shader does beyond deciding in-or-out -- the noise, the rim, the bank
  // of light -- lives within uSlack of the front, so a pixel further from it
  // than that is already decided. Without this every frame pays the edge's
  // price for the whole screen, which is what made the first draft a slideshow.
  float dr0 = r - uFront;
  if (dr0 > uSlack) return half4(half3(uPaper.rgb), 1.0);
  if (dr0 < -uSlack) return half4(revealed(p));

  float2 dir = r > 0.5 ? d / r : float2(1.0, 0.0);
  // One noise field, indexed by direction and by depth at once: the direction
  // gives the front its lobes and the depth breaks those lobes apart, which is
  // what two separate fbms were doing at twice the price.
  float n = fbm(dir * 2.6 + float2(r / uResolution.y * 1.8, uTime));
  float front = uFront * (1.0 + (n - 0.5) * 2.0 * uWobble);
  float dr = r - front;

  // The cover: opaque paper outside the front, whatever is behind the hole
  // inside it, and one pixel of anti-aliasing between the two.
  float cover = smoothstep(-1.5, 1.5, dr);
  float4 base = mix(revealed(p), float4(uPaper.rgb, 1.0), cover);

  // The bank of light behind the leading edge, and its shorter spill forward
  // onto the paper, so the front reads as lit rather than as outlined.
  float gw = dr < 0.0 ? uGlowIn : uGlowOut;
  float glowA = clamp(exp(-(dr * dr) / (gw * gw)) * uPrimary.a * uGlowStrength, 0.0, 1.0);

  // The rim, as two lines a hair apart: warm on the outside, cool on the
  // inside. That separation *is* chromatic aberration -- it used to be done by
  // sampling the painting three times at different radii, which cost a texture
  // read on every pixel of the screen to be visible on about four of them.
  // Both tints are the pack's own lightest tone pushed either way, so a pack
  // with a warm paper does not suddenly grow a blue edge.
  float rw = uRimWidth * uRimWidth;
  float warm = exp(-((dr - uChroma) * (dr - uChroma)) / rw);
  float cool = exp(-((dr + uChroma) * (dr + uChroma)) / rw);
  float rimA = clamp((warm + cool) * uRimColor.a, 0.0, 1.0);
  float3 rimRGB = (warm * clamp(uRimColor.rgb * float3(1.10, 1.0, 0.88), 0.0, 1.0) +
                   cool * clamp(uRimColor.rgb * float3(0.88, 1.0, 1.10), 0.0, 1.0)) /
                  max(0.0001, warm + cool);

  // Source-over, twice, in premultiplied space.
  float4 lit = float4(uPrimary.rgb * glowA, glowA) + base * (1.0 - glowA);
  lit = float4(rimRGB * rimA, rimA) + lit * (1.0 - rimA);
  return half4(lit);
}
`;

/**
 * Compiled once, at module scope.
 *
 * Two reasons. Compiling SkSL is not free and the launch is the one frame in
 * the app's life that cannot afford anything -- measured at about a
 * millisecond, which is a millisecond that happens while the native splash is
 * still up rather than on a frame somebody is watching. And
 * `Skia.RuntimeEffect.Make` returns `null` on a compile error rather than
 * throwing, so a typo would otherwise be discovered per mount. Null here means
 * the opening quietly takes the Reanimated iris instead -- see
 * `chooseLaunchWorld`.
 */
export const LAUNCH_BLOOM_EFFECT = Skia.RuntimeEffect.Make(LAUNCH_BLOOM_SKSL);

/** The rim's half-width, in points. Thin on purpose: a line, not a band. */
export const BLOOM_RIM_WIDTH = 2.4;

/**
 * How far the bank of `primary` reaches back behind the front, in points.
 *
 * It was twice this and read as a bruise around the picture rather than as
 * light on an edge -- and it was also most of what the shader had to compute,
 * because the band of pixels that must do real work is as wide as the light
 * reaches. Art and arithmetic wanted the same number here.
 */
export const BLOOM_GLOW_IN = 26;

/** And how far its light spills forward onto the paper. Shorter, so the front leads. */
export const BLOOM_GLOW_OUT = 12;

/** How much of that bank actually lands. Light on an edge, not a vignette. */
export const BLOOM_GLOW_STRENGTH = 0.46;

/** How far the rim's warm and cool lines sit apart, in points. Two is a hint; four is a gimmick. */
export const BLOOM_CHROMA = 1.1;

/** How far the noise displaces the front, as a fraction of its radius. */
export const BLOOM_WOBBLE = 0.13;

/**
 * How far the noise field drifts across the whole bloom, in noise units.
 *
 * Driven by the bloom's own progress rather than by a clock. A clock is a
 * uniform that changes on every frame for the whole opening, which means a
 * canvas that keeps redrawing through the hold and through the exit with
 * nothing on it moving. Tied to the progress, the drawing stops when the
 * animation does -- and the canvas is unmounted outright once the front has
 * left the screen, because a cover with nothing left to cover is a full-screen
 * layer the compositor is blending for no reason.
 */
export const BLOOM_DRIFT = 0.9;

/**
 * How far from the front anything can still be happening, in points.
 *
 * The shader's early-out reads this: past it a pixel is cover or is hole and
 * pays for neither the noise nor the light. Three sigmas of the wider glow is
 * where the Gaussian is worth less than a thousandth of itself, plus whatever
 * the noise can push the front by -- so the band is as narrow as it can be
 * without the early-out ever cutting off something that would have been drawn.
 */
export function bloomSlack(front: number): number {
  'worklet';
  return front * BLOOM_WOBBLE + 3 * Math.max(BLOOM_GLOW_IN, BLOOM_GLOW_OUT);
}

/** `uMode`: what is behind the hole. */
export const BLOOM_MODE = {
  /** The image layer under the canvas. The program returns nothing at all. */
  painted: 0,
  /** A field built from the pack's own three tones. */
  palette: 1,
  /** Nothing yet -- the rim alone, breathing around the hero. */
  waiting: 2,
} as const;

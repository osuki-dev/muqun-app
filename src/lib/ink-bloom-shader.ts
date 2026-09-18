import { Skia, type Uniforms } from '@shopify/react-native-skia';

/**
 * The ink bloom: a cover with a hole in it that grows from a point, its edge
 * torn rather than cut, lit along the tear.
 *
 * This is a general effect, not a launch screen. It knows about a centre, a
 * radius, two colours for its edge and what to put behind the hole; it knows
 * nothing about splashes, theme packs or Home. The launch opening is its first
 * caller (`launch-intro-scene.tsx`) and an in-app re-skin -- a snapshot of the
 * old interface erased from the point of a tap to reveal the new one -- is its
 * second, and neither is privileged.
 *
 * ## The idea in two sentences
 *
 * One fragment program decides, for every pixel, whether the hole has reached
 * it yet, where the hole's radius is displaced by a noise field indexed by
 * direction and depth so the boundary reads as ink soaking into paper rather
 * than as a geometric wipe. At the boundary a thin rim splits into a warm and
 * a cool line -- the chromatic fringe of a lit edge -- over a short bank of an
 * accent colour, and everything else is either cover or hole.
 *
 * ## What it costs, and why it is shaped like this
 *
 * A full-screen fragment program is the easiest place in an app to spend a
 * whole frame without noticing. An earlier version of this sampled the
 * revealed content *inside* the program, which put a texture read on every one
 * of a phone's two and a half million pixels; measured on an emulator with no
 * GPU, mounting the canvas cost about 145 ms per frame. Leaving the program as
 * the cover alone -- and letting the thing being revealed be an ordinary layer
 * underneath -- took that to about 14 ms.
 *
 * The rule the shape follows: **every pixel that is not near the edge must pay
 * for a comparison and nothing else.** Noise, rim and light all live inside a
 * band around the front, and the band announces its own width in `uSlack` so
 * the program can leave early for everything outside it. {@link inkBloomSlack}
 * computes that width; a caller that passes a smaller one will see the edge
 * clipped, and a larger one only costs frames.
 *
 * ## What is behind the hole -- `hole`
 *
 *  - `'through'` -- nothing at all. The program returns transparent and
 *    whatever layer is underneath the canvas is what shows. This is the cheap
 *    and usual case: a wallpaper, or a live interface being revealed.
 *  - `'field'` -- a soft three-stop field built from `paper`, `surface` and
 *    `accent`, drifting once into place. For callers with nothing to reveal:
 *    a theme pack that is a palette and no artwork.
 *  - `'closed'` -- the same colour as the cover, so the hole is invisible and
 *    only the rim shows. For a caller that is not ready yet and must not
 *    promise something it cannot draw.
 *
 * ## What the cover is -- `cover`
 *
 *  - `'paper'` -- a flat fill in `paper`. The child shader is never evaluated.
 *  - `'image'` -- the child shader, sampled at the fragment's own coordinate.
 *    This is the re-skin case: the child is an `<ImageShader>` holding a
 *    snapshot of the interface being replaced, drawn 1:1 over the live one.
 *
 * A runtime effect that declares a child must always be given one, so callers
 * bind a `<ColorShader>` when the cover is `'paper'`.
 *
 * Colours come out premultiplied, which is what Skia expects of a runtime
 * effect, and is why the compositing at the bottom of `main` is written the
 * way it is rather than as a chain of `mix`es.
 */

/**
 * The SkSL, exported so a caller can read it, hash it or compile a variant.
 *
 * Coordinates are canvas points throughout: the fragment coordinate is the
 * coordinate the caller's centre, radius and widths are expressed in.
 */
export const INK_BLOOM_SKSL = `
uniform shader uCover;        // the cover's image, when uCoverMode says so

uniform float2 uResolution;   // the canvas
uniform float2 uCentre;       // where the hole grows from
uniform float  uFront;        // the hole's radius, before displacement
uniform float  uWobble;       // how far the noise displaces it, as a fraction
uniform float  uSlack;        // how far from the front anything can still happen
uniform float  uTime;         // the drift, in noise units rather than seconds
uniform float  uRimWidth;     // the bright rim's half-width
uniform float  uGlowIn;       // how far the accent bank reaches behind the front
uniform float  uGlowOut;      // and how far its light spills onto the cover
uniform float  uGlowStrength; // how much of that bank actually lands
uniform float  uChroma;       // how far the rim's warm and cool lines separate
uniform float  uHole;         // 0 through, 1 field, 2 closed
uniform float  uCoverMode;    // 0 flat paper, 1 the child shader
uniform float  uDrift;        // the field's one drift, 1 -> 0
uniform float4 uPaper;        // the cover's colour, and the field's ground
uniform float4 uAccent;       // the bank of light along the edge
uniform float4 uRimColor;     // the thin bright line on the edge
uniform float4 uSurface;      // the field's second stop

// A hash with no trigonometry in it.
//
// The obvious one is fract(sin(dot(p, k)) * 43758.5453). It is also twenty-four
// sines per pixel once it is inside two three-octave fbms, and on a device
// without a GPU that is most of a second per frame. This is the sine-free
// standard, and it measured an order of magnitude cheaper for a field no eye
// can tell apart.
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

// A soft three-stop field, lit under the centre, arriving with a drift that
// stops. For a caller with nothing to reveal but its own colours.
float3 field(float2 p) {
  float2 q = p / uResolution.y;
  float2 c = uCentre / uResolution.y;
  float2 origin = float2(0.18, 0.12) + float2(uDrift * 0.10, uDrift * -0.06);
  float sweep = smoothstep(0.0, 1.45, length(q - origin));
  float pool = smoothstep(1.0, 0.0, length(q - c) * 1.15);
  float3 col = mix(uSurface.rgb, uPaper.rgb, sweep);
  return mix(col, uAccent.rgb, pool * 0.30);
}

// The cover, premultiplied. Flat paper costs nothing; an image costs one
// sample, and only the caller that asked for one pays it.
float4 coverAt(float2 p) {
  if (uCoverMode < 0.5) return float4(uPaper.rgb, 1.0);
  return float4(uCover.eval(p));
}

// What is behind the hole, premultiplied. For the usual case this is nothing
// at all -- the layer underneath the canvas is the answer, and the cheapest
// thing this program can do is get out of its way.
float4 holeAt(float2 p) {
  if (uHole > 1.5) return coverAt(p);
  if (uHole > 0.5) return float4(field(p), 1.0);
  return float4(0.0);
}

half4 main(float2 p) {
  float2 d = p - uCentre;
  float r = length(d);

  // The cheap path, and it is most of the canvas on most frames. Everything
  // beyond deciding in-or-out -- the noise, the rim, the bank of light --
  // lives within uSlack of the front, so a pixel further from it than that is
  // already decided. Without this every frame pays the edge's price for the
  // whole screen, which is what made the first draft a slideshow.
  float dr0 = r - uFront;
  if (dr0 > uSlack) return half4(coverAt(p));
  if (dr0 < -uSlack) return half4(holeAt(p));

  float2 dir = r > 0.5 ? d / r : float2(1.0, 0.0);
  // One noise field, indexed by direction and by depth at once: the direction
  // gives the front its lobes and the depth breaks those lobes apart, which is
  // what two separate fbms were doing at twice the price.
  float n = fbm(dir * 2.6 + float2(r / uResolution.y * 1.8, uTime));
  float front = uFront * (1.0 + (n - 0.5) * 2.0 * uWobble);
  float dr = r - front;

  // Cover outside the front, hole inside it, one pixel of anti-aliasing between.
  float covered = smoothstep(-1.5, 1.5, dr);
  float4 base = mix(holeAt(p), coverAt(p), covered);

  // The bank of light behind the leading edge, and its shorter spill forward,
  // so the front reads as lit rather than as outlined.
  float gw = dr < 0.0 ? uGlowIn : uGlowOut;
  float glowA = clamp(exp(-(dr * dr) / (gw * gw)) * uAccent.a * uGlowStrength, 0.0, 1.0);

  // The rim, as two lines a hair apart: warm outside, cool inside. That
  // separation *is* chromatic aberration -- it used to be done by sampling the
  // revealed content three times at different radii, which cost a texture read
  // on every pixel to be visible on about four of them. Both tints are the
  // caller's own rim colour pushed either way, so a warm palette does not
  // suddenly grow a blue edge.
  float rw = uRimWidth * uRimWidth;
  float warm = exp(-((dr - uChroma) * (dr - uChroma)) / rw);
  float cool = exp(-((dr + uChroma) * (dr + uChroma)) / rw);
  float rimA = clamp((warm + cool) * uRimColor.a, 0.0, 1.0);
  float3 rimRGB = (warm * clamp(uRimColor.rgb * float3(1.10, 1.0, 0.88), 0.0, 1.0) +
                   cool * clamp(uRimColor.rgb * float3(0.88, 1.0, 1.10), 0.0, 1.0)) /
                  max(0.0001, warm + cool);

  // Source-over, twice, in premultiplied space.
  float4 lit = float4(uAccent.rgb * glowA, glowA) + base * (1.0 - glowA);
  lit = float4(rimRGB * rimA, rimA) + lit * (1.0 - rimA);
  return half4(lit);
}
`;

/**
 * Compiled once, at module scope.
 *
 * Compiling SkSL is not free and a launch is the one frame in an app's life
 * that cannot afford anything -- measured at about a millisecond, spent while
 * the native splash is still up rather than on a frame somebody is watching.
 * `Skia.RuntimeEffect.Make` returns `null` on a compile error rather than
 * throwing, so a typo would otherwise be discovered per mount; callers must
 * treat `null` as "this device cannot draw it" and fall back.
 */
export const INK_BLOOM_EFFECT = Skia.RuntimeEffect.Make(INK_BLOOM_SKSL);

/** The rim's half-width, in points. Thin on purpose: a line, not a band. */
export const BLOOM_RIM_WIDTH = 2.4;

/**
 * How far the bank of accent reaches back behind the front, in points.
 *
 * It was twice this and read as a bruise around the hole rather than as light
 * on an edge -- and it was also most of what the shader had to compute,
 * because the band of pixels that must do real work is as wide as the light
 * reaches. Art and arithmetic wanted the same number here.
 */
export const BLOOM_GLOW_IN = 26;

/** And how far its light spills forward onto the cover. Shorter, so the front leads. */
export const BLOOM_GLOW_OUT = 12;

/** How much of that bank actually lands. Light on an edge, not a vignette. */
export const BLOOM_GLOW_STRENGTH = 0.46;

/** How far the rim's warm and cool lines sit apart, in points. */
export const BLOOM_CHROMA = 1.1;

/** How far the noise displaces the front, as a fraction of its radius. */
export const BLOOM_WOBBLE = 0.13;

/**
 * How far from the front anything can still be happening, in points.
 *
 * The shader's early-out reads this: past it a pixel is cover or is hole and
 * pays for neither the noise nor the light. Three sigmas of the wider glow is
 * where the Gaussian is worth less than a thousandth of itself, plus whatever
 * the noise can push the front by -- so the band is as narrow as it can be
 * without the early-out ever cutting off something that would have been drawn.
 */
export function inkBloomSlack(front: number): number {
  'worklet';
  return front * BLOOM_WOBBLE + 3 * Math.max(BLOOM_GLOW_IN, BLOOM_GLOW_OUT);
}

/** What the caller wants behind the hole. See the module note. */
export type InkBloomHole = 'through' | 'field' | 'closed';

/** What the caller wants the cover to be. See the module note. */
export type InkBloomCover = 'paper' | 'image';

/** Everything the effect needs, in the caller's own words. */
export type InkBloomInput = {
  /** The canvas, in points. */
  resolution: { width: number; height: number };
  /** Where the hole grows from, in canvas points. */
  centre: { x: number; y: number };
  /** The hole's radius before the noise displaces it, in points. */
  front: number;
  /**
   * 0..1, how far the noise field has drifted along the edge. Drive it off the
   * same progress that drives `front`, not off a clock: a clock is a uniform
   * that changes every frame forever, which means a canvas that keeps redrawing
   * with nothing on it moving.
   */
  drift: number;
  /**
   * 0..1, how far the `'field'` hole has finished arriving. Ignored for the
   * other holes. It drifts once and stops, so a caller animating it from 0 to
   * 1 gets one settle rather than a loop.
   */
  settle: number;
  hole: InkBloomHole;
  cover: InkBloomCover;
  /** `[r, g, b, a]`, 0..1 — use `colorVector` or Skia's own `Skia.Color`. */
  paper: number[];
  accent: number[];
  rim: number[];
  surface: number[];
  /** 0..1 multiplier on the rim's alpha, for fading the edge in. */
  rimOpacity?: number;
  /** 0..1 multiplier on the chromatic split, for fading it in with the rim. */
  chroma?: number;
};

const HOLE_CODE: Record<InkBloomHole, number> = { through: 0, field: 1, closed: 2 };

/**
 * The uniforms, from the caller's words.
 *
 * A worklet, because the whole point of this effect is that the uniforms come
 * off shared values on the UI thread and JavaScript does nothing per frame:
 * call it inside `useDerivedValue` and pass the result straight to `<Shader>`.
 */
export function inkBloomUniforms(input: InkBloomInput): Uniforms {
  'worklet';
  return {
    uResolution: [input.resolution.width, input.resolution.height],
    uCentre: [input.centre.x, input.centre.y],
    uFront: input.front,
    uWobble: BLOOM_WOBBLE,
    uSlack: inkBloomSlack(input.front),
    uTime: input.drift,
    uRimWidth: BLOOM_RIM_WIDTH,
    uGlowIn: BLOOM_GLOW_IN,
    uGlowOut: BLOOM_GLOW_OUT,
    uGlowStrength: BLOOM_GLOW_STRENGTH,
    uChroma: BLOOM_CHROMA * (input.chroma ?? 1),
    uHole: HOLE_CODE[input.hole],
    uCoverMode: input.cover === 'image' ? 1 : 0,
    uDrift: 1 - input.settle,
    uPaper: input.paper,
    uAccent: input.accent,
    uRimColor: [
      input.rim[0] ?? 1,
      input.rim[1] ?? 1,
      input.rim[2] ?? 1,
      (input.rim[3] ?? 1) * (input.rimOpacity ?? 1),
    ],
    uSurface: input.surface,
  };
}

/** A colour string as the four floats a uniform wants. Skia owns the parsing. */
export function colorVector(color: string): number[] {
  try {
    return Array.from(Skia.Color(color));
  } catch {
    return [0, 0, 0, 1];
  }
}

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
 * ## Where the hole starts -- `edge`
 *
 * By default the hole grows from a point, so its front is a circle of `front`
 * around `centre` and every caller that says nothing gets exactly that.
 *
 * A caller that is opening a *picture* can instead hand in that picture's
 * outline, and the front starts as the outline and grows outward from it. The
 * shape arrives as a handful of scalars -- a rounded rectangle, or ten Fourier
 * terms of its radius as a function of direction -- which is what lets the
 * whole thing be uniforms and no second child shader, and lets it be evaluated
 * without a texture read, an array index or a trigonometric call. See
 * `launch-hero-edge.ts`, which is what measures one.
 *
 * `edgeAmount` scales the shape and is how it leaves again: driving it to zero
 * over the first part of the travel relaxes the front back to the plain
 * circular one, which is what a caller wants once the front is far enough away
 * that the picture it came from can no longer be read in it.
 *
 * With no `edge` the arithmetic is the arithmetic it always was, down to the
 * expression: the shape's contribution is a literal zero subtracted from the
 * radius, and its slack a literal zero added to the early-out's.
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

uniform float  uEdgeMode;     // 0 a point, 1 a rounded rectangle, 2 a fitted outline
uniform float  uEdgeAmount;   // the shape's scale, and how much of it is left in the front
uniform float  uEdgeSlack;    // how far the shape can pull the front in from the circle
uniform float3 uEdgeBox;      // half width, half height and corner radius, for mode 1
uniform float  uEdgeMean;     // the outline's mean radius, for mode 2
uniform float4 uEdgeH0;       // and its harmonics, two per uniform: (a1, b1, a2, b2)
uniform float4 uEdgeH1;
uniform float4 uEdgeH2;
uniform float4 uEdgeH3;
uniform float4 uEdgeH4;

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

// Where a ray leaving the centre crosses a rounded rectangle.
//
// Kept exact rather than folded into the series below, because a rectangle is
// the one shape whose straightness the reader can see: ten harmonics of a box
// are a box with a ripple down each side.
//
// The sharp box is one division per axis. If that hit is past the straight run
// on both axes at once the ray left through a corner instead, and the answer is
// the positive root of the ray against the corner's circle.
float edgeBoxRadius(float2 dir) {
  float2 h = uEdgeBox.xy;
  float c = min(uEdgeBox.z, min(h.x, h.y));
  float2 inset = max(h - c, 0.0);
  float2 a = abs(dir);
  float tx = a.x > 1e-6 ? h.x / a.x : 1e9;
  float ty = a.y > 1e-6 ? h.y / a.y : 1e9;
  float t = min(tx, ty);
  if (t * a.x - inset.x <= 0.0 || t * a.y - inset.y <= 0.0) return t;
  float along = dot(a, inset);
  float disc = along * along - (dot(inset, inset) - c * c);
  return along + sqrt(max(disc, 0.0));
}

// One harmonic onward: (cos kt, sin kt) times (cos t, sin t).
float2 edgeStep(float2 w, float2 dir) {
  return float2(w.x * dir.x - w.y * dir.y, w.y * dir.x + w.x * dir.y);
}

// The fitted outline, with no trigonometry in it.
//
// dir is already (cos t, sin t), so the whole series is ten complex
// multiplies and ten dot products -- and it is only ever evaluated inside the
// edge band, which is the same handful of pixels that pay for the noise.
float edgeSeriesRadius(float2 dir) {
  float radius = uEdgeMean;
  float2 w = dir;
  radius += dot(uEdgeH0.xy, w); w = edgeStep(w, dir);
  radius += dot(uEdgeH0.zw, w); w = edgeStep(w, dir);
  radius += dot(uEdgeH1.xy, w); w = edgeStep(w, dir);
  radius += dot(uEdgeH1.zw, w); w = edgeStep(w, dir);
  radius += dot(uEdgeH2.xy, w); w = edgeStep(w, dir);
  radius += dot(uEdgeH2.zw, w); w = edgeStep(w, dir);
  radius += dot(uEdgeH3.xy, w); w = edgeStep(w, dir);
  radius += dot(uEdgeH3.zw, w); w = edgeStep(w, dir);
  radius += dot(uEdgeH4.xy, w); w = edgeStep(w, dir);
  radius += dot(uEdgeH4.zw, w);
  return max(radius, 0.0);
}

// How far the picture's own outline reaches in this direction, scaled by how
// much of it is still in the front. Zero -- and free -- for a caller that gave
// no shape, which is every caller that is opening from a point.
float edgeRadius(float2 dir) {
  if (uEdgeAmount <= 0.0) return 0.0;
  if (uEdgeMode < 1.5) return edgeBoxRadius(dir) * uEdgeAmount;
  return edgeSeriesRadius(dir) * uEdgeAmount;
}

half4 main(float2 p) {
  float2 d = p - uCentre;
  float r = length(d);

  // The cheap path, and it is most of the canvas on most frames. Everything
  // beyond deciding in-or-out -- the noise, the rim, the bank of light --
  // lives within uSlack of the front, so a pixel further from it than that is
  // already decided. Without this every frame pays the edge's price for the
  // whole screen, which is what made the first draft a slideshow.
  //
  // The shape's own slack is added to the outward test and not to the inward
  // one, because the shape can only ever pull the front *in* towards the
  // picture: a pixel further out than the circle plus the shape's reach is
  // cover whatever direction it lies in, and a pixel inside the bare circle is
  // hole for the same reason. Both are zero for a caller opening from a point.
  float dr0 = r - uFront;
  if (dr0 > uSlack + uEdgeSlack) return half4(coverAt(p));
  if (dr0 < -uSlack) return half4(holeAt(p));

  float2 dir = r > 0.5 ? d / r : float2(1.0, 0.0);

  // The same question again, now that the direction is known, and this time
  // exactly. The test above had to assume the shape reaches as far this way as
  // it does anywhere -- which for a figure with an outstretched arm is most of
  // the way round the picture -- so without this the band that pays for the
  // noise would be as wide as the shape is long. Twenty-odd instructions of
  // outline in exchange for not running the noise, and the noise is an order
  // of magnitude more than that.
  float edge = edgeRadius(dir);
  if (edge > 0.0) {
    float drEdge = dr0 - edge;
    if (drEdge > uSlack) return half4(coverAt(p));
    if (drEdge < -uSlack) return half4(holeAt(p));
  }

  // One noise field, indexed by direction and by depth at once: the direction
  // gives the front its lobes and the depth breaks those lobes apart, which is
  // what two separate fbms were doing at twice the price.
  float n = fbm(dir * 2.6 + float2(r / uResolution.y * 1.8, uTime));
  float front = uFront * (1.0 + (n - 0.5) * 2.0 * uWobble);
  // Distance from the picture's outline rather than from a point. The outline
  // is a radius in this direction, so it comes straight off the radius -- and
  // it is a literal zero for a caller that gave no shape, which is what keeps
  // the circular case exactly the arithmetic it was.
  float dr = r - edge - front;

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

/**
 * The outline the hole starts from, when it starts from a picture rather than
 * from a point. See the module note, and `launch-hero-edge.ts` for the measuring.
 *
 * Every length is in canvas points, measured from `centre`, and every field is
 * a uniform: this type is the shader's shape arguments in the order it reads
 * them, not a description that something else turns into uniforms.
 */
export type InkBloomEdge = {
  /** 1 a rounded rectangle, 2 a fitted outline. */
  mode: number;
  /** Half width, half height and corner radius, for mode 1. */
  box: number[];
  /** The outline's mean radius, for mode 2. */
  mean: number;
  /**
   * Its harmonics, as five groups of four: `(a1, b1, a2, b2)` and so on.
   *
   * Pre-grouped, and handed to the uniforms by reference, so that a front
   * running at sixty frames a second copies five pointers rather than slicing
   * five arrays out of one.
   */
  harmonics: number[][];
  /** The furthest the outline reaches, which is what the early-out needs. */
  max: number;
};

/** The shape uniforms of a caller that gave no shape. */
const NO_EDGE_BOX = [0, 0, 0];
const NO_EDGE_HARMONIC = [0, 0, 0, 0];

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
  /**
   * The outline the front starts from. Omitted -- the usual case -- the front
   * starts from `centre` as a circle, exactly as it always has.
   */
  edge?: InkBloomEdge | null;
  /**
   * How much of that outline is in the front, and at what scale. A caller
   * driving this to zero as `front` grows relaxes the shape back to a circle.
   * Defaults to 1, which is the shape at the size it was measured.
   */
  edgeAmount?: number;
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
  const edge = input.edge ?? null;
  // One number carries both the shape's scale and its relaxation, so a caller
  // animating it animates one uniform; zero is "no shape", which is what an
  // absent edge and a fully relaxed one both mean to the program.
  const edgeAmount = edge ? Math.max(0, input.edgeAmount ?? 1) : 0;
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
    uEdgeMode: edge ? edge.mode : 0,
    uEdgeAmount: edgeAmount,
    uEdgeSlack: edge ? edge.max * edgeAmount : 0,
    uEdgeBox: edge ? edge.box : NO_EDGE_BOX,
    uEdgeMean: edge ? edge.mean : 0,
    uEdgeH0: edge?.harmonics[0] ?? NO_EDGE_HARMONIC,
    uEdgeH1: edge?.harmonics[1] ?? NO_EDGE_HARMONIC,
    uEdgeH2: edge?.harmonics[2] ?? NO_EDGE_HARMONIC,
    uEdgeH3: edge?.harmonics[3] ?? NO_EDGE_HARMONIC,
    uEdgeH4: edge?.harmonics[4] ?? NO_EDGE_HARMONIC,
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

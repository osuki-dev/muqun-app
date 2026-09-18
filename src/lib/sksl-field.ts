/**
 * The SkSL every full-screen effect in the app ends up needing.
 *
 * Three effects now displace an edge with noise and light it: the launch
 * opening's ink bloom (`ink-bloom-shader.ts`) and the two re-skin transitions
 * (`reskin-shaders.ts`). They look nothing alike -- a radial hole, a
 * directional wash, a halftone dissolve -- but a value-noise field and a lit
 * rim are the same arithmetic in all three, and a second copy of the hash was
 * a second place for the launch's performance work to fail to reach.
 *
 * These are source fragments rather than compiled effects on purpose: SkSL has
 * no include, so composition happens in the template literal and each caller
 * still compiles exactly one program.
 *
 * ## Why the hash has no sine in it
 *
 * The obvious value-noise hash is `fract(sin(dot(p, k)) * 43758.5453)`. Inside
 * two three-octave fbms that is twenty-four sines per pixel, and on a device
 * without a GPU that is most of a frame. This is the sine-free standard, and
 * it measured an order of magnitude cheaper for a field no eye can tell apart.
 * The note is here rather than at one call site because the next effect to
 * want noise should inherit the answer rather than the mistake.
 */

/**
 * `hash21`, `vnoise`, `fbm` -- a value-noise field, normalised to 0..1.
 *
 * Two octaves, not three. A third is not visible at the amplitudes any of the
 * callers displace an edge by, and it is half again as much work on every
 * pixel of the edge band.
 */
export const SKSL_NOISE = `
// A hash with no trigonometry in it. See the module note.
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

// Two octaves, normalised to 0..1.
float fbm(float2 p) {
  return (0.5 * vnoise(p) + 0.25 * vnoise(p * 2.03)) / 0.75;
}
`;

/**
 * `rimLight` and `over` -- a lit edge, and premultiplied source-over.
 *
 * The rim is two lines a hair apart: warm outside, cool inside. That
 * separation *is* chromatic aberration, and doing it with two exponentials on
 * the caller's own colour is what replaced sampling the revealed content three
 * times at different radii -- a texture read on every pixel, to be visible on
 * about four of them. Both tints are the caller's colour pushed either way, so
 * a warm palette does not suddenly grow a blue edge.
 *
 * `dr` is the pixel's signed distance from the front, in canvas points:
 * positive ahead of it, negative behind. Whether that distance is a radius, a
 * projection onto a direction, or something else is the caller's business --
 * which is exactly why this helper takes the distance and not the geometry.
 *
 * The return value is premultiplied, ready for `over`.
 *
 * The ink bloom still carries its own copy of this arithmetic inline. It is
 * left alone deliberately: it is a shipped launch path whose cost was measured
 * frame by frame, and moving its `main` around to save nine lines would put
 * that at risk for no reader-visible gain.
 */
export const SKSL_RIM = `
float4 rimLight(float dr, float width, float chroma, float4 color) {
  float rw = max(0.0001, width * width);
  float warm = exp(-((dr - chroma) * (dr - chroma)) / rw);
  float cool = exp(-((dr + chroma) * (dr + chroma)) / rw);
  float a = clamp((warm + cool) * color.a, 0.0, 1.0);
  float3 rgb = (warm * clamp(color.rgb * float3(1.10, 1.0, 0.88), 0.0, 1.0) +
                cool * clamp(color.rgb * float3(0.88, 1.0, 1.10), 0.0, 1.0)) /
               max(0.0001, warm + cool);
  return float4(rgb * a, a);
}

// Source-over, in the premultiplied space Skia hands a runtime effect.
float4 over(float4 src, float4 dst) {
  return src + dst * (1.0 - src.a);
}

// A soft hump that is exactly zero at both ends of a 0..1 band. Used where a
// Gaussian would do but its tails would widen the early-out band for light no
// one can see: this one lets the caller state the band's width and mean it.
float hump(float x) {
  float t = clamp(x, 0.0, 1.0);
  return t * (1.0 - t) * 4.0;
}
`;

/**
 * A Gaussian rim is worth computing for about three standard deviations, so
 * this is how much room a caller's early-out band must leave for one.
 *
 * A worklet: it is called from the same `useDerivedValue` that builds the
 * uniforms, which runs on the UI thread.
 */
export function rimSlack(width: number, chroma: number): number {
  'worklet';
  return 3 * width + Math.abs(chroma);
}

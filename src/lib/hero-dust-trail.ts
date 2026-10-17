/**
 * Ash lifting off the launch picture's outline while the opening holds, in
 * the grain the exit blows the whole frame away in (`snap-dissolve.ts`).
 *
 * The opening ends with the finished frame turning to ash and drifting off
 * up and to the right. Between the rim closing and that exit the picture
 * used to sit untouched, and a first attempt at bridging the two (the picture
 * loosening and gathering again) read as a flash. This is the quieter idea:
 * from the moment the front passes the picture, a sparse drift of grains
 * keeps peeling off its outline and floating away in the exit's direction,
 * like dust lifting in a breeze. The drawing itself never changes; the air
 * around it is already moving the way everything will move at the end, so
 * the exit arrives as more of the same rather than as a new effect.
 *
 * Per fragment: the picture is drawn as it is. On a sparse set of grain
 * cells, the grain's age is derived from a running clock and a per-cell
 * phase, so grains are born and die continuously; its source point is found
 * by walking back along its travel, and it is drawn only when that point sits
 * on the picture's rim, judged by four neighbouring alpha samples. At most
 * six texture samples for a grain cell and one for everything else, no CPU
 * particles. With `fade` at 0 the fragment is the untouched picture.
 *
 * Free of every React Native import, so `bun test` can load it.
 */

/** Room around the picture's rectangle for grains to drift into, in points. */
export const HERO_TRAIL_MARGIN = 72;

/** The share of grain cells that ever carry a grain. Sparse on purpose. */
export const HERO_TRAIL_DENSITY = 0.6;

/**
 * The trail's grain cell, as a multiple of the exit's. The exit's grain is
 * fine because the whole frame is made of it; a sparse drift of grains that
 * small is below a pixel and vanishes. Three cells across makes a grain a
 * visible speck while it still reads as the same ash.
 */
export const HERO_TRAIL_CELL_SCALE = 4;

/** How long the grain clock runs, in seconds; longer than any hold. */
export const HERO_TRAIL_CLOCK_SECONDS = 4;

/**
 * `cell` is the exit's grain spacing so both share one grain; `time` is the
 * clock in seconds; `fade` scales the whole drift and is 0 before the front
 * reaches the picture.
 */
export const HERO_TRAIL_SKSL = /* sksl */ `
uniform shader image;
uniform float cell;
uniform float time;
uniform float fade;
uniform float density;

float hash12(float2 p) {
  float3 p3 = fract(float3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

half4 main(float2 pos) {
  half4 base = image.eval(pos);
  if (fade <= 0.0) return base;

  float2 grid = pos / max(cell, 1.0);
  float2 id = floor(grid);
  float seed = hash12(id);
  if (seed > density) return base;
  float h2 = hash12(id + 7.0);
  float h3 = hash12(id + 19.0);

  // Grains are born and die on their own clocks, so the drift is continuous
  // rather than one burst.
  float period = 0.8 + 0.7 * h2;
  float age = fract(time / period + h3) * period;
  // Up and to the right, the way the exit's ash goes, with a little swirl.
  float2 dir = normalize(float2(0.55 + 0.25 * (h2 - 0.5), -0.83));
  float2 travel = dir * (age * 56.0);
  travel += float2(sin(age * 5.0 + h3 * 6.2832), cos(age * 4.0 + h2 * 6.2832)) * 3.0 * age;
  float2 source = pos - travel;
  half4 src = image.eval(source);
  if (src.a <= 0.08) return base;

  // Grains leave from the drawing's rim: where a neighbour a few points away
  // is already paper.
  float around = image.eval(source + float2(5.0, 0.0)).a
    + image.eval(source - float2(5.0, 0.0)).a
    + image.eval(source + float2(0.0, 5.0)).a
    + image.eval(source - float2(0.0, 5.0)).a;
  float rim = clamp((float(src.a) * 4.0 - around) * 1.5, 0.0, 1.0);
  if (rim <= 0.0) return base;

  float life = 1.0 - age / period;
  life = life * sqrt(life);
  float2 centre = float2(0.2 + h2 * 0.6, 0.2 + h3 * 0.6);
  float speck = 1.0 - smoothstep(0.1, 0.3 + 0.2 * h3, length(fract(grid) - centre));
  float strength = min(1.0, rim * life * speck * fade * (1.0 + 0.6 * h2));
  // Ash keeps a little of the drawing's colour, as the exit's does.
  half grey = dot(src.rgb, half3(0.2126, 0.7152, 0.0722));
  half4 grain = half4(mix(src.rgb, half3(grey), half(0.35)), src.a) * half(strength);
  return base + grain * (1.0 - base.a);
}
`;

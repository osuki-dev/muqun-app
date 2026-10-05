import { Skia, type Uniforms } from 'react-native-skia';

import { SKSL_NOISE, SKSL_RIM, rimSlack } from './sksl-field';
import {
  RIPPLE_AMPLITUDE,
  RIPPLE_BAND,
  RIPPLE_DECAY,
  RIPPLE_TAIL,
  RIPPLE_WAVELENGTH,
  SCAN_BAND,
} from './reskin-geometry';

/**
 * The re-skin transitions: what the reader sees in the half-second after
 * they change the theme or the font.
 *
 * ## The problem both of them solve
 *
 * Applying a palette or a typeface re-skins every pixel of the app at once,
 * and React Native gets there one frame at a time. A font change is worse than
 * a palette change: new metrics mean every text node re-measures, so for a
 * frame or two rows sit at the wrong height and the screen visibly settles.
 * Even the clean case is a hard cut -- the reader taps a row and the world
 * they were reading is replaced between two frames with no account of itself.
 *
 * So the app takes a picture of the old screen first (`makeImageFromView`),
 * holds that picture over the top, lets the live interface underneath change
 * and settle unwatched, and then *erases the picture*. The reflow happens
 * behind a still image, and what the reader sees is one deliberate move.
 *
 * The picture is the cover, and each of these programs is a different way of
 * taking a cover away.
 *
 * ## What they cost, and the rule that keeps them affordable
 *
 * The launch opening learned this the expensive way (commit 5951196): a
 * full-screen fragment program that samples a texture on every one of a
 * phone's 2.6 million pixels costs about 145 ms a frame on an emulator with no
 * GPU. The rule that came out of it -- **every pixel that is not near the
 * front must pay for a comparison and nothing else** -- is why both programs
 * below open with two early-outs against a caller-supplied slack, and why
 * neither has a Gaussian whose tails it cannot bound.
 *
 * These two cannot be quite as cheap as the bloom, and the reason is worth
 * stating: the bloom's cover is flat paper, so its covered pixels return a
 * constant. Here the cover is a photograph of the interface, so a covered
 * pixel costs one texture read -- and that read is the entire point of the
 * effect, so it is not a cost to design away. It is a cache-friendly 1:1 read
 * with no matrix under it (the parallax the theme wash wants is a composited
 * transform on the canvas, not a matrix inside the sampler -- the same lesson,
 * applied before it had to be learned again), and the number of pixels still
 * paying it falls to zero over the run.
 *
 * ## None of these is the launch's bloom
 *
 * The bloom is a radial hole with a torn, lit edge. These are a ripple of
 * damped rings that bends the picture, two scan bands that re-encode it, and
 * (as fallbacks) a straight front crossing the screen and a grid of dots
 * shrinking to nothing. They share the noise field, the rim helper and the
 * uniform-builder shape -- the infrastructure -- and nothing about how they
 * look.
 */

/* -------------------------------------------------------------------------- */
/* Theme: the new world washes in                                             */
/* -------------------------------------------------------------------------- */

/**
 * A front crosses the screen from the side the reader touched, and the old
 * interface is not behind it any more.
 *
 * The edge is a watercolour bleed rather than a wipe: the same value-noise
 * field the bloom uses, but indexed along a *line* instead of around a radius,
 * so the front has irregular lobes that evolve as it travels rather than a
 * fixed silhouette being dragged. Behind the front there is a soft damp band
 * -- the wet edge a real wash leaves as the paper dries -- so the new theme
 * arrives slightly dampened and clears a beat later. The front itself is lit
 * in the *new* theme's primary, which is the one moment in the transition
 * where the reader is told, in colour, what they just chose.
 *
 * Coordinates are canvas points throughout.
 */
export const THEME_WASH_SKSL = `
uniform shader uCover;        // the photograph of the old interface

uniform float2 uOrigin;       // the point the front's geometry is measured from
uniform float2 uDir;          // unit vector: the way the front travels
uniform float  uFront;        // how far along uDir the front has reached
uniform float  uBleed;        // how far the noise displaces it, in points
uniform float  uSlack;        // how far from the front anything can still happen
uniform float  uDrift;        // the bleed's evolution, in noise units
uniform float  uRimWidth;     // the lit edge's half-width
uniform float  uChroma;       // how far the rim's warm and cool lines separate
uniform float  uWetWidth;     // how far the damp band reaches behind the front
uniform float  uWetStrength;  // how much of it lands
uniform float  uGlowOut;      // how far the new primary spills forward
uniform float  uGlowStrength; // how much of that spill lands
uniform float4 uRimColor;     // the new theme's primary
uniform float4 uWetColor;     // the damp band's colour

${SKSL_NOISE}
${SKSL_RIM}

half4 main(float2 p) {
  float2 d = p - uOrigin;
  // How far along the travel this pixel sits. Positive is ahead of the front
  // -- still the old interface; negative is behind it -- already washed.
  float s = dot(d, uDir);
  float dr0 = s - uFront;

  // The cheap path, and it is most of the canvas on most frames.
  if (dr0 > uSlack) return half4(uCover.eval(p));
  if (dr0 < -uSlack) return half4(0.0);

  // Across the front, which is what gives the bleed its lobes. The travel term
  // goes in too, so the edge is not a pure function of the across-coordinate:
  // that difference is the whole of what separates a watercolour boundary from
  // a wavy line being translated.
  float t = dot(d, float2(-uDir.y, uDir.x));
  float n = fbm(float2(t / 120.0, s / 260.0 + uDrift));
  float front = uFront + (n - 0.5) * 2.0 * uBleed;
  float dr = s - front;

  // Old interface ahead, nothing behind, one pixel of anti-aliasing between.
  float covered = smoothstep(-1.5, 1.5, dr);
  float4 cover = float4(uCover.eval(p));
  float4 base = cover * covered;

  // The damp band, behind the front and only there: a wash darkens the paper
  // it has just crossed, and the paper here is the new theme.
  float wetA = hump(-dr / max(0.0001, uWetWidth)) * uWetStrength * uWetColor.a * (1.0 - covered);

  // And the new primary spilling a little way forward, so the front reads as
  // lit rather than as outlined. Quadratic rather than Gaussian: the caller
  // states the reach and this honours it exactly, which keeps uSlack honest.
  float ahead = clamp(dr / max(0.0001, uGlowOut), 0.0, 1.0);
  float glowA = (1.0 - ahead) * (1.0 - ahead) * uGlowStrength * uRimColor.a * covered;

  float4 lit = over(float4(uWetColor.rgb * wetA, wetA), base);
  lit = over(float4(uRimColor.rgb * glowA, glowA), lit);
  lit = over(rimLight(dr, uRimWidth, uChroma, uRimColor), lit);
  return half4(lit);
}
`;

/* -------------------------------------------------------------------------- */
/* Font: re-typeset                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The old page breaks into halftone dots and the dots shrink to nothing, in a
 * wave travelling out from the row the reader tapped.
 *
 * The cell is about the body text's x-height, which is the one measurement
 * that makes this specific to a font change rather than decorative: the page
 * comes apart at the scale of the letters that are being re-set. The lattice
 * is screened at 45 degrees for the same reason a printer screens at 45
 * degrees -- a dot grid square to the pixel grid beats against the text
 * underneath and reads as a glitch instead of as ink.
 *
 * It is monochrome-safe by construction: every dot carries the old screen's
 * own pixels, so the effect has no colour of its own to clash with a light or
 * a dark pack. The only colour added is the theme's primary in the leading
 * band, where the dots are mid-shrink.
 *
 * The dots start at the cell's half-diagonal rather than its half-width. At
 * half-width, circles inscribed in the cells cover only pi/4 of the page and
 * the reader would see the screen turn to dots the instant the overlay mounts
 * -- a flash of the very thing the overlay exists to hide. At the
 * half-diagonal they overlap and cover everything, and the diamond gaps open
 * at the corners as they shrink, which is exactly the halftone.
 */
export const FONT_HALFTONE_SKSL = `
uniform shader uCover;        // the photograph of the old interface

uniform float2 uOrigin;       // the tapped row, rotated into screen-angle space
uniform float  uFront;        // how far out the wave has reached, in points
uniform float  uBand;         // how wide the shrinking band is
uniform float  uCell;         // the halftone cell, about one x-height
uniform float  uHalfDiag;     // uCell * sqrt(0.5): a dot at full coverage
uniform float  uTintStrength; // how much primary the leading band carries
uniform float4 uTint;         // the theme's primary

// Screened at 45 degrees, where cos and sin are the same number.
const float K = 0.70710678;

half4 main(float2 p) {
  // Into screen-angle space once, and stay there: rotation preserves distance,
  // so the wave can be measured here too and the origin arrives pre-rotated.
  float2 q = float2(p.x * K - p.y * K, p.x * K + p.y * K);
  float d0 = length(q - uOrigin);

  // The cheap path. Ahead of the wave the page is untouched; behind it, the
  // dots are gone and the newly typeset page underneath is the answer.
  if (d0 > uFront + uHalfDiag) return half4(uCover.eval(p));
  if (d0 < uFront - uBand - uHalfDiag) return half4(0.0);

  // One phase per cell, not per pixel: a dot shrinks as a dot.
  float2 centre = (floor(q / uCell) + 0.5) * uCell;
  float w = clamp((uFront - length(centre - uOrigin)) / max(0.0001, uBand), 0.0, 1.0);

  float radius = uHalfDiag * (1.0 - w);
  float cov = 1.0 - smoothstep(radius - 0.75, radius + 0.75, length(q - centre));

  float4 ink = float4(uCover.eval(p));
  // The leading band, where the dots are mid-shrink, carries the theme's
  // primary -- the ink still wet on the press.
  float lead = w * (1.0 - w) * 4.0 * uTintStrength * uTint.a;
  ink = float4(mix(ink.rgb, uTint.rgb, lead), ink.a);
  return half4(ink * cov);
}
`;

/* -------------------------------------------------------------------------- */
/* Theme and mode: a drop lands on the lake                                   */
/* -------------------------------------------------------------------------- */

/**
 * A circular front opens from the tapped row with a few damped rings behind
 * it, and the old interface is on the far side of the water.
 *
 * The rings are a refraction, not a drawing: each one bends the *sampling
 * coordinate* along the radius, so the interface under it swells and pinches
 * the way a page does under a ripple. With a photograph of the new interface
 * (`uLive` 0) that bend lands on both pictures; without one (`uLive` 1 -- every
 * Android run, whose cover is a veil, and any run whose second photograph was
 * late) the program has nothing to bend inside the front, so it is transparent
 * there and the rings are carried by their light alone: the slope of the water
 * lit from above, brighter on one face of each ring and darker on the other,
 * over the live interface.
 *
 * `uDepth` takes the whole surface down to flat as the run ends, so the last
 * frame is the new interface undisturbed and the overlay can go without a cut.
 */
export const THEME_RIPPLE_SKSL = `
uniform shader uCover;        // the old interface (photograph or veil)
uniform shader uNext;         // a photograph of the new interface, when uLive is 0

uniform float2 uOrigin;       // where the drop landed, in canvas points
uniform float  uFront;        // how far from it the front has reached
uniform float  uBand;         // the soft edge between old and new
uniform float  uWave;         // the distance between rings
uniform float  uAmp;          // the first ring's bend, in points
uniform float  uDecay;        // how fast the rings die away behind the front
uniform float  uTail;         // past this far behind the front, nothing bends
uniform float  uAhead;        // how far ahead of the front the fringe still lights
uniform float  uDepth;        // 1 while the water moves, 0 once it is flat
uniform float  uLive;         // 1: no photograph of the new interface
uniform float  uShade;        // how much the rings' slope lights or darkens
uniform float  uCrest;        // the crest's white highlight, at its peak
uniform float  uRimWidth;     // the fringe's half-width
uniform float  uChroma;       // how far its warm and cool lines separate
uniform float4 uRimColor;     // the new theme's primary, alpha already set

${SKSL_RIM}

const float TAU = 6.2831853;

half4 main(float2 p) {
  float2 r = p - uOrigin;
  float d = length(r);
  // How far behind the front this pixel is: negative is still open water
  // ahead of it, the old interface untouched.
  float x = uFront - d;

  // The cheap path. Ahead of the fringe: the old interface. Past the last
  // ring: the new one -- the photograph of it, or nothing over the live one.
  if (x < -uAhead) return half4(uCover.eval(p));
  if (x > uTail) return uLive > 0.5 ? half4(0.0) : half4(uNext.eval(p));

  float behind = max(x, 0.0);
  // No water moves ahead of the front: zero there, or the slope at phase 0
  // would light a thin ring ahead of it, and a dot before it has moved.
  float env = x > 0.0 ? uAmp * uDepth * exp(-uDecay * behind) : 0.0;
  float phase = TAU * behind / uWave;
  float disp = env * sin(phase);
  // The surface's slope along the radius, which is what the light catches.
  float slope = env * (TAU / uWave * cos(phase) - uDecay * sin(phase));
  float2 q = p + (r / max(d, 0.0001)) * disp;

  // 1 on the old side of the front, 0 on the new, over a soft band.
  float m = smoothstep(uFront - uBand, uFront, d);
  float4 old = float4(uCover.eval(q));
  float4 base = uLive > 0.5 ? old * m : mix(float4(uNext.eval(q)), old, m);

  float light = clamp(slope * uShade, -1.0, 1.0);
  float4 lit = light > 0.0
    ? over(float4(light), base)
    : over(float4(0.0, 0.0, 0.0, -light * 0.7), base);

  // A thin white highlight riding the crest, just behind the front, and the
  // new primary as a one-point fringe on the very edge. Both fade in over the
  // first few points of travel: before the drop has landed -- while the cover
  // is still arriving -- they would be a dot sitting still under the finger.
  float landed = clamp(uFront / 12.0, 0.0, 1.0);
  float c = (x - 2.0) / 1.6;
  float crestA = uCrest * uDepth * landed * exp(-c * c);
  lit = over(float4(crestA), lit);
  lit = over(rimLight(x, uRimWidth, uChroma, uRimColor) * landed, lit);
  return half4(lit);
}
`;

/* -------------------------------------------------------------------------- */
/* Font: a holographic scan                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A band opens at the tapped row and splits in two, one travelling up and one
 * down, and the page it crosses is re-encoded on the way out.
 *
 * Inside a band the old page drops to a coarse pixel grid with its red and
 * blue pulled a point and a half apart -- a signal being re-sent -- and the
 * cells blink out one by one, each at its own threshold, until the trailing
 * edge has passed and the newly set page underneath is all that is left. Two
 * or three faint lines in the theme's primary ride inside the band and a
 * thin primary line marks its leading edge. Ahead of the band the page is the
 * photograph, untouched.
 *
 * Distance is vertical only (`abs(p.y - uOriginY)`), which is what makes the
 * same arithmetic two bands rather than one ring.
 */
export const FONT_SCAN_SKSL = `
uniform shader uCover;        // the photograph of the old interface

uniform float  uOriginY;      // the tapped row, in canvas points
uniform float  uFront;        // how far each band's leading edge is from it
uniform float  uBand;         // the band's height
uniform float  uCell;         // the re-encoding grid, in points
uniform float  uSplit;        // how far red and blue are pulled apart
uniform float  uLineAlpha;    // the lines riding inside the band
uniform float  uEdgeAlpha;    // the leading edge's line
uniform float4 uTint;         // the theme's primary

${SKSL_NOISE}
${SKSL_RIM}

half4 main(float2 p) {
  // How far the leading edge is past this row: negative is ahead of the band.
  float lead = uFront - abs(p.y - uOriginY);

  // The cheap path: ahead of the band the page, behind it nothing.
  if (lead < -2.0) return half4(uCover.eval(p));
  if (lead > uBand + 2.0) return half4(0.0);

  float w = clamp(lead / uBand, 0.0, 1.0);
  float4 base;
  if (lead <= 0.0) {
    base = float4(uCover.eval(p));
  } else {
    float2 cell = floor(p / uCell);
    float2 c = (cell + 0.5) * uCell;
    float4 g = float4(uCover.eval(c));
    float red = float4(uCover.eval(c + float2(uSplit, 0.0))).r;
    float blue = float4(uCover.eval(c - float2(uSplit, 0.0))).b;
    // Each cell holds until the band has carried it past its own threshold.
    float keep = step(clamp((w - 0.12) / 0.8, 0.0, 1.0), hash21(cell));
    base = float4(red, g.g, blue, g.a) * keep;
  }

  // Three faint lines at fixed places in the band, moving with it.
  float lines = 0.0;
  for (int i = 1; i <= 3; i++) {
    float at = uBand * 0.25 * float(i);
    lines += 1.0 - smoothstep(0.0, 1.0, abs(lead - at));
  }
  float lineA = clamp(lines, 0.0, 1.0) * uLineAlpha * uTint.a;
  float4 lit = over(float4(uTint.rgb * lineA, lineA), base);

  // Faded in over the first few points, or the edge is a line parked on the
  // tapped row while the cover arrives.
  float edgeA = exp(-lead * lead / 0.8) * uEdgeAlpha * uTint.a * clamp(uFront / 12.0, 0.0, 1.0);
  return half4(over(float4(uTint.rgb * edgeA, edgeA), lit));
}
`;

/* -------------------------------------------------------------------------- */
/* Compilation                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Compiled once, at module scope.
 *
 * `Skia.RuntimeEffect.Make` returns `null` on a compile error rather than
 * throwing, so a typo here would otherwise be discovered one mount at a time.
 * Callers must read `null` as "this device cannot draw it" and apply the theme
 * or the font with no transition at all: the effect is an account of a change,
 * never a precondition for one.
 */
export const THEME_WASH_EFFECT = Skia.RuntimeEffect.Make(THEME_WASH_SKSL);
export const FONT_HALFTONE_EFFECT = Skia.RuntimeEffect.Make(FONT_HALFTONE_SKSL);
export const THEME_RIPPLE_EFFECT = Skia.RuntimeEffect.Make(THEME_RIPPLE_SKSL);
export const FONT_SCAN_EFFECT = Skia.RuntimeEffect.Make(FONT_SCAN_SKSL);

/* -------------------------------------------------------------------------- */
/* The wash's numbers                                                         */
/* -------------------------------------------------------------------------- */

/** How far the noise displaces the front, in points. A bleed, not a ripple. */
export const WASH_BLEED = 30;

/** The lit edge's half-width, in points. A line, not a band. */
export const WASH_RIM_WIDTH = 2.2;

/** How far the rim's warm and cool lines sit apart, in points. */
export const WASH_CHROMA = 1.0;

/**
 * How far the damp band reaches behind the front, in points.
 *
 * Wide enough to read as wet paper rather than as a drop shadow on the edge,
 * narrow enough that the new theme is only dampened for the moment the front
 * is passing rather than for the length of the run.
 */
export const WASH_WET_WIDTH = 56;

/** How much of the damp band lands. Paper, not a bruise. */
export const WASH_WET_STRENGTH = 0.3;

/** How far the new primary spills forward onto the old interface, in points. */
export const WASH_GLOW_OUT = 18;

/** How much of that spill lands. */
export const WASH_GLOW_STRENGTH = 0.28;

/**
 * How far from the front anything can still be happening, in points.
 *
 * The program's early-out reads this: past it a pixel is cover or is gone and
 * pays for neither the noise nor the light. Everything that contributes has a
 * stated reach except the rim, which is a Gaussian and gets three sigmas.
 */
export function washSlack(): number {
  'worklet';
  return (
    WASH_BLEED + Math.max(WASH_WET_WIDTH, WASH_GLOW_OUT, rimSlack(WASH_RIM_WIDTH, WASH_CHROMA))
  );
}

/* -------------------------------------------------------------------------- */
/* The halftone's numbers                                                     */
/* -------------------------------------------------------------------------- */

/**
 * How wide the band of shrinking dots is, in points.
 *
 * This is the whole legibility of the effect: too narrow and the page snaps
 * off in a ring, too wide and every dot on the screen is mid-shrink at once
 * and it reads as a dissolve rather than as a wave. Around a dozen cells.
 */
export const HALFTONE_BAND = 150;

/** How much primary the leading band carries, at its peak. */
export const HALFTONE_TINT_STRENGTH = 0.42;

/** A dot at full coverage: the cell's half-diagonal, so the cells overlap. */
export function halftoneHalfDiagonal(cell: number): number {
  'worklet';
  return cell * Math.SQRT1_2;
}

/* -------------------------------------------------------------------------- */
/* The typed wrappers                                                         */
/* -------------------------------------------------------------------------- */

/** A size in canvas points. */
export type ReskinSize = { width: number; height: number };

/** A point in canvas points. */
export type ReskinPoint = { x: number; y: number };

/** Everything the wash needs, in the caller's own words. */
export type ThemeWashInput = {
  /** Where the front's geometry is measured from -- see {@link washGeometry}. */
  origin: ReskinPoint;
  /** Unit vector, the way the front travels. */
  direction: ReskinPoint;
  /** How far along `direction` the front has reached, in points. */
  front: number;
  /** 0..1, how far the bleed has evolved. Ride the run's own progress. */
  drift: number;
  /** `[r, g, b, a]`, 0..1 -- the new theme's primary. Use `colorVector`. */
  rim: number[];
  /** `[r, g, b, a]`, 0..1 -- the damp band behind the front. */
  wet: number[];
};

/**
 * The wash's uniforms, from the caller's words.
 *
 * A worklet, because the whole point is that the uniforms come off shared
 * values on the UI thread and JavaScript does nothing per frame: call it
 * inside `useDerivedValue` and pass the result straight to `<Shader>`.
 */
export function themeWashUniforms(input: ThemeWashInput): Uniforms {
  'worklet';
  return {
    uOrigin: [input.origin.x, input.origin.y],
    uDir: [input.direction.x, input.direction.y],
    uFront: input.front,
    uBleed: WASH_BLEED,
    uSlack: washSlack(),
    uDrift: input.drift,
    uRimWidth: WASH_RIM_WIDTH,
    uChroma: WASH_CHROMA,
    uWetWidth: WASH_WET_WIDTH,
    uWetStrength: WASH_WET_STRENGTH,
    uGlowOut: WASH_GLOW_OUT,
    uGlowStrength: WASH_GLOW_STRENGTH,
    uRimColor: input.rim,
    uWetColor: input.wet,
  };
}

/** Everything the halftone needs, in the caller's own words. */
export type FontHalftoneInput = {
  /** The tapped row, in canvas points. Rotated into screen-angle space here. */
  origin: ReskinPoint;
  /** How far out the wave has reached, in points. */
  front: number;
  /** The halftone cell, about one x-height of body text. */
  cell: number;
  /** `[r, g, b, a]`, 0..1 -- the theme's primary. */
  tint: number[];
};

/**
 * The halftone's uniforms, from the caller's words.
 *
 * The origin is rotated into the 45-degree screen-angle space here rather than
 * in the program, because it is the same rotation for every pixel of every
 * frame and there are two and a half million of those.
 *
 * A worklet, for the reason on {@link themeWashUniforms}.
 */
export function fontHalftoneUniforms(input: FontHalftoneInput): Uniforms {
  'worklet';
  const k = Math.SQRT1_2;
  return {
    uOrigin: [input.origin.x * k - input.origin.y * k, input.origin.x * k + input.origin.y * k],
    uFront: input.front,
    uBand: HALFTONE_BAND,
    uCell: input.cell,
    uHalfDiag: halftoneHalfDiagonal(input.cell),
    uTintStrength: HALFTONE_TINT_STRENGTH,
    uTint: input.tint,
  };
}

/* -------------------------------------------------------------------------- */
/* The ripple's light                                                         */
/* -------------------------------------------------------------------------- */

/**
 * How much the rings' slope lights the picture, per unit of slope, when the
 * refraction is doing the work. The steepest ring face is about 1.3, so this
 * is at most a tenth of white or black: a sheen on the bend, not a drawing.
 */
export const RIPPLE_SHADE = 0.08;

/**
 * The same, over the live interface with no photograph to bend: the light is
 * all the rings have there, so it carries about twice as much.
 */
export const RIPPLE_SHADE_LIVE = 0.17;

/** The crest's white highlight at its peak. Low: water catches light, it does not glow. */
export const RIPPLE_CREST = 0.22;

/** The primary fringe on the front's edge, at its peak alpha. */
export const RIPPLE_FRINGE_ALPHA = 0.27;

/** The fringe's half-width and its warm/cool separation, in points: about one pixel. */
export const RIPPLE_FRINGE_WIDTH = 0.8;
export const RIPPLE_FRINGE_CHROMA = 0.6;

/* -------------------------------------------------------------------------- */
/* The scan's numbers                                                         */
/* -------------------------------------------------------------------------- */

/** The re-encoding grid, in points: coarse enough to read as a signal, not as blur. */
export const SCAN_CELL = 6;

/** How far red and blue are pulled apart inside the band, in points. */
export const SCAN_SPLIT = 1.5;

/** The faint lines riding inside the band. */
export const SCAN_LINE_ALPHA = 0.22;

/** The line on the band's leading edge. */
export const SCAN_EDGE_ALPHA = 0.85;

/** Everything the ripple needs, in the caller's own words. */
export type ThemeRippleInput = {
  /** Where the drop landed, in canvas points. */
  origin: ReskinPoint;
  /** How far from it the front has reached, in points. */
  front: number;
  /** 1 while the water moves, 0 once it is flat. */
  depth: number;
  /** No photograph of the new interface: the rings are light over the live one. */
  live: boolean;
  /** `[r, g, b, a]`, 0..1 -- the new theme's primary. */
  rim: number[];
};

/** The ripple's uniforms, from the caller's words. A worklet, as the others are. */
export function themeRippleUniforms(input: ThemeRippleInput): Uniforms {
  'worklet';
  return {
    uOrigin: [input.origin.x, input.origin.y],
    uFront: input.front,
    uBand: RIPPLE_BAND,
    uWave: RIPPLE_WAVELENGTH,
    uAmp: RIPPLE_AMPLITUDE,
    uDecay: RIPPLE_DECAY,
    uTail: RIPPLE_TAIL,
    uAhead: rimSlack(RIPPLE_FRINGE_WIDTH, RIPPLE_FRINGE_CHROMA),
    uDepth: input.depth,
    uLive: input.live ? 1 : 0,
    uShade: input.live ? RIPPLE_SHADE_LIVE : RIPPLE_SHADE,
    uCrest: RIPPLE_CREST,
    uRimWidth: RIPPLE_FRINGE_WIDTH,
    uChroma: RIPPLE_FRINGE_CHROMA,
    uRimColor: [
      input.rim[0] ?? 0,
      input.rim[1] ?? 0,
      input.rim[2] ?? 0,
      RIPPLE_FRINGE_ALPHA * (input.rim[3] ?? 1),
    ],
  };
}

/** Everything the scan needs, in the caller's own words. */
export type FontScanInput = {
  /** The tapped row, in canvas points. */
  originY: number;
  /** How far each band's leading edge is from it, in points. */
  front: number;
  /** `[r, g, b, a]`, 0..1 -- the theme's primary. */
  tint: number[];
};

/** The scan's uniforms, from the caller's words. A worklet, as the others are. */
export function fontScanUniforms(input: FontScanInput): Uniforms {
  'worklet';
  return {
    uOriginY: input.originY,
    uFront: input.front,
    uBand: SCAN_BAND,
    uCell: SCAN_CELL,
    uSplit: SCAN_SPLIT,
    uLineAlpha: SCAN_LINE_ALPHA,
    uEdgeAlpha: SCAN_EDGE_ALPHA,
    uTint: input.tint,
  };
}

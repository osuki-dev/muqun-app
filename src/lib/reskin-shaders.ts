import { Skia, type Uniforms } from '@shopify/react-native-skia';

import { SKSL_NOISE, SKSL_RIM, rimSlack } from './sksl-field';

/**
 * The two re-skin transitions: what the reader sees in the half-second after
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
 * ## Neither of these is the launch's bloom
 *
 * The bloom is a radial hole with a torn, lit edge. These are a straight front
 * crossing the screen, and a grid of dots shrinking to nothing. They share the
 * noise field, the rim helper and the uniform-builder shape -- the
 * infrastructure -- and nothing about how they look.
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

/**
 * The agent transcript's gutter grid: one set of columns and one vertical
 * rhythm for every block, so a tool row, a thought, a notice, a checklist and
 * a quote line up with each other instead of each carrying its own padding.
 *
 * Read left to right, from a plate's own edge:
 *
 *   | inset | marker column | gap | text ...
 *   0       12              25    32
 *
 * - `inset` is the horizontal padding of every plate, card and pill.
 * - The marker column holds whatever marks a row: a tool's icon, the thought's
 *   disclosure chevron or its thinking pulse, a notice's icon, a checklist
 *   tick. Markers are centred in it, so glyphs of different widths share one
 *   x-centre.
 * - A hanging rule -- the thought body's -- is centred in the same column, so
 *   the rule sits directly under the chevron that opened it.
 * - `textOrigin` is where everything that hangs off a marker starts: a tool's
 *   name and the facts under it, the thought's label, its heading and its body,
 *   a notice's text, a checklist item.
 *
 * Prose (a reply, a user message) is not hanging content and starts at
 * `inset`. A markdown quote inside it draws its rule at the prose edge -- the
 * renderer has no way to move it -- and its text at `textOrigin`, so quoted
 * text still lands on the hanging column.
 *
 * Vertically:
 *
 * - `rowGap` between any two rows, whatever they are (half above, half below).
 * - `attachGap` between a marker row and the block it opens (the thought pill
 *   and its body, a tool header and the facts under it).
 * - `plateInsetY` is the vertical padding of a plate that holds text.
 */
export const TRANSCRIPT_GRID = {
  inset: 12,
  markerWidth: 13,
  markerGap: 7,
  textOrigin: 32,
  ruleWidth: 2,
  /** The rule's ink, as a fraction of the theme's primary colour. */
  ruleAlpha: 0.35,
  rowGap: 10,
  attachGap: 6,
  plateInsetY: 10,
} as const;

/** Where a hanging rule's left edge sits, from the plate's edge. */
export const TRANSCRIPT_RULE_X =
  TRANSCRIPT_GRID.inset + (TRANSCRIPT_GRID.markerWidth - TRANSCRIPT_GRID.ruleWidth) / 2;

/** How far hanging text is indented from the start of a plate's content. */
export const TRANSCRIPT_HANG = TRANSCRIPT_GRID.markerWidth + TRANSCRIPT_GRID.markerGap;

/**
 * Typical metrics, as fractions of the font size, of the faces the transcript
 * is set in: Roboto / SF on the system slot, JetBrains Mono and its kind on the
 * mono slot. The trims below are within half a point of each other for all of
 * them, which is why one pair of numbers serves whichever face is installed.
 */
const ASCENT = 0.93;
const DESCENT = 0.24;
const CAP_HEIGHT = 0.71;

/**
 * How far a hanging rule stops short of its text block's line boxes, so it
 * runs from the first line's cap height to the last line's baseline.
 *
 * A line box of height `lineHeight` centres the font's ascent + descent in it;
 * the cap top is `ascent - capHeight` below the ascent line and the baseline is
 * `ascent` below it. Rounded to half a point.
 */
export function transcriptRuleTrim(
  fontSize: number,
  lineHeight: number
): { top: number; bottom: number } {
  const halfLeading = (lineHeight - (ASCENT + DESCENT) * fontSize) / 2;
  const capTop = halfLeading + (ASCENT - CAP_HEIGHT) * fontSize;
  const baseline = halfLeading + ASCENT * fontSize;
  const half = (value: number) => Math.round(value * 2) / 2;
  return { top: half(capTop), bottom: half(lineHeight - baseline) };
}

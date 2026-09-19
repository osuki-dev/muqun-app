/**
 * The one line of the launch that could only belong to a terminal app.
 *
 * Everything else the opening does -- a world blooming out of a picture -- a
 * photo app could do. The signature is this: in the lower third, a monospace
 * prompt types the name of the world being loaded, one character at a time,
 * with a block cursor that blinks once and goes out. It is small, it is the
 * pack's own colours, and it says what the app is without a word of marketing.
 *
 * Free of React, React Native and Reanimated imports on purpose, so `bun test`
 * can load it -- see the note atop `motion-tokens.test.ts`. The functions the
 * component drives per frame carry the `'worklet'` directive, so they run on
 * the UI thread inside `useAnimatedStyle`; outside Metro the directive is an
 * inert string literal and the arithmetic is ordinary, which is exactly what
 * makes them testable.
 */

/** The prompt's sigil. One glyph, no shell it is pretending to be. */
export const PROMPT_SIGIL = '›';

/**
 * The longest name the line will spell out.
 *
 * A pack name is authored, so it can be anything; the prompt is one line on a
 * phone. Past this the name is cut and marked as cut, which is honest, rather
 * than shrunk until it is a grey smear on somebody's painting.
 */
export const PROMPT_NAME_LIMIT = 32;

/**
 * The prompt's line for a pack: the sigil, a space, and the pack's name.
 *
 * Whitespace is collapsed because a name comes out of an author's JSON and may
 * carry a newline; the name is trimmed and cut to {@link PROMPT_NAME_LIMIT}.
 * A pack with no name at all -- which is what a built-in looks like before the
 * settings store has hydrated -- yields the sigil alone, which still reads as
 * a prompt waiting.
 */
export function launchPromptLine(name: string | null | undefined): string {
  const collapsed = (name ?? '').replace(/\s+/g, ' ').trim();
  if (!collapsed) return `${PROMPT_SIGIL} `;
  const cut =
    collapsed.length > PROMPT_NAME_LIMIT
      ? `${collapsed.slice(0, PROMPT_NAME_LIMIT - 1)}…`
      : collapsed;
  return `${PROMPT_SIGIL} ${cut}`;
}

/**
 * How many characters have been struck at this point in the typing beat.
 *
 * This is the whole schedule. The line is drawn once and revealed by a clip
 * that is moved to exactly this many cells, and the cursor sits on the same
 * number, so the block is always on the character that just arrived -- which
 * is what makes a hard-edged reveal read as typing rather than as a wipe.
 * A cursor that slid continuously while the characters appeared in steps
 * would be a cursor that is usually in the wrong place, and the one that is
 * wrong is the one the eye is on.
 */
export function typedCount(progress: number, length: number): number {
  'worklet';
  if (!(length > 0)) return 0;
  if (!Number.isFinite(progress)) return length;
  return Math.max(0, Math.min(length, Math.floor(progress * length)));
}

/**
 * The block cursor's opacity across its single blink: on, off, on.
 *
 * Stepped, unlike the characters. A terminal cursor does not fade, and the
 * whole point of the beat is that the line is finished and something is
 * waiting -- which a dissolve does not say.
 */
export function cursorOpacity(progress: number): number {
  'worklet';
  if (!Number.isFinite(progress)) return 1;
  if (progress < 0.3) return 1;
  if (progress < 0.72) return 0;
  return 1;
}

/**
 * How wide the scrim under the line has to be, given how much has been typed.
 *
 * The scrim exists only because the line is drawn on somebody's painting and a
 * pack cannot promise the paint under the lower third is quiet. It is as wide
 * as the text and no wider, which means it grows as the line is typed --
 * a detail worth having, because a full-width plate appearing before the text
 * does is the thing that makes a caption look like a caption.
 */
export function scrimWidth(
  typed: number,
  characterWidth: number,
  padding: number,
  minimum: number
): number {
  'worklet';
  if (!Number.isFinite(characterWidth) || characterWidth <= 0) return minimum;
  return Math.max(minimum, typed * characterWidth + padding * 2);
}

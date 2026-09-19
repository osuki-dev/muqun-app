import type { MarkdownStyle } from 'react-native-enriched-markdown';

/**
 * The palette a block of native markdown was painted with.
 *
 * `EnrichedMarkdownText` reads `markdownStyle` when its native view is created
 * and does not re-apply it when the prop changes. A theme or colour-mode switch
 * therefore leaves prose that is already on screen painted in the *previous*
 * palette's ink: switch to dark and dark ink stays on the new near-black
 * background, switch back and pale ink stays on white. It reads as a contrast
 * bug -- the user's own message looking disabled beside its own caption -- but
 * no colour is wrong; the view simply never repainted. Everything React Native
 * draws itself (captions, tool labels, the thought text) updates in place,
 * which is what makes the markdown blocks stand out.
 *
 * Passing this as the element's `key` remounts the native view when, and only
 * when, the palette changes, which is the one thing that repaints it. Themes
 * change by hand, so the remount costs nothing in practice.
 *
 * The two font families are in the key for the same reason the two colours
 * are, and the symptom is worse. A reader who installs a font while a
 * transcript is on screen would otherwise get a *split* rendering: every block
 * already painted stays in the old face and every block that arrives after is
 * in the new one, in one scroller, with no way back but killing the app. The
 * family is also the thing a reader changes deliberately and then looks
 * straight at, so a remount that lags it is the first thing they see.
 *
 * Both families, not just the prose one: a transcript is mostly prose with
 * code in it, and swapping only the mono slot changes nothing the paragraph
 * colour can see.
 */
export function markdownPaletteKey(style: MarkdownStyle): string {
  const ink = style.paragraph?.color ?? '';
  const code = style.codeBlock?.backgroundColor ?? '';
  const prose = style.paragraph?.fontFamily ?? '';
  const mono = style.codeBlock?.fontFamily ?? '';
  return `${String(ink)}|${String(code)}|${String(prose)}|${String(mono)}`;
}

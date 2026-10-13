import type { MarkdownStyle } from 'react-native-enriched-markdown';

/**
 * Keep native markdown remounts tied to its complete style. Watching only body
 * ink, code fill and fonts misses accent-only theme edits and layout changes:
 * an existing table can retain its old header, border or corner treatment.
 * Image sizing follows the viewport and must not remount selected text on resize.
 */
export function markdownPaletteKey(style: MarkdownStyle): string {
  const { image, ...blocks } = style;
  return JSON.stringify({ ...blocks, image: image && { borderRadius: image.borderRadius } });
}

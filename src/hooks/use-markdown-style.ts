import { useMemo } from 'react';
import { useThemeTokens } from '@osuki-dev/ui';
import type { MarkdownStyle } from 'react-native-enriched-markdown';

import { createCompactMarkdownStyle } from '@/lib/markdown-style';

/**
 * The ink a compact markdown block is set in, named rather than passed as a
 * colour: `body` for something that is content in its own right (a checklist
 * item, a question the agent asked), `muted` for a note about content (a
 * notice, a skill's text, a form's description), `danger` for a failure the
 * engine reported.
 */
export type MarkdownTone = 'body' | 'muted' | 'danger';

/**
 * The compact markdown style, subscribed to the theme.
 *
 * A hook rather than a prop, for the same reason `usePaneChatMarkdownStyle` is
 * one: the transcript's cells are memoised and skip re-renders the list cannot
 * see, so a style handed down through render props stays the palette the cell
 * was born with. Reading the theme here subscribes the cell itself, and
 * `BoundedMarkdown` keys its native view on the palette so it actually
 * repaints (see `markdownPaletteKey`).
 */
export function useCompactMarkdownStyle(tone: MarkdownTone = 'muted'): MarkdownStyle {
  const theme = useThemeTokens();
  return useMemo(() => {
    const colors = theme.colors;
    const ink =
      tone === 'body' ? colors.text : tone === 'danger' ? colors.danger : colors.textMuted;
    return createCompactMarkdownStyle(colors, ink);
  }, [theme.colors, tone]);
}

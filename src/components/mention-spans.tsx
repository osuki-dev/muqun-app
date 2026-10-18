import { useThemeTokens } from '@osuki-dev/ui';
import type { ReactNode } from 'react';
import { Text as SpanText } from 'react-native';

import type { MentionRange } from '@/lib/composer-mentions';

/**
 * The draft as nested spans of the field: mentions tinted (a computer in the
 * accent, a file a quieter tone), everything else in the field's own ink.
 * React Native's own `Text`, so each span inherits the field's font and size
 * and only the colour changes.
 */
export function MentionSpans({ text, ranges }: { text: string; ranges: readonly MentionRange[] }) {
  const theme = useThemeTokens();
  const pieces: ReactNode[] = [];
  let at = 0;
  for (const range of ranges) {
    if (range.start > at) pieces.push(text.slice(at, range.start));
    pieces.push(
      <SpanText
        key={range.start}
        style={{ color: range.kind === 'computer' ? theme.colors.primary : theme.colors.info }}>
        {text.slice(range.start, range.end)}
      </SpanText>
    );
    at = range.end;
  }
  if (at < text.length) pieces.push(text.slice(at));
  return <>{pieces}</>;
}

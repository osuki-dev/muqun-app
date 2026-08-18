import { useLingui } from '@lingui/react/macro';
import { Text as UIText, useThemeTokens } from '@osuki-dev/ui';
import type { Colors } from '@osuki-dev/ui';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  highlightFile,
  type CodeLine,
  type TokenRole,
} from '@/lib/code-highlight';

/**
 * A source file or a diff, coloured, read-only.
 *
 * Two render paths, because the two have different units of meaning.
 *
 * **Syntax** is a property of runs of characters, so the whole file goes into
 * one `<Text>` with the coloured runs nested inside it. Nested `<Text>` does not
 * create views -- React Native folds it into ranges on a single native
 * attributed string -- which is why a file with nine thousand spans is
 * affordable at all.
 *
 * **A diff** is a property of whole lines, so each line needs its own `<View>`:
 * a background set on a text span paints only behind the glyphs, and a diff
 * whose tint stops at the end of the text does not read as a diff. That is the
 * expensive path, and it is what `HIGHLIGHT_MAX_LINES` protects.
 *
 * Neither path wraps, and both scroll horizontally. A re-wrapped line loses the
 * column alignment that is the entire reason for reading a log or a diff in a
 * monospaced face.
 */
export function CodeView({ name, content }: { name: string; content: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const result = useMemo(() => highlightFile(name, content), [content, name]);
  const roleColors = useMemo(() => roleColorMap(theme.colors), [theme.colors]);

  const isDiff = result.language === 'diff';

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {result.skipped ? (
        <UIText variant="caption" color={theme.colors.textMuted} style={styles.notice}>
          {result.skipped === 'size'
            ? t`Too large to colour. Shown as plain text.`
            : t`Too many lines to colour. Shown as plain text.`}
        </UIText>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        {isDiff ? (
          <View>
            {result.lines.map((line, index) => (
              <View
                // Lines have no identity of their own; position is what they are.
                key={index}
                style={[
                  styles.diffRow,
                  { backgroundColor: diffBackground(line, theme.colors) },
                ]}>
                <Text
                  selectable
                  style={[styles.code, { color: diffColor(line, theme.colors, roleColors) }]}>
                  {line.spans.length > 0 ? line.spans.map((span) => span.text).join('') : ' '}
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text selectable style={[styles.code, { color: theme.colors.text }]}>
            {result.lines.map((line, lineIndex) => (
              <Text key={lineIndex}>
                {line.spans.map((span, spanIndex) => (
                  <Text
                    key={spanIndex}
                    style={[
                      { color: roleColors[span.role] },
                      span.role === 'comment' ? styles.comment : null,
                    ]}>
                    {span.text}
                  </Text>
                ))}
                {lineIndex < result.lines.length - 1 ? '\n' : ''}
              </Text>
            ))}
          </Text>
        )}
      </ScrollView>
    </ScrollView>
  );
}

/**
 * Roles to theme tokens.
 *
 * Six roles because six is what the palette can say. Every colour is a token,
 * so the whole code theme re-tints with the app rather than drifting away from
 * it the way a vendored highlight theme would.
 */
function roleColorMap(colors: Colors): Record<TokenRole, string> {
  return {
    plain: colors.text,
    keyword: colors.primary,
    string: colors.success,
    number: colors.warning,
    comment: colors.textSubtle,
    name: colors.info,
    punctuation: colors.textMuted,
  };
}

/**
 * The row tint.
 *
 * Both halves come from the same alpha applied to their own token. There is a
 * `dangerSubtle` token but no `successSubtle`, and a diff whose red and green
 * are tinted at different strengths looks broken -- so neither uses the ready
 * made one.
 */
const DIFF_TINT_ALPHA = 0.14;

function diffBackground(line: CodeLine, colors: Colors): string | undefined {
  if (line.diff === 'added') return withAlpha(colors.success, DIFF_TINT_ALPHA);
  if (line.diff === 'removed') return withAlpha(colors.danger, DIFF_TINT_ALPHA);
  if (line.diff === 'hunk') return withAlpha(colors.primary, DIFF_TINT_ALPHA);
  return undefined;
}

function diffColor(
  line: CodeLine,
  colors: Colors,
  roleColors: Record<TokenRole, string>
): string {
  if (line.diff === 'added') return colors.success;
  if (line.diff === 'removed') return colors.danger;
  if (line.diff === 'hunk') return colors.primary;
  if (line.diff === 'meta') return colors.textMuted;
  return roleColors.plain;
}

/**
 * Alpha over a token colour.
 *
 * Handles the `#rgb`/`#rrggbb` the theme uses and passes anything else through
 * untouched, so a palette that starts emitting `rgb()` degrades to an opaque
 * tint rather than to an invalid colour the native side would reject.
 */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color)?.[1];
  if (!hex) return color;
  const full = hex.length === 3 ? hex.split('').map((part) => part + part).join('') : hex;
  const red = Number.parseInt(full.slice(0, 2), 16);
  const green = Number.parseInt(full.slice(2, 4), 16);
  const blue = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  notice: {
    marginBottom: 10,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 12.5,
    lineHeight: 18,
  },
  comment: {
    fontStyle: 'italic',
  },
  diffRow: {
    // The tint is the line's verdict, so it runs the whole row rather than
    // stopping where the text does.
    minWidth: '100%',
    paddingHorizontal: 4,
  },
});

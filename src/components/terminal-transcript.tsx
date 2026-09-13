import { useMemo } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';

import { useTerminalTheme } from '@/hooks/use-theme-pack';
import { parseTerminalSnapshot } from '@/terminal/terminal-core';

/**
 * Terminal output somewhere that is not the terminal.
 *
 * An agent's answer arrives as a pane snapshot: monospaced, column-aligned, and
 * carrying SGR escapes for colour, bold and dim. Putting that string in an
 * ordinary `<Text>` throws all of it away -- the escapes render as nothing, the
 * proportional font breaks every table and diff the agent drew, and a reader
 * comparing the card against the pane it came from sees two different things.
 * That is what this replaces.
 *
 * It is not a second terminal. `SkiaTerminal` is a canvas with a font manager,
 * a picture cache and gesture handling, and standing one up inside a card that
 * floats over the real one would cost a second GPU surface for a few lines of
 * read-only text. This reuses only the parser: `parseTerminalSnapshot` returns
 * rows of style runs, and a run maps exactly onto a nested `<Text>`.
 *
 * What it deliberately does not carry over: the cursor, links, selection, and
 * the background fill. The card has its own surface, and a transcript that
 * painted its own black rectangle inside it would read as a screenshot rather
 * than as part of the card.
 */
export function TerminalTranscript({
  output,
  testID,
  maxLines = 200,
}: {
  output: string;
  testID?: string;
  /** A card is not a scrollback. The tail is what an answer ends with. */
  maxLines?: number;
}) {
  const theme = useTerminalTheme();
  const lines = useMemo(() => {
    const frame = parseTerminalSnapshot(output, theme);
    const rows = frame.lines.slice(-maxLines);
    // Trailing blank rows are the emulator padding its grid to a row count, not
    // something the agent wrote. They would otherwise read as the answer
    // trailing off.
    while (rows.length && !rows[rows.length - 1].runs.some((run) => run.text.trim())) rows.pop();
    return rows;
  }, [output, theme, maxLines]);

  return (
    <Text testID={testID} selectable style={[styles.block, { color: theme.foreground }]}>
      {lines.map((line, row) => (
        <Text key={row}>
          {line.runs.map((run, index) => (
            <Text
              key={index}
              style={{
                // `inverse` is how an agent marks a selection or a header bar,
                // and swapping the pair is the whole of what it means.
                color: run.style.inverse
                  ? (run.style.background ?? theme.background)
                  : (run.style.foreground ?? theme.foreground),
                ...(run.style.inverse
                  ? { backgroundColor: run.style.foreground ?? theme.foreground }
                  : run.style.background
                    ? { backgroundColor: run.style.background }
                    : null),
                ...(run.style.bold ? { fontWeight: '700' as const } : null),
                ...(run.style.italic ? { fontStyle: 'italic' as const } : null),
                ...(run.style.underline || run.style.strikethrough
                  ? {
                      textDecorationLine: run.style.underline
                        ? run.style.strikethrough
                          ? ('underline line-through' as const)
                          : ('underline' as const)
                        : ('line-through' as const),
                    }
                  : null),
                // Dim is an opacity in every terminal that honours it, and RN
                // has no per-run opacity -- so it rides the colour it already
                // has rather than being dropped.
                ...(run.style.dim ? { opacity: 0.65 } : null),
              }}>
              {/* A hidden run still occupies its columns: the grid is aligned by
                  character count, and dropping the text would shift the row. */}
              {run.style.hidden ? ' '.repeat(run.text.length) : run.text}
            </Text>
          ))}
          {row < lines.length - 1 ? '\n' : ''}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  block: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 11,
    // Tight, because the rows were laid out for a grid and extra leading is
    // what makes a pasted diff stop looking like one.
    lineHeight: 15,
  },
});

import { useLingui } from '@lingui/react/macro';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { useTerminalTheme } from '@/hooks/use-theme-pack';
import { parseTerminalSnapshot, terminalFrameText } from '@/terminal/terminal-core';

export function SkiaTerminal({
  output,
  bottomInset = 0,
  topInset = 0,
}: {
  output: string;
  terminalId: string;
  bottomInset?: number;
  /** Clearance for the floating header, for a pane running a full-screen program. */
  topInset?: number;
}) {
  const { t } = useLingui();
  const terminalTheme = useTerminalTheme();
  const text = useMemo(
    () => terminalFrameText(parseTerminalSnapshot(output, terminalTheme)),
    [output, terminalTheme]
  );
  return (
    <View style={[styles.shell, { backgroundColor: terminalTheme.background }]}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: bottomInset + 12, paddingTop: topInset },
        ]}>
        <Text selectable style={[styles.output, { color: terminalTheme.foreground }]}>
          {text || t`Waiting for output…`}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, width: '100%', minHeight: 280 },
  content: { flexGrow: 1, padding: 8, justifyContent: 'flex-end' },
  output: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 19,
  },
});

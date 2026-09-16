import { useState, memo, useMemo } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Terminal,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  AlertCircle,
  CheckCircle2,
  Loader2,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import Animated from 'react-native-reanimated';
import { PressableScale } from '@/components/pressable-scale';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { fadeIn, fadeOut, listLayout } from '@/lib/motion';

export interface EmbeddedTerminalProps {
  toolId: string;
  toolName: string;
  command?: string;
  input?: unknown;
  output?: unknown;
  status: 'running' | 'completed' | 'failed';
  defaultExpanded?: boolean;
}

export const EmbeddedTerminalToolBlock = memo(function EmbeddedTerminalToolBlock({
  toolName,
  command,
  input,
  output,
  status,
  defaultExpanded = true,
}: EmbeddedTerminalProps) {
  const theme = useThemeTokens();
  const { t } = useLingui();
  const surfaceBackground = useSurfaceBackground();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  // Extract display command
  const displayCommand = useMemo(() => {
    if (command) return command;
    if (typeof input === 'string') return input;
    if (input && typeof input === 'object') {
      const rec = input as Record<string, unknown>;
      if (typeof rec.command === 'string') return rec.command;
      if (typeof rec.cmd === 'string') return rec.cmd;
      if (typeof rec.query === 'string') return rec.query;
      return JSON.stringify(input, null, 2);
    }
    return '';
  }, [command, input]);

  // Extract output text
  const outputText = useMemo(() => {
    if (typeof output === 'string') return output;
    if (output && typeof output === 'object') {
      const rec = output as Record<string, unknown>;
      if (typeof rec.output === 'string') return rec.output;
      if (typeof rec.stdout === 'string') return rec.stdout;
      if (typeof rec.content === 'string') return rec.content;
      return JSON.stringify(output, null, 2);
    }
    return '';
  }, [output]);

  const handleCopy = async () => {
    const textToCopy = displayCommand + (outputText ? `\n\n${outputText}` : '');
    await Clipboard.setStringAsync(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusColor =
    status === 'completed'
      ? theme.colors.success
      : status === 'failed'
        ? theme.colors.danger
        : theme.colors.warning;

  return (
    <Animated.View
      layout={listLayout()}
      style={[
        styles.container,
        {
          backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
          borderColor: theme.colors.border,
        },
      ]}>
      {/* Header bar */}
      <PressableScale
        onPress={() => setExpanded((prev) => !prev)}
        style={[
          styles.header,
          { borderBottomColor: expanded ? theme.colors.border : 'transparent' },
        ]}>
        <View style={styles.headerLeft}>
          <View style={[styles.statusIconBox, { backgroundColor: `${statusColor}18` }]}>
            {status === 'running' ? (
              <Loader2 size={13} color={statusColor} />
            ) : status === 'completed' ? (
              <CheckCircle2 size={13} color={statusColor} />
            ) : (
              <AlertCircle size={13} color={statusColor} />
            )}
          </View>
          <View style={styles.titleColumn}>
            <View style={styles.titleRow}>
              <Terminal size={13} color={theme.colors.textMuted} style={styles.terminalIcon} />
              <Text variant="caption" color={theme.colors.text} style={styles.toolBadge}>
                {toolName}
              </Text>
            </View>
            {displayCommand ? (
              <Text
                variant="caption"
                color={theme.colors.textMuted}
                numberOfLines={1}
                ellipsizeMode="tail"
                style={styles.commandPreview}>
                {displayCommand}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.headerRight}>
          <PressableScale
            onPress={handleCopy}
            accessibilityLabel={t`Copy command and output`}
            style={styles.actionButton}>
            {copied ? (
              <Check size={14} color={theme.colors.success} />
            ) : (
              <Copy size={14} color={theme.colors.textMuted} />
            )}
          </PressableScale>
          <View style={styles.chevronBox}>
            {expanded ? (
              <ChevronDown size={16} color={theme.colors.textMuted} />
            ) : (
              <ChevronRight size={16} color={theme.colors.textMuted} />
            )}
          </View>
        </View>
      </PressableScale>

      {/* Terminal Body */}
      {expanded ? (
        <Animated.View entering={fadeIn()} exiting={fadeOut()} style={styles.terminalWindow}>
          {displayCommand ? (
            <View style={[styles.commandLineRow, { backgroundColor: `${theme.colors.surface}80` }]}>
              <Text style={[styles.promptPrefix, { color: theme.colors.primary }]}>$ </Text>
              <Text selectable style={[styles.codeText, { color: theme.colors.text }]}>
                {displayCommand}
              </Text>
            </View>
          ) : null}

          {outputText ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.outputScroll}
              contentContainerStyle={styles.outputContent}>
              <Text selectable style={[styles.codeText, { color: theme.colors.textMuted }]}>
                {outputText}
              </Text>
            </ScrollView>
          ) : status === 'running' ? (
            <View style={styles.loadingRow}>
              <Text variant="caption" color={theme.colors.textMuted} style={styles.runningText}>
                <Trans>Running command in background…</Trans>
              </Text>
            </View>
          ) : null}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginVertical: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  statusIconBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleColumn: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  terminalIcon: {
    marginRight: 2,
  },
  toolBadge: {
    fontWeight: '600',
    fontSize: 12,
  },
  commandPreview: {
    fontFamily: 'monospace',
    fontSize: 11,
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionButton: {
    padding: 6,
  },
  chevronBox: {
    padding: 4,
  },
  terminalWindow: {
    padding: 8,
    fontFamily: 'monospace',
  },
  commandLineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 4,
    padding: 6,
    marginBottom: 6,
  },
  promptPrefix: {
    fontFamily: 'monospace',
    fontWeight: '700',
    fontSize: 12,
    lineHeight: 16,
  },
  outputScroll: {
    maxHeight: 260,
  },
  outputContent: {
    paddingVertical: 4,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 11.5,
    lineHeight: 16,
  },
  loadingRow: {
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  runningText: {
    fontStyle: 'italic',
    fontSize: 11,
  },
});

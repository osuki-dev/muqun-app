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

interface ParsedToolOutput {
  stdout: string;
  exitCode?: number;
}

function parseToolOutput(raw: unknown): ParsedToolOutput {
  if (!raw) return { stdout: '' };

  let data: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
      (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      try {
        data = JSON.parse(trimmed);
      } catch {
        // Keep as raw string
      }
    }
  }

  // If data is array (OpenCode's standard tool output: [{"text": "...", "type": "text"}, {"text": "Command exited with code 0.", "type": "text"}])
  if (Array.isArray(data)) {
    let stdout = '';
    let exitCode: number | undefined;

    for (const item of data) {
      const text =
        typeof item === 'object' && item && 'text' in item
          ? String((item as { text: unknown }).text)
          : typeof item === 'string'
            ? item
            : '';

      const exitMatch = text.match(/Command exited with code (\d+)/i);
      if (exitMatch) {
        exitCode = parseInt(exitMatch[1], 10);
      } else if (!stdout) {
        // First text content is command stdout!
        stdout = text;
      } else {
        stdout += `\n${text}`;
      }
    }

    return {
      stdout: stdout || (data.length > 0 ? JSON.stringify(data, null, 2) : ''),
      exitCode,
    };
  }

  if (typeof data === 'object' && data !== null) {
    const rec = data as Record<string, unknown>;
    if (typeof rec.stdout === 'string') {
      return {
        stdout: rec.stdout,
        exitCode: typeof rec.exitCode === 'number' ? rec.exitCode : undefined,
      };
    }
    if (typeof rec.output === 'string') return parseToolOutput(rec.output);
    if (Array.isArray(rec.content)) return parseToolOutput(rec.content);
    if (typeof rec.text === 'string') return { stdout: rec.text };
    return { stdout: JSON.stringify(data, null, 2) };
  }

  return { stdout: String(data) };
}

export const EmbeddedTerminalToolBlock = memo(function EmbeddedTerminalToolBlock({
  toolName,
  command,
  input,
  output,
  status,
  defaultExpanded = false,
}: EmbeddedTerminalProps) {
  const theme = useThemeTokens();
  const { t } = useLingui();
  const surfaceBackground = useSurfaceBackground();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [copied, setCopied] = useState(false);

  const isMcpTool = useMemo(() => {
    const lower = toolName.toLowerCase();
    return (
      lower.includes('_') ||
      lower.startsWith('mcp') ||
      lower.includes('chrome') ||
      lower.includes('playwright') ||
      lower.includes('gitea')
    );
  }, [toolName]);

  // Extract display command or file path
  const displayCommand = useMemo(() => {
    if (command) return command;
    if (typeof input === 'string') return input;
    if (input && typeof input === 'object') {
      const rec = input as Record<string, unknown>;
      if (typeof rec.command === 'string') return rec.command;
      if (typeof rec.cmd === 'string') return rec.cmd;
      if (typeof rec.path === 'string') return rec.path;
      if (typeof rec.filePath === 'string') return rec.filePath;
      if (typeof rec.file === 'string') return rec.file;
      if (typeof rec.query === 'string') return rec.query;
      return JSON.stringify(input, null, 2);
    }
    return '';
  }, [command, input]);

  // Extract output text and unwrap structured JSON wrappers
  const parsedOutput = useMemo(() => {
    return parseToolOutput(output);
  }, [output]);

  const outputText = parsedOutput.stdout;
  const exitCode = parsedOutput.exitCode;

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
          backgroundColor: surfaceBackground(theme.colors.surface),
          borderColor: theme.colors.border,
        },
      ]}>
      {/* Header bar: minimal, softened, no long command dump */}
      <PressableScale
        onPress={() => setExpanded((prev) => !prev)}
        style={[
          styles.header,
          { borderBottomColor: expanded ? theme.colors.border : 'transparent' },
        ]}>
        <View style={styles.headerLeft}>
          <Terminal size={13} color={theme.colors.textMuted} style={styles.terminalIcon} />
          <Text variant="caption" weight="medium" color={theme.colors.text} style={styles.toolBadge}>
            {toolName}
          </Text>
          {isMcpTool ? (
            <View style={[styles.mcpBadge, { backgroundColor: `${theme.colors.primary}18` }]}>
              <Text
                variant="caption"
                weight="semibold"
                color={theme.colors.primary}
                style={styles.mcpBadgeText}>
                MCP
              </Text>
            </View>
          ) : null}
          {status === 'running' ? (
            <Loader2 size={11} color={statusColor} />
          ) : status === 'failed' ? (
            <AlertCircle size={11} color={statusColor} />
          ) : null}
        </View>

        <View style={styles.headerRight}>
          {exitCode !== undefined ? (
            <View
              style={[
                styles.exitCodeBadge,
                {
                  backgroundColor:
                    exitCode === 0
                      ? `${theme.colors.success ?? '#22c55e'}18`
                      : `${theme.colors.danger}18`,
                },
              ]}>
              <Text
                variant="caption"
                weight="bold"
                color={exitCode === 0 ? (theme.colors.success ?? '#22c55e') : theme.colors.danger}
                style={styles.exitCodeText}>
                {`exit ${exitCode}`}
              </Text>
            </View>
          ) : null}

          {expanded ? (
            <PressableScale
              onPress={handleCopy}
              accessibilityLabel={t`Copy command and output`}
              style={styles.actionButton}>
              {copied ? (
                <Check size={13} color={theme.colors.success} />
              ) : (
                <Copy size={13} color={theme.colors.textMuted} />
              )}
            </PressableScale>
          ) : null}

          <View style={styles.chevronBox}>
            {expanded ? (
              <ChevronDown size={13} color={theme.colors.textMuted} />
            ) : (
              <ChevronRight size={13} color={theme.colors.textMuted} />
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
    borderRadius: 12,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginVertical: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 6,
  },
  statusIconBox: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderCurve: 'continuous',
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
  mcpBadge: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  exitCodeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  exitCodeText: {
    fontSize: 10.5,
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
    borderRadius: 8,
    borderCurve: 'continuous',
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
  mcpBadgeText: {
    fontSize: 9,
    letterSpacing: 0.5,
  },
});

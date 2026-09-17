import {
  createElement,
  memo,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import {
  AlertCircle,
  Braces,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileDiff,
  FilePen,
  FilePlus,
  FileText,
  Globe,
  GitFork,
  ListChecks,
  MonitorSmartphone,
  Regex,
  Search,
  Sparkles,
  Terminal,
  Wrench,
} from 'lucide-react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { ThinkingIndicator } from '@/components/agent-thinking-indicator';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { useTranscriptPlate } from '@/hooks/use-transcript-plate';
import { fadeIn, fadeOut, timing } from '@/lib/motion';
import type { ToolCallState } from '@/lib/agent-protocol';
import type { ToolKind } from '@/lib/agent-tool-output';

/**
 * The shell every tool call is drawn in.
 *
 * One header -- icon, name, target, state, duration, badges -- one row of chips
 * and actions, and one expandable body that the caller fills with whatever that
 * particular tool is worth showing. `agent-tool-card.tsx` owns the bodies; this
 * file owns the frame, so a shell, an edit and an MCP call cannot drift into
 * three different headers.
 */

/** Static icon per tool family — component references resolve to fixed imports. */
const TOOL_ICONS: Record<ToolKind, ComponentType<{ size?: number; color?: string }>> = {
  shell: Terminal,
  read: FileText,
  edit: FilePen,
  write: FilePlus,
  patch: FileDiff,
  glob: Search,
  grep: Regex,
  search: Search,
  web: Globe,
  subagent: GitFork,
  skill: Sparkles,
  todo: ListChecks,
  question: CircleHelp,
  execute: Braces,
  browser: MonitorSmartphone,
  mcp: Wrench,
};

export interface EmbeddedTerminalProps {
  /** The tool's own name, shown as it came. */
  toolName: string;
  kind: ToolKind;
  /** The one line that says what this call is pointed at. */
  title?: string;
  /** A second, quieter line: the rest of a path, a working directory, a query. */
  caption?: string;
  status: ToolCallState;
  /** `time.completed - time.ran`, when the engine reported both. */
  durationMs?: number;
  /** The reader is looking at a clipped result. */
  truncated?: boolean;
  /** OpenCode's own message, shown as it came, on a failed call. */
  error?: string;
  /** Detached by `POST …/background`; the card says so and stays quiet. */
  background?: boolean;
  /** Counts, exit codes, `+N lines`: small facts that fit on one line. */
  chips?: ReactNode;
  /** Buttons: run in background, open the child session. */
  actions?: ReactNode;
  /** Drawn above the fold, whether or not the card is expanded. */
  preview?: ReactNode;
  /** Drawn when the card is expanded. */
  children?: ReactNode;
  defaultExpanded?: boolean;
  testID?: string;
}

/** Whether the tool is still doing something, in any of the three ways it can be. */
export function isToolPending(status: ToolCallState): boolean {
  return status === 'pending' || status === 'streaming' || status === 'running';
}

/** `1.2s`, `340ms`, `2m 04s`: short enough to sit in a header. */
export function formatToolDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export const EmbeddedTerminalToolBlock = memo(function EmbeddedTerminalToolBlock({
  toolName,
  kind,
  title,
  caption,
  status,
  durationMs,
  truncated,
  error,
  background,
  chips,
  actions,
  preview,
  children,
  defaultExpanded = false,
  testID,
}: EmbeddedTerminalProps) {
  const theme = useThemeTokens();
  const colors = usePaneChatColors();
  const { t } = useLingui();
  const raised = useTranscriptPlate();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const pending = isToolPending(status);
  const failed = status === 'failed';
  const statusColor = failed
    ? theme.colors.danger
    : pending
      ? theme.colors.warning
      : theme.colors.success;

  const chevronProgress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    chevronProgress.value = withTiming(expanded ? 1 : 0, timing());
  }, [expanded, chevronProgress]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 90}deg` }],
  }));

  const hasBody = Boolean(children);

  return (
    <Animated.View style={[styles.container, raised]} testID={testID}>
      {/* Header: one line naming the tool and what it is pointed at */}
      <PressableScale
        testID="agent-tool-toggle"
        accessibilityRole="button"
        accessibilityState={{ expanded, busy: pending }}
        accessibilityLabel={expanded ? t`Collapse tool call` : t`Expand tool call`}
        disabled={!hasBody}
        onPress={() => setExpanded((prev) => !prev)}
        style={styles.header}>
        <View style={styles.headerIcon}>
          {createElement(TOOL_ICONS[kind], { size: 13, color: theme.colors.textMuted })}
        </View>
        <View style={styles.headerText}>
          <View style={styles.headerLine}>
            <Text
              variant="caption"
              weight="semibold"
              color={theme.colors.text}
              style={styles.toolName}>
              {toolName}
            </Text>
            {title ? (
              <Text
                variant="caption"
                numberOfLines={1}
                color={theme.colors.textMuted}
                style={styles.target}>
                {title}
              </Text>
            ) : null}
          </View>
          {caption ? (
            <Text
              variant="caption"
              numberOfLines={1}
              ellipsizeMode="head"
              color={theme.colors.textSubtle}
              style={styles.caption}>
              {caption}
            </Text>
          ) : null}
        </View>
        {/* A soft pulse rather than a spinner: a tool that is thinking reads
            the same way the assistant does while it thinks. */}
        {pending ? (
          <ThinkingIndicator size={12} color={statusColor} />
        ) : failed ? (
          <AlertCircle size={12} color={statusColor} />
        ) : durationMs !== undefined ? (
          <Text variant="caption" color={theme.colors.textSubtle} style={styles.duration}>
            {formatToolDuration(durationMs)}
          </Text>
        ) : null}
        {hasBody ? (
          <Animated.View entering={fadeIn('micro')} style={chevronStyle}>
            {expanded ? (
              <ChevronDown size={12} color={theme.colors.textMuted} />
            ) : (
              <ChevronRight size={12} color={theme.colors.textMuted} />
            )}
          </Animated.View>
        ) : null}
      </PressableScale>

      {chips || truncated || background ? (
        <View style={styles.chipRow}>
          {chips}
          {background ? (
            <View style={[styles.badge, { borderColor: colors.accent }]}>
              <Text variant="caption" color={colors.accent} style={styles.badgeText}>
                {t`Background`}
              </Text>
            </View>
          ) : null}
          {truncated ? (
            <View style={[styles.badge, { borderColor: theme.colors.warning }]}>
              <Text variant="caption" color={theme.colors.warning} style={styles.badgeText}>
                {t`Truncated`}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* OpenCode's own message, said as it was said. */}
      {failed && error ? (
        <Text variant="caption" selectable color={theme.colors.danger} style={styles.errorText}>
          {error}
        </Text>
      ) : null}

      {preview}

      {actions ? <View style={styles.actionRow}>{actions}</View> : null}

      {expanded && hasBody ? (
        <Animated.View
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          style={[styles.body, { borderLeftColor: theme.colors.border }]}>
          {children}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  container: {
    // A card is a row: its header lays out with flex and its diff rows pan,
    // neither of which measures inside a shrink-to-fit box.
    alignSelf: 'stretch',
    marginVertical: 2,
    paddingVertical: 7,
    paddingHorizontal: 9,
    gap: 5,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  headerIcon: {
    paddingTop: 1,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  headerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  toolName: {
    fontSize: 11.5,
  },
  target: {
    fontFamily: 'monospace',
    fontSize: 11,
    flexShrink: 1,
  },
  caption: {
    fontFamily: 'monospace',
    fontSize: 10.5,
  },
  duration: {
    fontSize: 10.5,
    fontVariant: ['tabular-nums'],
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 1,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 11,
    lineHeight: 16,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  body: {
    marginLeft: 4,
    paddingLeft: 8,
    borderLeftWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
});

import {
  createElement,
  memo,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { View, StyleSheet, useWindowDimensions } from 'react-native';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { useLingui } from '@lingui/react/macro';
import {
  AlertCircle,
  Braces,
  ChevronDown,
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

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { PressableScale } from '@/components/pressable-scale';
import { EngineFailureText } from '@/components/engine-failure-text';
import { ThinkingIndicator } from '@/components/agent-thinking-indicator';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { useTranscriptPlate } from '@/hooks/use-transcript-plate';
import { PAD_LAYOUT_MIN_WIDTH } from '@/lib/responsive-layout';
import { TRANSCRIPT_GRID } from '@/constants/transcript-grid';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { fadeIn, timing } from '@/lib/motion';
import type { ToolCallState } from '@/lib/agent-protocol';
import type { ToolKind } from '@/lib/agent-tool-output';
import { formatToolDuration } from '@/lib/tool-call-detail';
import { AGENT_TYPE } from '@/constants/agent-type';

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
  /** Ordinary calls use a quiet log row; the whole header toggles inline. */
  compactSummary?: boolean;
  /** A delegated task keeps its real child state and session entry visible. */
  taskSummary?: {
    title: string;
    identity: string;
    status: ReactNode;
    statusLabel: string;
    busy: boolean;
  };
  /**
   * The whole call in its own sheet. When given, the header opens it and the
   * chevron alone expands rich cards in place. Compact calls keep this entry
   * inside their expanded content instead.
   */
  onOpenDetail?: () => void;
  testID?: string;
}

/** Whether the tool is still doing something, in any of the three ways it can be. */
export function isToolPending(status: ToolCallState): boolean {
  return status === 'pending' || status === 'streaming' || status === 'running';
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
  compactSummary = false,
  taskSummary,
  onOpenDetail,
  testID,
}: EmbeddedTerminalProps) {
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const colors = usePaneChatColors();
  const { t } = useLingui();
  const raised = useTranscriptPlate();
  const mono = useMonoFontFamily();
  const { width } = useWindowDimensions();
  const compact = width < PAD_LAYOUT_MIN_WIDTH;
  const [expanded, setExpanded] = useState(defaultExpanded);

  const pending = isToolPending(status);
  const failed = status === 'failed';
  const statusColor = failed
    ? theme.colors.danger
    : pending
      ? theme.colors.warning
      : theme.colors.success;

  // Closed points down, open points up, everywhere in the transcript. It used
  // to swap a right-chevron for a down-chevron *and* rotate the result 90
  // degrees, so an open card pointed left.
  const chevronProgress = useSharedValue(expanded ? 1 : 0);
  useEffect(() => {
    chevronProgress.set(withTiming(expanded ? 1 : 0, timing()));
  }, [expanded, chevronProgress]);
  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${chevronProgress.value * 180}deg` }],
  }));

  const inlineSummary = compactSummary || Boolean(taskSummary);
  const hasBody =
    Boolean(children) ||
    (inlineSummary && Boolean(title || caption || error || chips || preview || onOpenDetail));
  const headerOpensDetail = Boolean(onOpenDetail) && !inlineSummary;
  const showDetails = !inlineSummary || expanded;
  const headerActionLabel = headerOpensDetail
    ? t`Open tool call details`
    : expanded
      ? t`Collapse tool call`
      : t`Expand tool call`;
  const headerBusy = taskSummary ? taskSummary.busy : pending;

  return (
    <Animated.View
      style={[styles.container, compactSummary && !expanded ? styles.collapsedContainer : raised]}
      testID={testID}
      // A screen reader hears the call, not the engine's id for it.
      accessibilityLabel={[title, caption].filter(Boolean).join(' ') || undefined}>
      {/* Keep controls on the first line; narrow-screen paths get the full card width. */}
      <PressableScale
        testID={headerOpensDetail ? 'agent-tool-open-detail' : 'agent-tool-toggle'}
        accessibilityRole="button"
        accessibilityState={
          headerOpensDetail ? { busy: headerBusy } : { expanded, busy: headerBusy }
        }
        accessibilityLabel={[
          taskSummary ? taskSummary.title : toolName,
          taskSummary
            ? taskSummary.statusLabel
            : durationMs !== undefined
              ? formatToolDuration(durationMs)
              : '',
          headerActionLabel,
        ]
          .filter(Boolean)
          .join(' · ')}
        disabled={!hasBody && !headerOpensDetail}
        onPress={headerOpensDetail ? onOpenDetail : () => setExpanded((prev) => !prev)}
        style={[styles.header, compactSummary && !expanded && styles.summaryHeader]}>
        {taskSummary ? (
          <View style={styles.headerRow}>
            <View style={styles.headerIcon}>
              <GitFork size={13} color={theme.colors.textMuted} />
            </View>
            <Text variant="caption" weight="semibold" style={styles.taskTitle}>
              {taskSummary.title}
            </Text>
            <View style={styles.taskStatus}>{taskSummary.status}</View>
            {hasBody ? (
              <Animated.View style={chevronStyle}>
                <ChevronDown size={12} color={theme.colors.textMuted} />
              </Animated.View>
            ) : null}
          </View>
        ) : (
          <View style={styles.headerRow}>
            <View style={styles.headerIcon}>
              {createElement(TOOL_ICONS[kind], { size: 13, color: theme.colors.textMuted })}
            </View>
            <View style={[styles.headerText, compactSummary && !expanded && styles.summaryText]}>
              <View style={styles.headerLine}>
                <Text
                  variant="caption"
                  weight="semibold"
                  numberOfLines={1}
                  color={compactSummary && !expanded ? theme.colors.textMuted : theme.colors.text}
                  style={styles.toolName}>
                  {toolName}
                </Text>
                {!compactSummary && !compact && title ? (
                  <Text
                    variant="caption"
                    numberOfLines={1}
                    // A long file name keeps its start and its extension; the
                    // caption under it carries the folder rather than the name
                    // again.
                    ellipsizeMode="middle"
                    color={theme.colors.textMuted}
                    style={[styles.target, { fontFamily: mono }]}>
                    {title}
                  </Text>
                ) : null}
              </View>
              {!compactSummary && !compact && caption ? (
                <Text
                  variant="caption"
                  numberOfLines={1}
                  ellipsizeMode="head"
                  color={theme.colors.textSubtle}
                  style={[styles.caption, { fontFamily: mono }]}>
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
            ) : null}
            {durationMs !== undefined ? (
              <Text variant="caption" color={theme.colors.textSubtle} style={styles.duration}>
                {formatToolDuration(durationMs)}
              </Text>
            ) : null}
            {hasBody && headerOpensDetail ? (
              <PressableScale
                testID="agent-tool-toggle"
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={expanded ? t`Collapse tool call` : t`Expand tool call`}
                hitSlop={12}
                onPress={() => setExpanded((prev) => !prev)}>
                <Animated.View entering={fadeIn('micro')} style={chevronStyle}>
                  <ChevronDown size={12} color={theme.colors.textMuted} />
                </Animated.View>
              </PressableScale>
            ) : hasBody ? (
              <Animated.View entering={fadeIn('micro')} style={chevronStyle}>
                <ChevronDown size={12} color={theme.colors.textMuted} />
              </Animated.View>
            ) : null}
          </View>
        )}
        {showDetails && !taskSummary && (compact || compactSummary) && (title || caption) ? (
          <View style={styles.compactHeaderCopy}>
            {title ? (
              <Text
                variant="caption"
                numberOfLines={2}
                ellipsizeMode="middle"
                color={theme.colors.textMuted}
                style={[styles.target, { fontFamily: mono }]}>
                {title}
              </Text>
            ) : null}
            {caption ? (
              <Text
                variant="caption"
                numberOfLines={2}
                ellipsizeMode="head"
                color={theme.colors.textSubtle}
                style={[styles.caption, { fontFamily: mono }]}>
                {caption}
              </Text>
            ) : null}
          </View>
        ) : null}
      </PressableScale>

      {(showDetails && (chips || truncated || background)) || (background && !taskSummary) ? (
        <View style={[styles.chipRow, styles.underTitle]}>
          {showDetails ? chips : null}
          {background ? (
            <View
              style={[
                styles.badge,
                { borderRadius: profile.chrome.control, borderColor: colors.accent },
              ]}>
              <Text variant="caption" color={colors.accent} style={styles.badgeText}>
                {t`Background`}
              </Text>
            </View>
          ) : null}
          {showDetails && truncated ? (
            <View
              style={[
                styles.badge,
                { borderRadius: profile.chrome.control, borderColor: theme.colors.warning },
              ]}>
              <Text variant="caption" color={theme.colors.warning} style={styles.badgeText}>
                {t`Truncated`}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* OpenCode's own message, said as it was said: one line when it is a
          sentence, markdown when it arrived as a small document. */}
      {showDetails && failed && error ? (
        <View style={styles.underTitle}>
          <EngineFailureText message={error} />
        </View>
      ) : null}

      {showDetails && preview ? (
        // Code, images and streaming arguments use the full content width.
        <View>{preview}</View>
      ) : null}

      {taskSummary ? (
        <View style={[styles.taskIdentityRow, styles.underTitle]}>
          {taskSummary.identity ? (
            <Text variant="caption" color={theme.colors.textSubtle} style={styles.taskIdentity}>
              {taskSummary.identity}
            </Text>
          ) : null}
          {actions}
        </View>
      ) : actions ? (
        <View style={[styles.actionRow, styles.underTitle]}>{actions}</View>
      ) : null}

      {inlineSummary && expanded && onOpenDetail ? (
        <PressableScale
          testID="agent-tool-open-detail"
          accessibilityRole="button"
          accessibilityLabel={t`Open tool call details`}
          onPress={onOpenDetail}
          style={styles.underTitle}>
          <Text variant="caption" color={colors.accent}>
            {t`Open tool call details`}
          </Text>
        </PressableScale>
      ) : null}

      {expanded && hasBody ? (
        // Fades in, and leaves without an exit -- as the thought block's body
        // does, which is why that one never flickered and this one did. An
        // exiting view is lifted out of the layout while it fades, so the row
        // collapsed to its header at once with the old body still painted over
        // the rows below it; inside a virtualised list that also re-measures
        // the row twice. The collapse is the row getting shorter, which the
        // list already animates the neighbours for.
        <Animated.View
          entering={fadeIn('micro')}
          style={[styles.body, { borderTopColor: theme.colors.border }]}>
          {children}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
});

/** The icon column, and the gap after it: what the title is indented by. */
const ICON_COLUMN = TRANSCRIPT_GRID.markerWidth;
const HEADER_GAP = TRANSCRIPT_GRID.markerGap;

const styles = StyleSheet.create({
  container: {
    // A card is a row: its header lays out with flex and its diff rows pan,
    // neither of which measures inside a shrink-to-fit box.
    alignSelf: 'stretch',
    paddingVertical: 8,
    paddingHorizontal: TRANSCRIPT_GRID.inset,
    gap: TRANSCRIPT_GRID.attachGap,
  },
  header: { gap: 4 },
  collapsedContainer: {
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  summaryHeader: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingVertical: 5,
    paddingHorizontal: TRANSCRIPT_GRID.inset,
  },
  summaryText: {
    flex: 0,
    flexShrink: 1,
  },
  taskTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: AGENT_TYPE.meta.size,
  },
  taskStatus: {
    maxWidth: '40%',
  },
  taskIdentityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  taskIdentity: {
    flexShrink: 1,
    fontSize: AGENT_TYPE.micro.size,
  },
  compactHeaderCopy: { gap: 1 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: HEADER_GAP,
  },
  headerIcon: {
    paddingTop: 1,
    width: ICON_COLUMN,
    alignItems: 'center',
  },
  /**
   * The column the title starts in.
   *
   * The exit chip, the result count and the error line all began at
   * the card's outer edge while the title was indented past the icon, so every
   * fact about a call hung left of the call it was about.
   */
  underTitle: {
    marginLeft: ICON_COLUMN + HEADER_GAP,
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
    fontSize: AGENT_TYPE.meta.size,
    flexShrink: 1,
  },
  // The target is the file or the command the call is pointed at, and the
  // caption under it is the folder it sits in: two literals, read the way a
  // path is read, so both follow the mono slot. They used to name the literal
  // `'monospace'`, which on iOS is not a family React Native can resolve at
  // all and on Android is the platform's generic -- either way, never the face
  // the reader installed. The family is merged in at the render site, because
  // a `StyleSheet.create` object cannot call a hook.
  target: {
    fontSize: AGENT_TYPE.micro.size,
    flexShrink: 1,
  },
  caption: {
    fontSize: AGENT_TYPE.micro.size,
  },
  duration: {
    flexShrink: 0,
    fontSize: AGENT_TYPE.micro.size,
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
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  badgeText: {
    fontSize: AGENT_TYPE.micro.size,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  body: {
    // Expanded documents use the full card width, not the header icon column.
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
});

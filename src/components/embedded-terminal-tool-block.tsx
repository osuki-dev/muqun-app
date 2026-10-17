import {
  createElement,
  memo,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { View, StyleSheet, type ViewInstance } from 'react-native';
import { useThemeTokens, PressableScale, Text } from '@osuki-dev/ui';
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
import { EngineFailureText } from '@/components/engine-failure-text';
import { ThinkingIndicator } from '@/components/agent-thinking-indicator';
import { usePaneChatColors } from '@/components/pane-chat-blocks';
import { useTranscriptPlate } from '@/hooks/use-transcript-plate';
import { TRANSCRIPT_GRID } from '@/constants/transcript-grid';
import { useMonoFontFamily } from '@/hooks/use-user-fonts';
import { fadeIn, timing } from '@/lib/motion';
import type { ToolCallState } from '@/lib/agent-protocol';
import type { ToolKind } from '@/lib/agent-tool-output';
import { formatToolDuration } from '@/lib/tool-call-detail';
import { AGENT_TYPE } from '@/constants/agent-type';
import { withAlpha } from '@/lib/color';

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
  /** Rich output or streaming arguments, mounted only after disclosure. */
  preview?: ReactNode;
  /** Drawn when the card is expanded. */
  children?: ReactNode;
  defaultExpanded?: boolean;
  /** Only explicit opening creates an intent; body layout completes it once. */
  onExpand?: (header: ViewInstance) => ToolExpansionIntent | undefined;
  /** A delegated task keeps its real child state visible; identity and actions expand. */
  taskSummary?: {
    title: string;
    identity: string;
    role?: string;
    status: ReactNode;
    statusLabel: string;
    busy: boolean;
  };
  /**
   * The whole call in its own sheet, offered inside the expanded content.
   * The header always toggles the inline body.
   */
  onOpenDetail?: () => void;
  testID?: string;
}

export interface ToolExpansionIntent {
  layout: () => void;
  cancel: () => void;
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
  onExpand,
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
  const [expanded, setExpanded] = useState(defaultExpanded);
  const headerRef = useRef<ViewInstance>(null);
  const expansionIntent = useRef<ToolExpansionIntent | undefined>(undefined);
  useEffect(() => () => expansionIntent.current?.cancel(), []);

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
    transform: [{ rotate: `${chevronProgress.get() * 180}deg` }],
  }));

  const hasBody =
    Boolean(children || actions || title || caption || error || chips || preview || onOpenDetail) ||
    Boolean(taskSummary && (taskSummary.title || taskSummary.identity || actions)) ||
    Boolean(truncated || background);
  const headerActionLabel = expanded ? t`Collapse tool call` : t`Expand tool call`;
  const headerBusy = taskSummary ? taskSummary.busy : pending;
  const headerCopy =
    !taskSummary && (title || caption) ? (
      <>
        {title ? (
          <Text
            variant="caption"
            color={theme.colors.textMuted}
            style={[styles.target, { fontFamily: mono }]}>
            {title}
          </Text>
        ) : null}
        {caption ? (
          <Text
            variant="caption"
            color={theme.colors.textSubtle}
            style={[styles.caption, { fontFamily: mono }]}>
            {caption}
          </Text>
        ) : null}
      </>
    ) : null;
  const detailAction = onOpenDetail ? (
    <PressableScale
      testID="agent-tool-open-detail"
      accessibilityRole="button"
      accessibilityLabel={t`Open tool call details`}
      onPress={onOpenDetail}
      style={styles.detailAction}>
      <Text variant="caption" color={colors.accent} style={styles.detailActionText}>
        {t`Details`}
      </Text>
    </PressableScale>
  ) : null;
  const taskIdentity =
    taskSummary?.identity && taskSummary.identity !== taskSummary.title ? taskSummary.identity : '';
  const hasMetadata = Boolean(
    headerCopy ||
    chips ||
    truncated ||
    (taskSummary && (taskIdentity || taskSummary.role || background || actions || detailAction))
  );
  return (
    <Animated.View
      style={styles.container}
      testID={testID}
      // A screen reader hears the call, not the engine's id for it.
      accessibilityLabel={[title, caption].filter(Boolean).join(' ') || undefined}>
      {/* Keep controls on the first line; narrow-screen paths get the full card width. */}
      <PressableScale
        testID="agent-tool-toggle"
        accessibilityRole="button"
        accessibilityState={{ expanded, busy: headerBusy }}
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
        disabled={!hasBody}
        onPress={() => {
          expansionIntent.current?.cancel();
          expansionIntent.current =
            !expanded && headerRef.current ? onExpand?.(headerRef.current) : undefined;
          setExpanded(!expanded);
        }}
        style={styles.header}>
        <View
          ref={headerRef}
          collapsable={false}
          style={[
            styles.headerPill,
            {
              borderRadius: profile.chrome.control,
              backgroundColor: withAlpha(theme.colors.primary, 0.08),
            },
          ]}>
          {taskSummary ? (
            <View style={styles.headerRow}>
              <View style={styles.headerIcon}>
                <GitFork size={13} color={theme.colors.textMuted} />
              </View>
              <Text
                variant="caption"
                weight="medium"
                numberOfLines={1}
                ellipsizeMode="tail"
                style={styles.taskTitle}>
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
              <Text
                variant="caption"
                weight="medium"
                numberOfLines={1}
                color={theme.colors.textMuted}
                style={styles.toolName}>
                {toolName}
              </Text>
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
              {background ? (
                <Text variant="caption" color={colors.accent} style={styles.badgeText}>
                  {t`Background`}
                </Text>
              ) : null}
              {hasBody ? (
                <Animated.View style={chevronStyle}>
                  <ChevronDown size={12} color={theme.colors.textMuted} />
                </Animated.View>
              ) : null}
            </View>
          )}
        </View>
      </PressableScale>

      {expanded && hasBody ? (
        <View style={[styles.details, raised]} onLayout={() => expansionIntent.current?.layout()}>
          {hasMetadata ? (
            <View style={styles.metadataRow}>
              {headerCopy}
              {taskIdentity ? (
                <Text variant="caption" color={theme.colors.textSubtle} style={styles.taskIdentity}>
                  {taskIdentity}
                </Text>
              ) : null}
              {taskSummary?.role ? (
                <Text variant="caption" color={theme.colors.textSubtle} style={styles.taskIdentity}>
                  {taskSummary.role}
                </Text>
              ) : null}
              {chips}
              {taskSummary && background ? (
                <Text variant="caption" color={colors.accent} style={styles.badgeText}>
                  {t`Background`}
                </Text>
              ) : null}
              {truncated ? (
                <Text variant="caption" color={theme.colors.warning} style={styles.badgeText}>
                  {t`Truncated`}
                </Text>
              ) : null}
              {taskSummary ? actions : null}
              {taskSummary ? detailAction : null}
            </View>
          ) : null}

          {/* OpenCode's own message, said as it was said: one line when it is a
          sentence, markdown when it arrived as a small document. */}
          {failed && error ? <EngineFailureText message={error} /> : null}

          {preview ? (
            // Code, images and streaming arguments use the full content width.
            <View>{preview}</View>
          ) : null}

          {children ? (
            // Fades in, and leaves without an exit -- as the thought block's body
            // does, which is why that one never flickered and this one did. An
            // exiting view is lifted out of the layout while it fades, so the row
            // collapsed to its header at once with the old body still painted over
            // the rows below it; inside a virtualised list that also re-measures
            // the row twice. The collapse is the row getting shorter, which the
            // list already animates the neighbours for.
            <Animated.View entering={fadeIn('micro')} style={styles.body}>
              {children}
            </Animated.View>
          ) : null}
          {!taskSummary && (actions || detailAction) ? (
            <View style={styles.metadataRow}>
              {actions}
              {detailAction}
            </View>
          ) : null}
        </View>
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
  },
  header: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    // Only the transparent touch boundary is 44dp, never the painted pill.
    // Each row owns its bounds; no hitSlop overlaps its neighbours or body.
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
  },
  headerPill: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingVertical: 5,
    paddingHorizontal: TRANSCRIPT_GRID.inset,
    borderCurve: 'continuous',
  },
  details: {
    gap: TRANSCRIPT_GRID.attachGap,
    // Only open bodies need extra separation after compact tool rows.
    marginBottom: TRANSCRIPT_GRID.rowGap / 2,
    paddingVertical: TRANSCRIPT_GRID.plateInsetY,
    paddingHorizontal: TRANSCRIPT_GRID.inset,
  },
  taskTitle: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: AGENT_TYPE.meta.size,
  },
  taskStatus: {
    flexShrink: 0,
  },
  metadataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 8,
    rowGap: 2,
  },
  taskIdentity: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
    fontSize: AGENT_TYPE.micro.size,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: HEADER_GAP,
  },
  headerIcon: {
    width: ICON_COLUMN,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolName: {
    fontSize: AGENT_TYPE.meta.size,
    flexShrink: 1,
    minWidth: 0,
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
    minWidth: 0,
    maxWidth: '100%',
  },
  caption: {
    fontSize: AGENT_TYPE.micro.size,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: '100%',
  },
  duration: {
    flexShrink: 0,
    fontSize: AGENT_TYPE.micro.size,
    fontVariant: ['tabular-nums'],
  },
  badgeText: {
    fontSize: AGENT_TYPE.micro.size,
    fontWeight: '600',
  },
  detailAction: {
    minHeight: 44,
    minWidth: 44,
    maxWidth: '100%',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  detailActionText: {
    fontSize: AGENT_TYPE.micro.size,
    fontWeight: '600',
  },
  body: {
    // Expanded documents use the full card width, not the header icon column.
    gap: 4,
  },
});

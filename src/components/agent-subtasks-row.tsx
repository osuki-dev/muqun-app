import { memo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Spinner, useThemeTokens } from '@osuki-dev/ui';
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { ChevronDown, ChevronUp, GitFork } from 'lucide-react-native';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { Text } from '@/components/text';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { agentSessionStatusWord } from '@/i18n/labels';
import { isBusyStatus, type AgentSessionInfo } from '@/lib/agent-protocol';
import { hasRealSessionTitle } from '@/lib/agent-session';
import {
  isSubtaskBlocked,
  type SubtaskBlocks,
  type SubtaskNode,
  type SubtaskSummary,
} from '@/lib/agent-subtasks';
import { agentSessionStatusPresentation } from '@/lib/home-continue';
import { fadeIn, fadeOut } from '@/lib/motion';
import { AGENT_TYPE } from '@/constants/agent-type';

/** Rows the expanded list draws before it hands over to the tree sheet. */
export const SUBTASK_ROWS_MAX = 6;

const INDENT = 12;

/**
 * The open session's subtasks, above the dock's toolbar.
 *
 * One line collapsed: whether anything below this session is still working,
 * or waiting on the reader. Tapped, the descendants themselves, each one a way
 * into that session.
 */
export const AgentSubtasksRow = memo(function AgentSubtasksRow({
  nodes,
  summary,
  blocks,
  leadOf,
  onOpenSession,
  onOpenTree,
}: {
  nodes: readonly SubtaskNode[];
  summary: SubtaskSummary;
  blocks: SubtaskBlocks;
  leadOf: (session: AgentSessionInfo) => string | undefined;
  onOpenSession: (asid: string) => void;
  onOpenTree?: () => void;
}) {
  const { t, i18n } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  const [expanded, setExpanded] = useState(false);

  const { total, running, blocked } = summary;
  const label =
    summary.kind === 'blocked'
      ? t`Subtasks · ${plural(blocked, { one: '# waiting for you', other: '# waiting for you' })}`
      : summary.kind === 'running'
        ? t`Subtasks · ${plural(running, { one: '# running', other: '# running' })}`
        : t`Subtasks · ${total}, all idle`;
  const shown = nodes.slice(0, SUBTASK_ROWS_MAX);
  const overflow = nodes.length > SUBTASK_ROWS_MAX && onOpenTree;

  return (
    <View
      testID="agent-subtasks-row"
      style={[
        styles.container,
        {
          borderRadius: profile.chrome.card,
          backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
          borderColor: surfaceBackground(theme.colors.border),
        },
      ]}>
      <PressableScale
        testID="agent-subtasks-toggle"
        onPress={() => setExpanded((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={label}
        style={styles.toggle}>
        <StatusMark kind={summary.kind} />
        <Text
          variant="caption"
          weight="medium"
          numberOfLines={1}
          color={summary.kind === 'blocked' ? theme.colors.warning : theme.colors.text}
          style={styles.label}>
          {label}
        </Text>
        {expanded ? (
          <ChevronUp size={14} color={theme.colors.textMuted} />
        ) : (
          <ChevronDown size={14} color={theme.colors.textMuted} />
        )}
      </PressableScale>
      {expanded ? (
        <Animated.View entering={fadeIn('micro')} exiting={fadeOut('micro')} style={styles.list}>
          {shown.map(({ session, depth }) => {
            const blocked = isSubtaskBlocked(blocks, session.asid);
            const presentation = agentSessionStatusPresentation(session.status);
            const status = blocked
              ? t`Waiting for you`
              : i18n._(agentSessionStatusWord[presentation.word]);
            const title = hasRealSessionTitle(session) ? session.title : t`Untitled session`;
            const lead = leadOf(session);
            return (
              <PressableScale
                key={session.asid}
                testID={`agent-subtask-${session.asid}`}
                onPress={() => {
                  setExpanded(false);
                  onOpenSession(session.asid);
                }}
                accessibilityRole="button"
                accessibilityLabel={lead ? `${lead}: ${title}, ${status}` : `${title}, ${status}`}
                style={[styles.item, { paddingLeft: 4 + (depth - 1) * INDENT }]}>
                <StatusMark
                  kind={blocked ? 'blocked' : isBusyStatus(session.status) ? 'running' : 'idle'}
                  tone={blocked ? undefined : theme.colors[presentation.tone]}
                />
                <Text
                  variant="caption"
                  numberOfLines={1}
                  color={hasRealSessionTitle(session) ? theme.colors.text : theme.colors.textMuted}
                  style={styles.itemTitle}>
                  {title}
                </Text>
                {lead ? (
                  <Text
                    variant="caption"
                    numberOfLines={1}
                    color={theme.colors.primary}
                    style={styles.itemMeta}>
                    {lead}
                  </Text>
                ) : null}
                <Text
                  variant="caption"
                  numberOfLines={1}
                  color={blocked ? theme.colors.warning : theme.colors[presentation.tone]}
                  style={styles.itemMeta}>
                  {status}
                </Text>
              </PressableScale>
            );
          })}
          {overflow ? (
            <PressableScale
              testID="agent-subtasks-view-tree"
              onPress={() => {
                setExpanded(false);
                onOpenTree();
              }}
              accessibilityRole="button"
              style={styles.item}>
              <GitFork size={13} color={theme.colors.primary} />
              <Text variant="caption" weight="medium" color={theme.colors.primary}>
                <Trans>View tree</Trans>
              </Text>
            </PressableScale>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
});

/** A spinner while work is running, a still dot otherwise. */
function StatusMark({ kind, tone }: { kind: SubtaskSummary['kind']; tone?: string | undefined }) {
  const theme = useThemeTokens();
  if (kind === 'running') {
    return (
      <View style={styles.mark}>
        <Spinner size="sm" color={tone ?? theme.colors.primary} />
      </View>
    );
  }
  return (
    <View style={styles.mark}>
      <View
        style={[
          styles.dot,
          {
            backgroundColor:
              kind === 'blocked' ? theme.colors.warning : (tone ?? theme.colors.textSubtle),
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
    paddingHorizontal: 10,
  },
  label: {
    flex: 1,
    fontSize: AGENT_TYPE.meta.size,
  },
  list: {
    paddingHorizontal: 6,
    paddingBottom: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 30,
    paddingRight: 4,
  },
  itemTitle: {
    flex: 1,
    fontSize: AGENT_TYPE.meta.size,
  },
  itemMeta: {
    flexShrink: 0,
    maxWidth: 110,
    fontSize: AGENT_TYPE.meta.size,
  },
  mark: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
});

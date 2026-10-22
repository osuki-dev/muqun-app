import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { memo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { usePermissionOptions } from '@/components/agent-permission-card';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useHomeSessionReplies } from '@/components/home-session-replies';
import { permissionSubject } from '@/lib/agent-engine-text';
import type { FormRequest, PermissionRequest } from '@/lib/agent-protocol';
import { withAlpha } from '@/lib/color';
import { settleAfter } from '@/lib/compiler-safe-control-flow';
import { taskRowTitle } from '@/lib/home-computer-cards';
import type { HomeTaskRow } from '@/lib/home-in-progress';
import { agentDisplayName } from '@/lib/home-launch-model';
import type { HomeTarget } from '@/lib/home-recents';
import { stageSingleChoice, type StageNeed } from '@/lib/stage-overlay';
import { surfaceBackgroundFill, SHEET_FROST_ALPHA } from '@/theme/surface-background';
import { useAgents } from '@/stores/agents';

export type StageNeedActions = {
  /** Open a session's conversation (Needs you's own open path). */
  onOpenRequest: (target: HomeTarget) => void;
  /** Open where a waiting ledger task runs. */
  onOpenTask: (row: HomeTaskRow) => void;
  /** Open the computer at a terminal agent's pane, where it is answered. */
  onOpenPane: (paneId?: string) => void;
  /** "+N more": the Sessions list, with Needs you on top. */
  onOpenList: () => void;
};

/**
 * The one request waiting on the reader, floated over the art: who asks, what
 * for in two lines, and the answers the conversation itself offers -- allow
 * or deny a permission, pick a single choice -- beside View, which opens the
 * conversation. A terminal agent is answered in its terminal: Open only.
 * Nothing here decides anything the source would not: the replies are the
 * reply drawer's own (`useHomeSessionReplies`).
 */
export const StageNeedsCard = memo(function StageNeedsCard({
  serverId,
  need,
  more,
  terminal,
  actions,
}: {
  serverId: string;
  need: StageNeed;
  more: number;
  /** The conversation answers in its terminal: no answers from here. */
  terminal: boolean;
  actions: StageNeedActions;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const agents = useAgents((state) => state.index.servers[serverId]?.agents?.agents);
  const who = need.agentLabel ?? agentDisplayName(agents, need.agentId);
  return (
    <View
      testID="home-stage-needs"
      accessibilityLiveRegion="polite"
      style={[
        styles.card,
        {
          // Translucent over the art, never thinner than the sheets' frost floor.
          backgroundColor: surfaceBackgroundFill(theme.colors.surfaceRaised, SHEET_FROST_ALPHA),
          borderColor: withAlpha(theme.colors.warning, 0.45),
          borderRadius: profile.chrome.noticeCard,
        },
      ]}>
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: theme.colors.warning }]} />
        <Text
          variant="caption"
          weight="semibold"
          color={theme.colors.warning}
          numberOfLines={1}
          style={styles.who}>
          {who}
        </Text>
        {more > 0 ? (
          <PressableScale
            testID="home-stage-needs-more"
            accessibilityRole="button"
            accessibilityLabel={t`${plural(more, { one: '# more needs you', other: '# more need you' })}`}
            hitSlop={8}
            onPress={actions.onOpenList}>
            <Text variant="caption" weight="semibold" color={theme.colors.primary}>
              {t`+${more} more`}
            </Text>
          </PressableScale>
        ) : null}
      </View>
      <NeedBody serverId={serverId} need={need} terminal={terminal} actions={actions} />
    </View>
  );
});

function NeedBody({
  serverId,
  need,
  terminal,
  actions,
}: {
  serverId: string;
  need: StageNeed;
  terminal: boolean;
  actions: StageNeedActions;
}) {
  const { t } = useLingui();
  switch (need.kind) {
    case 'permission':
      return (
        <PermissionNeed
          request={need.request}
          target={need.target}
          onView={() => actions.onOpenRequest(need.target)}
        />
      );
    case 'question':
      return (
        <QuestionNeed
          form={need.form}
          target={need.target}
          answerable={!terminal}
          onView={() => actions.onOpenRequest(need.target)}
        />
      );
    case 'requests':
      return (
        <NeedLayout
          summary={t`${plural(need.count, { one: '# request waiting', other: '# requests waiting' })}`}
          open={{ label: t`View`, onPress: () => actions.onOpenRequest(need.target) }}
        />
      );
    case 'task':
      return (
        <NeedLayout
          summary={taskRowTitle(need.task) || t`Waiting for your input`}
          open={{
            label: need.task.binding.kind === 'pane' ? t`Open` : t`View`,
            onPress: () => actions.onOpenTask({ serverId, task: need.task }),
          }}
        />
      );
    case 'pane':
      return (
        <NeedLayout
          summary={t`Waiting for you in the terminal`}
          open={{ label: t`Open`, onPress: () => actions.onOpenPane(need.paneId) }}
        />
      );
  }
}

type SessionTarget = Extract<HomeTarget, { kind: 'agent-session' }>;

function PermissionNeed({
  request,
  target,
  onView,
}: {
  request: PermissionRequest;
  target: SessionTarget;
  onView: () => void;
}) {
  const { t } = useLingui();
  const { decide } = useHomeSessionReplies(target);
  const options = usePermissionOptions(request);
  const subject = permissionSubject(request);
  // Only the one-off answers: an "always" is a promise worth reading in full.
  const answers = [
    options.find((option) => option.decision === 'allow'),
    options.find((option) => option.decision === 'deny'),
  ].flatMap((option) =>
    option
      ? [
          {
            key: option.decision,
            label: option.label,
            tone: option.decision === 'deny' ? ('danger' as const) : ('primary' as const),
            run: () => decide(request.id, option.decision),
          },
        ]
      : []
  );
  return (
    <NeedLayout
      summary={subject ? t`Allow: ${subject}` : t`Permission required`}
      answers={answers}
      open={{ label: t`View`, onPress: onView }}
    />
  );
}

function QuestionNeed({
  form,
  target,
  answerable,
  onView,
}: {
  form: FormRequest;
  target: SessionTarget;
  answerable: boolean;
  onView: () => void;
}) {
  const { t } = useLingui();
  const { answer } = useHomeSessionReplies(target);
  const choice = answerable ? stageSingleChoice(form) : null;
  const answers =
    choice?.options.map((option) => ({
      key: option.value,
      label: option.label,
      tone: 'primary' as const,
      run: () => answer(form.id, { [choice.key]: option.value }),
    })) ?? [];
  return (
    <NeedLayout
      summary={form.title || form.fields[0]?.title || t`Needs your input`}
      answers={answers}
      open={{ label: answers.length > 0 ? t`View` : t`Answer`, onPress: onView }}
    />
  );
}

type Answer = {
  key: string;
  label: string;
  tone: 'primary' | 'danger';
  run: () => Promise<void>;
};

/** Two lines of what is asked, then the answers and the way into the source. */
function NeedLayout({
  summary,
  answers = [],
  open,
}: {
  summary: string;
  answers?: readonly Answer[];
  open: { label: string; onPress: () => void };
}) {
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  // One answer at a time: the rest wait until the gateway has taken it.
  const [sending, setSending] = useState<string | null>(null);
  const send = (answer: Answer) => {
    if (sending) return;
    setSending(answer.key);
    void settleAfter(answer.run, () => setSending(null));
  };
  return (
    <>
      <Text
        testID="home-stage-needs-summary"
        variant="bodySmall"
        weight="semibold"
        numberOfLines={2}>
        {summary}
      </Text>
      <View style={styles.actions}>
        {answers.map((answer, index) => {
          const color = answer.tone === 'danger' ? theme.colors.danger : theme.colors.primary;
          const filled = index === 0 && answer.tone === 'primary';
          return (
            <PressableScale
              key={answer.key}
              testID={`home-stage-needs-answer-${answer.key}`}
              accessibilityRole="button"
              accessibilityLabel={answer.label}
              accessibilityState={{ busy: sending === answer.key, disabled: sending !== null }}
              disabled={sending !== null}
              onPress={() => send(answer)}
              style={[
                styles.button,
                { borderRadius: profile.chrome.control },
                filled
                  ? { backgroundColor: color }
                  : { backgroundColor: withAlpha(color, 0.1), borderColor: color },
              ]}>
              {sending === answer.key ? (
                <ActivityIndicator size="small" color={filled ? theme.colors.onPrimary : color} />
              ) : (
                <Text
                  variant="caption"
                  weight="semibold"
                  numberOfLines={1}
                  color={filled ? theme.colors.onPrimary : color}>
                  {answer.label}
                </Text>
              )}
            </PressableScale>
          );
        })}
        <View style={styles.spacer} />
        <PressableScale
          testID="home-stage-needs-open"
          accessibilityRole="button"
          accessibilityLabel={open.label}
          onPress={open.onPress}
          style={[
            styles.button,
            {
              borderRadius: profile.chrome.control,
              borderColor: theme.colors.borderStrong,
            },
          ]}>
          <Text variant="caption" weight="semibold" numberOfLines={1}>
            {open.label}
          </Text>
        </PressableScale>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderCurve: 'continuous',
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 6,
    overflow: 'hidden',
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  who: { flex: 1, minWidth: 0 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  spacer: { flex: 1 },
  button: {
    minHeight: 32,
    minWidth: 64,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    borderCurve: 'continuous',
    flexShrink: 1,
  },
});

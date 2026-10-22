import { memo, useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet, ScrollView } from 'react-native';
import { useThemeTokens, useToast, Text } from '@osuki-dev/ui';
import { PressableScale } from '@/components/pressable-scale';
import { useLingui } from '@lingui/react/macro';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneGroupRule,
  SheetSceneRow,
  SHEET_LADDER,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { AgentAccountLimitsSection } from '@/components/agent-account-limits-section';
import { Toggle } from '@/components/toggle';
import { appChrome } from '@/constants/appearance';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { fadeIn, fadeOut, listLayout } from '@/lib/motion';
import { formatModelName } from '@/lib/agent-protocol';
import {
  contextFillRatio,
  contextTokenTotal,
  listSavedPermissions,
  revokeSavedPermission,
  type AgentContextUsage,
  type AgentSessionInfo,
  type SavedPermission,
  type TokensUsage,
} from '@/lib/agent-session';
import { AGENT_TYPE } from '@/constants/agent-type';
import { TwoStepAction } from '@/components/two-step-action';

/**
 * The session's context and spend, as a native form sheet route.
 *
 * An inspector rather than a picker, so it takes the same heading and ground
 * and then its own content: the capacity bar, a short list of facts, the two
 * switches that belong to the session, and one primary action with one quiet
 * one under it. No cards -- see `sheet-scene.tsx`.
 */
export interface AgentContextSheetProps {
  session?: AgentSessionInfo;
  serverId?: string;
  agentId?: string;
  /** The session's total spend, which a compaction does not reduce. */
  tokens?: TokensUsage;
  /** What the model can still see, from `GET …/context`. */
  contextUsage?: AgentContextUsage | null;
  /**
   * The window to measure against: the session's when the gateway stated one,
   * the catalogue model's otherwise. See `agent-workbench.tsx`.
   */
  contextLimit?: number;
  /** The catalogue's own name for the model, rather than its wire id. */
  modelName?: string;
  cost?: number;
  showReasoning?: boolean;
  onToggleReasoning?: () => void;
  yoloMode?: boolean;
  onToggleYolo?: () => void;
  /**
   * Bumped by the workbench whenever an "Always allow" reply lands, so a rule
   * agreed to a moment ago is in the list without the reader closing the sheet
   * and opening it again.
   */
  savedPermissionsRevision?: number;
  onClose: () => void;
  onCompact?: () => void;
  onClear?: () => void;
}

function compact(n?: number): string {
  return (n ?? 0).toLocaleString();
}

export const AgentContextSheet = memo(function AgentContextSheet({
  session,
  serverId,
  agentId,
  tokens,
  contextUsage,
  contextLimit,
  modelName,
  cost,
  showReasoning = true,
  onToggleReasoning,
  yoloMode = false,
  onToggleYolo,
  savedPermissionsRevision = 0,
  onClose,
  onCompact,
  onClear,
}: AgentContextSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();
  const { showToast } = useToast();
  const [confirmingYolo, setConfirmingYolo] = useState(false);

  /**
   * What "Always allow" has agreed to, for this session's project.
   *
   * Fetched here rather than published by the workbench: it is the one thing on
   * this sheet nothing else on the screen reads, and a route is mounted only
   * while it is open. It is re-read when a reply lands behind the sheet.
   */
  const asid = session?.asid;
  const [savedRules, setSavedRules] = useState<readonly SavedPermission[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);

  useEffect(() => {
    if (!asid) {
      setSavedRules([]);
      return;
    }
    let active = true;
    setLoadingRules(true);
    listSavedPermissions(asid)
      .then((items) => {
        if (active) setSavedRules(items);
      })
      .finally(() => {
        if (active) setLoadingRules(false);
      });
    return () => {
      active = false;
    };
  }, [asid, savedPermissionsRevision]);

  /**
   * Take one back.
   *
   * A trailing control rather than a swipe: this list lives in a native form
   * sheet, whose own pan is what dismisses it, and the Expo v57 router docs
   * describe `formSheet` and its detents without offering any way to tell a
   * row's horizontal swipe apart from the sheet's own gesture -- on Android the
   * presentation falls back to a modal where the two would simply compete. A
   * revoke that sometimes closes the sheet instead is worse than a button.
   */
  const revokeRule = useCallback(
    (rule: SavedPermission) => {
      if (!asid) return;
      const previous = savedRules;
      setSavedRules((rules) => rules.filter((entry) => entry.id !== rule.id));
      revokeSavedPermission(asid, rule.id).catch((err) => {
        console.warn('Failed to revoke saved permission:', err);
        setSavedRules(previous);
        showToast({
          variant: 'danger',
          title: t`Could not revoke`,
          message: [rule.action, rule.resource].filter(Boolean).join(' · '),
        });
      });
    },
    [asid, savedRules, showToast, t]
  );

  /**
   * Two different numbers, and the bar can only honestly be drawn from one.
   *
   * `tokens` is what the session has spent in total and never comes down.
   * `GET …/context` is what the model can still see -- everything after the
   * last compaction -- so that is the capacity. The spend keeps its own row.
   */
  const live = contextUsage?.tokens ?? null;
  const inContext = contextUsage?.total_tokens ?? contextTokenTotal(live);
  const spent = contextTokenTotal(tokens);
  // No invented window, but no window thrown away either: the gateway states
  // one when OpenCode does, and the model catalogue states one for every model
  // it publishes. Only with neither is there nothing to draw a percentage in.
  const limit = contextUsage?.limit?.context ?? contextLimit ?? session?.limit?.context;
  const ratio = contextFillRatio(live, limit, contextUsage?.total_tokens);
  const limitLabel =
    limit === undefined
      ? null
      : limit >= 1_000_000
        ? `${(limit / 1_000_000).toFixed(1)}M`
        : `${(limit / 1000).toFixed(0)}k`;
  const barTone =
    ratio !== null && ratio > 0.9
      ? theme.colors.danger
      : ratio !== null && ratio > 0.7
        ? theme.colors.warning
        : theme.colors.primary;
  const costLabel =
    cost === undefined || cost === null
      ? t`Not available`
      : cost === 0
        ? t`Free`
        : `$${cost.toFixed(4)}`;
  // `modelName` is already normalized by the workbench, including its variant.
  // When it is unavailable, format the session reference by the same rule.
  const displayModelName = modelName || formatModelName(session?.model, '');

  return (
    <SheetScene
      testID="agent-context-sheet"
      title={t`Context`}
      caption={session?.title || modelName || session?.model?.model_id}>
      <ScrollView
        nestedScrollEnabled
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}
        showsVerticalScrollIndicator={false}>
        {/* The one piece of decoration in the sheet, and it is a measurement:
            a thin primary bar on `primarySubtle`, no card around it. */}
        <View style={styles.capacity}>
          <View style={styles.capacityHeader}>
            <Text variant="bodySmall" weight="semibold" color={theme.colors.text}>
              {t`Context used`}
            </Text>
            {ratio === null ? (
              <Text variant="caption" color={theme.colors.textMuted}>
                {!live ? t`Not available` : t`no window reported for this model`}
              </Text>
            ) : (
              <Text variant="caption" weight="semibold" color={barTone}>
                {`${(ratio * 100).toFixed(1)}%`}
              </Text>
            )}
          </View>
          <View
            style={[
              styles.capacityTrack,
              { backgroundColor: surfaceBackground(theme.colors.primarySubtle) },
            ]}>
            <View
              style={[
                styles.capacityFill,
                {
                  width: `${ratio === null ? 0 : Math.max(2, ratio * 100)}%`,
                  backgroundColor: barTone,
                },
              ]}
            />
          </View>
          {/* What the number is, said plainly: the last turn's input, cached
              input, reasoning and output -- which is what the model read. */}
          <Text testID="agent-context-used" variant="caption" color={theme.colors.textMuted}>
            {!live
              ? t`Not available`
              : limitLabel === null
                ? t`${compact(inContext)} tokens the model last read`
                : t`${compact(inContext)} of ${limitLabel} tokens the model can hold`}
          </Text>
          {contextUsage?.messages !== undefined ? (
            <Text variant="caption" color={theme.colors.textSubtle}>
              {t`${contextUsage.messages} messages in context`}
            </Text>
          ) : null}
        </View>

        <SheetSceneGroupRule />
        <AgentAccountLimitsSection serverId={serverId} agentId={agentId} />
        <SheetSceneGroupHeading title={t`This session`} />
        <SheetSceneRow
          title={t`Estimated cost`}
          meta={
            <Text variant="caption" weight="semibold" color={theme.colors.primary}>
              {costLabel}
            </Text>
          }
        />
        {/* The row's label replaces its contents for a screen reader, so the
            value it shows is also its accessibility value. */}
        <SheetSceneRow
          title={t`Project`}
          accessibilityValue={{ text: session?.directory || '~' }}
          meta={
            <Text
              variant="caption"
              color={theme.colors.textMuted}
              numberOfLines={1}
              style={styles.metaWide}>
              {session?.directory || '~'}
            </Text>
          }
        />
        <SheetSceneRow
          title={t`Model`}
          accessibilityValue={{ text: displayModelName || t`Not set` }}
          meta={
            <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
              {displayModelName || t`Not set`}
            </Text>
          }
        />
        {/* "Total spent" next to a number read as money on a sheet that also
            states a cost. It is tokens, and it says so. */}
        <SheetSceneRow
          title={t`Tokens this session`}
          meta={
            <Text variant="caption" color={theme.colors.textMuted}>
              {tokens ? compact(spent) : t`Not available`}
            </Text>
          }
        />
        <SheetSceneRow
          title={t`Input`}
          meta={
            <Text variant="caption" color={theme.colors.textMuted}>
              {tokens?.input === undefined ? t`Not available` : compact(tokens.input)}
            </Text>
          }
        />
        <SheetSceneRow
          title={t`Output`}
          meta={
            <Text variant="caption" color={theme.colors.textMuted}>
              {tokens?.output === undefined ? t`Not available` : compact(tokens.output)}
            </Text>
          }
        />
        <SheetSceneRow
          title={t`Reasoning`}
          meta={
            <Text variant="caption" color={theme.colors.textMuted}>
              {tokens?.reasoning === undefined ? t`Not available` : compact(tokens.reasoning)}
            </Text>
          }
        />
        <SheetSceneRow
          title={t`Cache read`}
          meta={
            <Text variant="caption" color={theme.colors.textMuted}>
              {tokens?.cache_read === undefined ? t`Not available` : compact(tokens.cache_read)}
            </Text>
          }
        />

        <SheetSceneRow
          title={t`Cache write`}
          meta={
            <Text variant="caption" color={theme.colors.textMuted}>
              {tokens?.cache_write === undefined ? t`Not available` : compact(tokens.cache_write)}
            </Text>
          }
        />
        {session?.git_info?.branch || session?.git_info?.sha ? (
          <>
            <SheetSceneGroupRule />
            <SheetSceneGroupHeading title={t`Git snapshot`} />
            {session.git_info.branch ? (
              <SheetSceneRow
                title={t`Branch`}
                meta={
                  <Text
                    variant="caption"
                    color={theme.colors.textMuted}
                    numberOfLines={1}
                    style={styles.metaWide}>
                    {session.git_info.branch}
                  </Text>
                }
              />
            ) : null}
            {session.git_info.sha ? (
              <SheetSceneRow
                title={t`Commit`}
                meta={
                  <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                    {session.git_info.sha.slice(0, 12)}
                  </Text>
                }
              />
            ) : null}
          </>
        ) : null}

        {onToggleReasoning || onToggleYolo ? (
          <>
            <SheetSceneGroupRule />
            <SheetSceneGroupHeading title={t`Behaviour`} />
            {onToggleReasoning ? (
              <SheetSceneRow
                title={t`Show thinking`}
                caption={t`Expand reasoning in the timeline`}
                meta={
                  <Toggle
                    value={showReasoning}
                    onValueChange={onToggleReasoning}
                    accessibilityLabel={t`Show thinking`}
                  />
                }
              />
            ) : null}
            {onToggleYolo ? (
              <>
                <SheetSceneRow
                  title={t`Auto-approve every action`}
                  caption={t`The agent stops asking; irreversibly destructive commands stay blocked`}
                  meta={
                    <Toggle
                      value={yoloMode}
                      onValueChange={(next) => {
                        if (next) {
                          setConfirmingYolo(true);
                        } else {
                          setConfirmingYolo(false);
                          onToggleYolo();
                        }
                      }}
                      accessibilityLabel={t`Auto-approve every action`}
                    />
                  }
                />
                {confirmingYolo ? (
                  <View style={styles.confirm}>
                    <Text variant="caption" color={theme.colors.text} style={styles.confirmText}>
                      {t`The agent will act without asking each time. Irreversibly destructive commands are still blocked.`}
                    </Text>
                    <View style={styles.confirmActions}>
                      <PressableScale
                        testID="agent-yolo-confirm-btn"
                        accessibilityRole="button"
                        onPress={() => {
                          setConfirmingYolo(false);
                          onToggleYolo();
                        }}
                        style={[styles.action, { backgroundColor: theme.colors.danger }]}>
                        <Text variant="caption" weight="bold" color={theme.colors.onPrimary}>
                          {t`Turn it on`}
                        </Text>
                      </PressableScale>
                      <PressableScale
                        testID="agent-yolo-cancel-btn"
                        accessibilityRole="button"
                        onPress={() => setConfirmingYolo(false)}
                        style={styles.action}>
                        <Text variant="caption" weight="semibold" color={theme.colors.textMuted}>
                          {t`Cancel`}
                        </Text>
                      </PressableScale>
                    </View>
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}

        {/*
          What "Always allow" agreed to, and the way out of it.

          `allow_always` is the only permission answer whose consequence
          outlives the prompt, and until now there was nowhere in the app to see
          what had been agreed to -- the reader had to go to the host.
        */}
        <SheetSceneGroupRule />
        <SheetSceneGroupHeading
          title={t`Always allowed`}
          meta={
            loadingRules ? (
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
            ) : savedRules.length > 0 ? (
              <Text variant="caption" color={theme.colors.textMuted}>
                {savedRules.length}
              </Text>
            ) : null
          }
        />
        {savedRules.length === 0 ? (
          <Text variant="caption" color={theme.colors.textMuted} style={styles.rulesEmpty}>
            {loadingRules
              ? t`Reading the rules on the host…`
              : t`Nothing yet — an “Always allow” reply lands here, for this project.`}
          </Text>
        ) : (
          savedRules.map((rule) => (
            <Animated.View
              key={rule.id}
              entering={fadeIn('short')}
              exiting={fadeOut('micro')}
              layout={listLayout('short')}>
              <SheetSceneRow
                testID={`agent-saved-permission-${rule.id}`}
                title={rule.action || t`Permission`}
                caption={rule.resource}
                accessibilityLabel={[rule.action, rule.resource].filter(Boolean).join(' · ')}
                meta={
                  <PressableScale
                    testID={`agent-saved-permission-revoke-${rule.id}`}
                    accessibilityRole="button"
                    accessibilityLabel={t`Revoke ${rule.action || t`this rule`}`}
                    hitSlop={8}
                    onPress={() => revokeRule(rule)}
                    style={styles.revoke}>
                    <Text variant="caption" weight="semibold" color={theme.colors.danger}>
                      {t`Revoke`}
                    </Text>
                  </PressableScale>
                }
              />
            </Animated.View>
          ))
        )}

        {onCompact || onClear ? (
          <View style={styles.actions}>
            {onCompact ? (
              <PressableScale
                testID="agent-context-compact-btn"
                accessibilityRole="button"
                onPress={() => {
                  onClose();
                  onCompact();
                }}
                style={[styles.primaryAction, { backgroundColor: theme.colors.primary }]}>
                <Text variant="bodySmall" weight="bold" color={theme.colors.onPrimary}>
                  {t`Compact context`}
                </Text>
              </PressableScale>
            ) : null}
            {onClear ? (
              // Asked twice, in place: it ends the conversation the reader is
              // in, and it sat one stray tap away from "Compact context".
              <TwoStepAction
                testID="agent-context-clear-btn"
                label={t`Clear the conversation`}
                confirmLabel={t`Tap again to clear`}
                onConfirm={() => {
                  onClose();
                  onClear();
                }}
              />
            ) : null}
          </View>
        ) : null}
        <SheetSceneFooter bottomInset={insets.bottom} />
      </ScrollView>
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  capacity: { paddingTop: SHEET_LADDER.gap, gap: SHEET_LADDER.gap, alignItems: 'flex-start' },
  capacityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  capacityTrack: { height: 4, borderRadius: 2, overflow: 'hidden', alignSelf: 'stretch' },
  capacityFill: { height: '100%', borderRadius: 2 },
  metaWide: { maxWidth: 200 },
  rulesEmpty: { paddingVertical: SHEET_LADDER.snug, lineHeight: AGENT_TYPE.mono.lineHeight },
  revoke: { minHeight: 32, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  confirm: { paddingBottom: SHEET_LADDER.snug, gap: SHEET_LADDER.gap },
  confirmText: { lineHeight: AGENT_TYPE.mono.lineHeight },
  confirmActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: SHEET_LADDER.gap },
  action: {
    paddingHorizontal: SHEET_LADDER.gutter,
    paddingVertical: SHEET_LADDER.gap,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
  },
  actions: { marginTop: SHEET_LADDER.section, gap: SHEET_LADDER.gap },
  primaryAction: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
  },
  quietAction: { height: 44, alignItems: 'center', justifyContent: 'center' },
});

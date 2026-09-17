import { memo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PressableScale } from '@/components/pressable-scale';
import { useSheetGroundPlate } from '@/components/sheet-ground';
import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneGroupRule,
  SheetSceneRow,
  SHEET_LADDER,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { Toggle } from '@/components/toggle';
import { appChrome } from '@/constants/appearance';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import type { AgentSessionInfo, TokensUsage } from '@/lib/agent-session';

/** What OpenCode reports when a model does not state its own window. */
const DEFAULT_CONTEXT_LIMIT = 1_048_576;

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
  tokens?: TokensUsage;
  cost?: number;
  showReasoning?: boolean;
  onToggleReasoning?: () => void;
  yoloMode?: boolean;
  onToggleYolo?: () => void;
  onClose: () => void;
  onCompact?: () => void;
  onClear?: () => void;
}

function compact(n?: number): string {
  return (n ?? 0).toLocaleString();
}

export const AgentContextSheet = memo(function AgentContextSheet({
  session,
  tokens,
  cost,
  showReasoning = true,
  onToggleReasoning,
  yoloMode = false,
  onToggleYolo,
  onClose,
  onCompact,
  onClear,
}: AgentContextSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();
  // The capacity block is the one thing here that is not a row, so it takes the
  // plate for itself rather than inheriting one.
  const plate = useSheetGroundPlate();
  const [confirmingYolo, setConfirmingYolo] = useState(false);

  const total = (tokens?.input ?? 0) + (tokens?.output ?? 0) + (tokens?.reasoning ?? 0);
  const limit =
    (session?.limit as { context?: number } | undefined)?.context ?? DEFAULT_CONTEXT_LIMIT;
  const ratio = Math.min(1, Math.max(0, total / Math.max(1, limit)));
  const limitLabel =
    limit >= 1_000_000 ? `${(limit / 1_000_000).toFixed(1)}M` : `${(limit / 1000).toFixed(0)}k`;
  const costLabel =
    cost === undefined || cost === null || cost === 0 ? t`Free` : `$${cost.toFixed(4)}`;

  return (
    <SheetScene
      testID="agent-context-sheet"
      title={t`Context`}
      caption={session?.title || session?.model?.model_id}>
      <ScrollView
        style={sheetSceneStyles.scroller}
        contentContainerStyle={sheetSceneStyles.scrollerContent}
        showsVerticalScrollIndicator={false}>
        {/* The one piece of decoration in the sheet, and it is a measurement:
            a thin primary bar on `primarySubtle`, no card around it. */}
        <View style={styles.capacity}>
          <View style={styles.capacityHeader}>
            <Text variant="bodySmall" weight="semibold" color={theme.colors.text} style={plate}>
              {t`Context used`}
            </Text>
            <Text variant="caption" weight="semibold" color={theme.colors.primary} style={plate}>
              {`${(ratio * 100).toFixed(1)}%`}
            </Text>
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
                  width: `${Math.max(2, Math.min(100, ratio * 100))}%`,
                  backgroundColor: theme.colors.primary,
                },
              ]}
            />
          </View>
          <Text variant="caption" color={theme.colors.textMuted} style={plate}>
            {t`${compact(total)} of ${limitLabel} tokens`}
          </Text>
        </View>

        <SheetSceneGroupRule />
        <SheetSceneGroupHeading title={t`This session`} />
        <SheetSceneRow
          title={t`Estimated cost`}
          meta={
            <Text variant="caption" weight="semibold" color={theme.colors.primary}>
              {costLabel}
            </Text>
          }
        />
        <SheetSceneRow
          title={t`Working directory`}
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
          meta={
            <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
              {[session?.model?.model_id, session?.model?.variant].filter(Boolean).join(' · ') ||
                t`Not set`}
            </Text>
          }
        />
        <SheetSceneRow
          title={t`Input`}
          meta={
            <Text variant="caption" color={theme.colors.textMuted}>
              {compact(tokens?.input)}
            </Text>
          }
        />
        <SheetSceneRow
          title={t`Output`}
          meta={
            <Text variant="caption" color={theme.colors.textMuted}>
              {compact(tokens?.output)}
            </Text>
          }
        />
        <SheetSceneRow
          title={t`Reasoning`}
          meta={
            <Text variant="caption" color={theme.colors.textMuted}>
              {compact(tokens?.reasoning)}
            </Text>
          }
        />
        <SheetSceneRow
          title={t`Cache read`}
          meta={
            <Text variant="caption" color={theme.colors.textMuted}>
              {compact(tokens?.cache_read)}
            </Text>
          }
        />

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
                  title={t`YOLO mode`}
                  caption={
                    yoloMode
                      ? t`Auto-approving agent actions`
                      : t`Approve every agent action automatically`
                  }
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
                      accessibilityLabel={t`YOLO mode`}
                    />
                  }
                />
                {confirmingYolo ? (
                  <View style={styles.confirm}>
                    <Text variant="caption" color={theme.colors.text} style={styles.confirmText}>
                      {t`YOLO lets the agent act without asking each time. Irreversibly destructive commands are still blocked.`}
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
              <PressableScale
                testID="agent-context-clear-btn"
                accessibilityRole="button"
                onPress={() => {
                  onClose();
                  onClear();
                }}
                style={styles.quietAction}>
                <Text variant="caption" weight="semibold" color={theme.colors.danger}>
                  {t`Clear the conversation`}
                </Text>
              </PressableScale>
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
  confirm: { paddingBottom: SHEET_LADDER.snug, gap: SHEET_LADDER.gap },
  confirmText: { lineHeight: 18 },
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

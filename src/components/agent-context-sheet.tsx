import { memo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { DollarSign, Folder, Layers, ShieldAlert, Sparkles, X, Zap } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { SheetFrame, useSheetGroundPlate } from '@/components/sheet-ground';
import { SheetHandle } from '@/components/sheet-route-frame';
import { LADDER, SectionLabel, SettingsCard } from '@/components/settings-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { withAlpha } from '@/lib/color';
import { Toggle } from '@/components/toggle';
import type { AgentSessionInfo, TokensUsage } from '@/lib/agent-session';

/**
 * Context window, token spend and the two session-wide switches, as a native
 * form sheet route. Presentational: the route above it reads the session and
 * the handlers out of the sheet bridge.
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
  const plate = useSheetGroundPlate();
  const insets = useSafeAreaInsets();
  const surfaceBackground = useSurfaceBackground();
  const [confirmingYolo, setConfirmingYolo] = useState(false);

  const totalTokens = (tokens?.input ?? 0) + (tokens?.output ?? 0) + (tokens?.reasoning ?? 0);

  // Extract context window limit from session or default to 1M (1,048,576)
  const contextLimit = (session?.limit as { context?: number } | undefined)?.context ?? 1_048_576;
  const contextRatio = Math.min(1, Math.max(0, totalTokens / Math.max(1, contextLimit)));
  const contextPct = (contextRatio * 100).toFixed(1);

  const formatTokens = (n?: number) => (n ?? 0).toLocaleString();
  const costDisplay =
    cost === undefined || cost === null || cost === 0 ? t`$0.00 (Free)` : `$${cost.toFixed(4)}`;

  const modelName = session?.model?.model_id ?? 'muse-spark-1.3-contributor-free';
  const variantName = session?.model?.variant ?? 'high';

  return (
    // One ground and one layout column: the two subviews a native form sheet
    // lays itself out around. See `sheet-ground.tsx`.
    <SheetFrame testID="agent-context-sheet" tint="background">
      <View collapsable={false} style={styles.sheetLayout}>
        {/* Pinned Top Navigation Bar */}
        <View style={styles.fixedTop}>
          <SheetHandle />

          <View style={styles.header}>
            <View style={[styles.headerCopy, plate]}>
              <Text variant="subheading" style={styles.headerTitle}>
                {t`Context & Usage`}
              </Text>
              <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                {session?.title || t`Active Session`}
              </Text>
            </View>

            <GlassChrome face="sheet" style={styles.headerButton}>
              <PressableScale
                testID="agent-context-sheet-close"
                accessibilityRole="button"
                accessibilityLabel={t`Close`}
                onPress={onClose}
                style={styles.headerButtonHit}>
                <X size={19} color={theme.colors.text} strokeWidth={2} />
              </PressableScale>
            </GlassChrome>
          </View>
        </View>

        <ScrollView
          style={styles.scrollViewport}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: LADDER.section + insets.bottom },
          ]}
          showsVerticalScrollIndicator={false}>
          {/* Context Window Usage Section */}
          <View style={styles.sectionBlock}>
            <SectionLabel title={t`CONTEXT WINDOW`} color={theme.colors.textMuted} />
            <SettingsCard>
              <View style={styles.cardPad}>
                <View style={styles.progressHeader}>
                  <Text variant="bodySmall" weight="semibold" color={theme.colors.text}>
                    <Trans>Used Capacity</Trans>
                  </Text>
                  <Text variant="caption" weight="semibold" color={theme.colors.primary}>
                    {contextPct}%
                  </Text>
                </View>

                {/* Progress bar */}
                <View
                  style={[
                    styles.progressBarTrack,
                    { backgroundColor: surfaceBackground(theme.colors.background) },
                  ]}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        width: `${Math.max(2, Math.min(100, contextRatio * 100))}%`,
                        backgroundColor: theme.colors.primary,
                      },
                    ]}
                  />
                </View>

                <View style={styles.cardSubtextRow}>
                  <Text variant="caption" color={theme.colors.textMuted}>
                    {formatTokens(totalTokens)} <Trans>tokens used</Trans>
                  </Text>
                  <Text variant="caption" color={theme.colors.textMuted}>
                    {contextLimit >= 1_000_000
                      ? `${(contextLimit / 1_000_000).toFixed(1)}M`
                      : `${(contextLimit / 1000).toFixed(0)}k`}{' '}
                    <Trans>limit</Trans>
                  </Text>
                </View>
              </View>
            </SettingsCard>
          </View>

          {/* Tokens Breakdown Grid */}
          <View style={styles.sectionBlock}>
            <SectionLabel title={t`TOKEN BREAKDOWN`} color={theme.colors.textMuted} />
            <SettingsCard>
              <View style={styles.gridPad}>
                <View style={styles.grid}>
                  <View style={styles.gridItem}>
                    <Text variant="caption" color={theme.colors.textMuted}>
                      <Trans>Input</Trans>
                    </Text>
                    <Text variant="bodySmall" weight="semibold" color={theme.colors.text}>
                      {formatTokens(tokens?.input)}
                    </Text>
                  </View>

                  <View style={styles.gridItem}>
                    <Text variant="caption" color={theme.colors.textMuted}>
                      <Trans>Output</Trans>
                    </Text>
                    <Text variant="bodySmall" weight="semibold" color={theme.colors.text}>
                      {formatTokens(tokens?.output)}
                    </Text>
                  </View>

                  <View style={styles.gridItem}>
                    <Text variant="caption" color={theme.colors.textMuted}>
                      <Trans>Reasoning</Trans>
                    </Text>
                    <Text variant="bodySmall" weight="semibold" color={theme.colors.text}>
                      {formatTokens(tokens?.reasoning)}
                    </Text>
                  </View>

                  <View style={styles.gridItem}>
                    <Text variant="caption" color={theme.colors.textMuted}>
                      <Trans>Cache Read</Trans>
                    </Text>
                    <Text variant="bodySmall" weight="semibold" color={theme.colors.text}>
                      {formatTokens(tokens?.cache_read)}
                    </Text>
                  </View>

                  <View style={styles.gridItem}>
                    <Text variant="caption" color={theme.colors.textMuted}>
                      <Trans>Cache Write</Trans>
                    </Text>
                    <Text variant="bodySmall" weight="semibold" color={theme.colors.text}>
                      {formatTokens(tokens?.cache_write)}
                    </Text>
                  </View>
                </View>
              </View>
            </SettingsCard>
          </View>

          {/* Cost & Session Meta */}
          <View style={styles.sectionBlock}>
            <SectionLabel title={t`SESSION DETAILS`} color={theme.colors.textMuted} />
            <SettingsCard>
              {/* Cost Row */}
              <View style={styles.metaRow}>
                <View style={styles.metaLabelGroup}>
                  <DollarSign size={15} color={theme.colors.primary} />
                  <Text variant="bodySmall" color={theme.colors.text}>
                    <Trans>Estimated Cost</Trans>
                  </Text>
                </View>
                <View
                  style={[
                    styles.badge,
                    { backgroundColor: withAlpha(theme.colors.primary, 0.09) },
                  ]}>
                  <Text variant="caption" weight="semibold" color={theme.colors.primary}>
                    {costDisplay}
                  </Text>
                </View>
              </View>

              {/* Working Directory Row */}
              <View style={styles.metaRow}>
                <View style={styles.metaLabelGroup}>
                  <Folder size={15} color={theme.colors.textMuted} />
                  <Text variant="bodySmall" color={theme.colors.text}>
                    <Trans>Working Directory</Trans>
                  </Text>
                </View>
                <Text
                  variant="caption"
                  color={theme.colors.textMuted}
                  numberOfLines={1}
                  style={styles.dirValue}>
                  {session?.directory || '~'}
                </Text>
              </View>

              {/* Model & Reasoning Row */}
              <View style={styles.metaRow}>
                <View style={styles.metaLabelGroup}>
                  <Layers size={15} color={theme.colors.textMuted} />
                  <Text variant="bodySmall" color={theme.colors.text}>
                    <Trans>Active Model</Trans>
                  </Text>
                </View>
                <View style={styles.modelTagGroup}>
                  <Text variant="caption" weight="medium" color={theme.colors.text}>
                    {modelName}
                  </Text>
                  {variantName ? (
                    <View
                      style={[
                        styles.variantBadge,
                        { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
                      ]}>
                      <Text variant="caption" color={theme.colors.textMuted}>
                        {variantName}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </View>

              {/* Reasoning Visibility Toggle Row */}
              {onToggleReasoning ? (
                <View style={styles.metaRow}>
                  <View style={styles.metaLabelGroup}>
                    <Sparkles size={15} color={theme.colors.primary} />
                    <View>
                      <Text variant="bodySmall" color={theme.colors.text}>
                        <Trans>Show Thinking Process</Trans>
                      </Text>
                      <Text variant="caption" color={theme.colors.textMuted}>
                        <Trans>Expand reasoning & thoughts</Trans>
                      </Text>
                    </View>
                  </View>
                  <Toggle
                    value={showReasoning}
                    onValueChange={onToggleReasoning}
                    accessibilityLabel={t`Show Thinking Process`}
                  />
                </View>
              ) : null}

              {/* YOLO Mode Row */}
              {onToggleYolo ? (
                <>
                  <View style={styles.metaRow}>
                    <View style={styles.metaLabelGroup}>
                      <ShieldAlert
                        size={15}
                        color={yoloMode ? theme.colors.danger : theme.colors.textMuted}
                      />
                      <View style={styles.metaLabelStack}>
                        <Text
                          variant="bodySmall"
                          weight="medium"
                          color={yoloMode ? theme.colors.danger : theme.colors.text}>
                          <Trans>YOLO Mode</Trans>
                        </Text>
                        <Text variant="caption" color={theme.colors.textMuted}>
                          {yoloMode ? (
                            <Trans>Auto-approving agent actions</Trans>
                          ) : (
                            <Trans>Auto-approve every agent action without prompts</Trans>
                          )}
                        </Text>
                      </View>
                    </View>
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
                      accessibilityLabel={t`YOLO Mode`}
                    />
                  </View>

                  {confirmingYolo ? (
                    <View
                      style={[
                        styles.confirmRow,
                        {
                          backgroundColor: withAlpha(theme.colors.danger, 0.08),
                          borderColor: withAlpha(theme.colors.danger, 0.27),
                        },
                      ]}>
                      <Text variant="caption" color={theme.colors.text} style={styles.confirmText}>
                        <Trans>
                          YOLO lets the agent act without asking each time. Irreversibly destructive
                          commands (system paths, block devices, remote scripts) are still blocked.
                        </Trans>
                      </Text>
                      <View style={styles.confirmButtons}>
                        <PressableScale
                          testID="agent-yolo-confirm-btn"
                          accessibilityRole="button"
                          onPress={() => {
                            setConfirmingYolo(false);
                            onToggleYolo();
                          }}
                          style={[styles.confirmBtn, { backgroundColor: theme.colors.danger }]}>
                          <Text variant="caption" weight="bold" color={theme.colors.onPrimary}>
                            <Trans>Enable YOLO</Trans>
                          </Text>
                        </PressableScale>
                        <PressableScale
                          testID="agent-yolo-cancel-btn"
                          accessibilityRole="button"
                          onPress={() => setConfirmingYolo(false)}
                          style={[
                            styles.confirmBtn,
                            {
                              backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                            },
                          ]}>
                          <Text variant="caption" weight="semibold" color={theme.colors.textMuted}>
                            <Trans>Cancel</Trans>
                          </Text>
                        </PressableScale>
                      </View>
                    </View>
                  ) : null}
                </>
              ) : null}
            </SettingsCard>
          </View>

          {/* Quick Actions (Compact / Clear) */}
          {onCompact || onClear ? (
            <View style={styles.sectionBlock}>
              <SectionLabel title={t`ACTIONS`} color={theme.colors.textMuted} />
              <SettingsCard>
                {onCompact ? (
                  <PressableScale
                    testID="agent-context-compact-btn"
                    accessibilityRole="button"
                    onPress={() => {
                      onClose();
                      onCompact();
                    }}
                    style={styles.actionRow}>
                    <View style={styles.actionRowLeft}>
                      <Zap size={16} color={theme.colors.primary} />
                      <View>
                        <Text variant="bodySmall" weight="medium" color={theme.colors.text}>
                          <Trans>Compact Context</Trans>
                        </Text>
                        <Text variant="caption" color={theme.colors.textMuted}>
                          <Trans>Summarize history into compact memory (/compact)</Trans>
                        </Text>
                      </View>
                    </View>
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
                    style={styles.actionRow}>
                    <View style={styles.actionRowLeft}>
                      <X size={16} color={theme.colors.danger} />
                      <View>
                        <Text variant="bodySmall" weight="medium" color={theme.colors.danger}>
                          <Trans>Clear Context</Trans>
                        </Text>
                        <Text variant="caption" color={theme.colors.textMuted}>
                          <Trans>Reset conversation context window (/clear)</Trans>
                        </Text>
                      </View>
                    </View>
                  </PressableScale>
                ) : null}
              </SettingsCard>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </SheetFrame>
  );
});

const styles = StyleSheet.create({
  // The stack renders form sheets over a transparent background so the native
  // sheet keeps its own corners; without filling the height, that transparency
  // shows as a strip under the content.
  sheetLayout: {
    flex: 1,
  },
  fixedTop: {
    flexShrink: 0,
    paddingHorizontal: LADDER.gutter,
    paddingTop: LADDER.gap * 1.5,
    paddingBottom: LADDER.gap,
    gap: LADDER.snug,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.gap,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  headerTitle: {
    includeFontPadding: false,
  },
  headerButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  headerButtonHit: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollViewport: { flex: 1, minHeight: 0, overflow: 'hidden' },
  content: {
    paddingHorizontal: LADDER.gutter,
    paddingTop: 4,
    gap: LADDER.section,
  },
  sectionBlock: {
    gap: LADDER.snug,
  },
  cardPad: {
    padding: LADDER.gutter,
    gap: 10,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressBarTrack: {
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  cardSubtextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  gridPad: {
    padding: LADDER.gutter,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  gridItem: {
    width: '30%',
    minWidth: 80,
    gap: 3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: LADDER.gutter,
    paddingVertical: LADDER.snug,
    gap: 12,
  },
  metaLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  metaLabelStack: {
    flex: 1,
    gap: 2,
  },
  confirmRow: {
    marginHorizontal: LADDER.gutter,
    marginBottom: LADDER.snug,
    padding: 12,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  confirmText: {
    lineHeight: 17,
  },
  confirmButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  confirmBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  dirValue: {
    maxWidth: 180,
  },
  modelTagGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  variantBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderCurve: 'continuous',
  },
  actionRow: {
    paddingHorizontal: LADDER.gutter,
    paddingVertical: LADDER.snug,
  },
  actionRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
});

import { memo } from 'react';
import { View, StyleSheet, ScrollView, Modal, Pressable } from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { Cpu, DollarSign, Folder, Layers, Sparkles, X, Zap } from 'lucide-react-native';
import { PressableScale } from '@/components/pressable-scale';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { Toggle } from '@/components/toggle';
import type { AgentSessionInfo, TokensUsage } from '@/lib/agent-session';

export interface AgentContextSheetProps {
  visible: boolean;
  session?: AgentSessionInfo;
  tokens?: TokensUsage;
  cost?: number;
  showReasoning?: boolean;
  onToggleReasoning?: () => void;
  onClose: () => void;
  onCompact?: () => void;
  onClear?: () => void;
}

export const AgentContextSheet = memo(function AgentContextSheet({
  visible,
  session,
  tokens,
  cost,
  showReasoning = true,
  onToggleReasoning,
  onClose,
  onCompact,
  onClear,
}: AgentContextSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();

  const totalTokens = (tokens?.input ?? 0) + (tokens?.output ?? 0) + (tokens?.reasoning ?? 0);

  // Extract context window limit from session or default to 1M (1,048,576)
  const contextLimit =
    (session?.limit as { context?: number } | undefined)?.context ?? 1_048_576;
  const contextRatio = Math.min(1, Math.max(0, totalTokens / Math.max(1, contextLimit)));
  const contextPct = (contextRatio * 100).toFixed(1);

  const formatTokens = (n?: number) => (n ?? 0).toLocaleString();
  const costDisplay =
    cost === undefined || cost === null || cost === 0
      ? t`$0.00 (Free)`
      : `$${cost.toFixed(4)}`;

  const modelName = session?.model?.model_id ?? 'muse-spark-1.3-contributor-free';
  const variantName = session?.model?.variant ?? 'high';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          testID="agent-context-sheet"
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheetGround, { backgroundColor: theme.colors.surface }]}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View
                style={[
                  styles.headerIconBox,
                  { backgroundColor: `${theme.colors.primary}18` },
                ]}>
                <Cpu size={18} color={theme.colors.primary} />
              </View>
              <View>
                <Text variant="heading" style={styles.headerTitle}>
                  <Trans>Context & Usage</Trans>
                </Text>
                <Text variant="caption" color={theme.colors.textMuted}>
                  {session?.title || t`Active Session`}
                </Text>
              </View>
            </View>

            <PressableScale
              testID="agent-context-sheet-close"
              onPress={onClose}
              accessibilityLabel={t`Close`}
              style={[
                styles.closeBtn,
                { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
              ]}>
              <X size={16} color={theme.colors.text} />
            </PressableScale>
          </View>

          <ScrollView
            style={styles.scrollList}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {/* Context Window Usage Card */}
            <View
              style={[
                styles.card,
                {
                  backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                  borderColor: theme.colors.border,
                },
              ]}>
              <View style={styles.cardHeader}>
                <Text variant="bodySmall" weight="semibold" color={theme.colors.text}>
                  <Trans>Context Window</Trans>
                </Text>
                <Text variant="caption" weight="semibold" color={theme.colors.primary}>
                  {contextPct}%
                </Text>
              </View>

              {/* Progress bar */}
              <View
                style={[
                  styles.progressBarTrack,
                  { backgroundColor: surfaceBackground(theme.colors.surface) },
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

            {/* Tokens Breakdown Grid */}
            <View
              style={[
                styles.card,
                {
                  backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                  borderColor: theme.colors.border,
                },
              ]}>
              <Text
                variant="bodySmall"
                weight="semibold"
                color={theme.colors.text}
                style={styles.sectionTitle}>
                <Trans>Token Breakdown</Trans>
              </Text>

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

            {/* Cost & Session Meta Card */}
            <View
              style={[
                styles.card,
                {
                  backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                  borderColor: theme.colors.border,
                },
              ]}>
              {/* Cost Row */}
              <View style={styles.metaRow}>
                <View style={styles.metaLabelGroup}>
                  <DollarSign size={14} color={theme.colors.primary} />
                  <Text variant="bodySmall" color={theme.colors.text}>
                    <Trans>Estimated Cost</Trans>
                  </Text>
                </View>
                <View style={[styles.badge, { backgroundColor: `${theme.colors.primary}18` }]}>
                  <Text variant="caption" weight="semibold" color={theme.colors.primary}>
                    {costDisplay}
                  </Text>
                </View>
              </View>

              {/* Working Directory Row */}
              <View
                style={[
                  styles.metaRow,
                  styles.metaDivider,
                  { borderTopColor: theme.colors.border },
                ]}>
                <View style={styles.metaLabelGroup}>
                  <Folder size={14} color={theme.colors.textMuted} />
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
              <View
                style={[
                  styles.metaRow,
                  styles.metaDivider,
                  { borderTopColor: theme.colors.border },
                ]}>
                <View style={styles.metaLabelGroup}>
                  <Sparkles size={14} color={theme.colors.textMuted} />
                  <Text variant="bodySmall" color={theme.colors.text}>
                    <Trans>Model & Reasoning</Trans>
                  </Text>
                </View>
                <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
                  {modelName} • {variantName}
                </Text>
              </View>

              {/* Show Reasoning Process Toggle */}
              {onToggleReasoning ? (
                <View
                  style={[
                    styles.metaRow,
                    styles.metaDivider,
                    { borderTopColor: theme.colors.border },
                  ]}>
                  <View style={styles.metaLabelGroup}>
                    <Sparkles size={14} color={theme.colors.primary} />
                    <Text variant="bodySmall" color={theme.colors.text}>
                      <Trans>Show Reasoning Process</Trans>
                    </Text>
                  </View>
                  <Toggle
                    testID="agent-toggle-reasoning"
                    value={showReasoning}
                    onValueChange={onToggleReasoning}
                    accessibilityLabel={t`Show Reasoning Process`}
                  />
                </View>
              ) : null}
            </View>

            {/* Quick Actions */}
            <View style={styles.actionsRow}>
              {onCompact ? (
                <PressableScale
                  testID="agent-context-compact-btn"
                  onPress={() => {
                    onCompact();
                    onClose();
                  }}
                  style={[styles.actionBtn, { backgroundColor: theme.colors.primary }]}>
                  <Zap size={14} color="#fff" />
                  <Text variant="caption" weight="semibold" color="#fff">
                    <Trans>Compact Context (/compact)</Trans>
                  </Text>
                </PressableScale>
              ) : null}

              {onClear ? (
                <PressableScale
                  testID="agent-context-clear-btn"
                  onPress={() => {
                    onClear();
                    onClose();
                  }}
                  style={[
                    styles.actionBtn,
                    {
                      backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                      borderColor: theme.colors.border,
                      borderWidth: 1,
                    },
                  ]}>
                  <Layers size={14} color={theme.colors.textMuted} />
                  <Text variant="caption" color={theme.colors.text}>
                    <Trans>Clear Context (/clear)</Trans>
                  </Text>
                </PressableScale>
              ) : null}
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheetGround: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    paddingBottom: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(150, 150, 150, 0.4)',
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 16,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollList: {
    paddingHorizontal: 16,
  },
  scrollContent: {
    paddingBottom: 16,
    gap: 12,
  },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
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
  sectionTitle: {
    marginBottom: 2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  gridItem: {
    width: '30%',
    gap: 2,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  metaDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
    marginTop: 4,
  },
  metaLabelGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dirValue: {
    maxWidth: '55%',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  actionBtn: {
    flex: 1,
    height: 40,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});

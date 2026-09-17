import { memo, useEffect, useMemo, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Modal,
  ActivityIndicator,
  Pressable,
  TextInput,
} from 'react-native';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { Check, Search, X } from 'lucide-react-native';
import { PressableScale } from '@/components/pressable-scale';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { getAgentCatalog, type ModelInfo, type ModelRef } from '@/lib/agent-session';

export interface AgentModelSheetProps {
  visible: boolean;
  selectedModel?: ModelRef;
  onSelectModel: (model: ModelRef) => void;
  onClose: () => void;
}

export function formatProviderName(providerId: string): string {
  const lower = (providerId || '').toLowerCase().trim();
  if (lower === 'opencode') return 'OpenCode (Free)';
  if (lower === 'github-copilot') return 'GitHub Copilot';
  if (lower === 'opencode-go') return 'OpenCode Go';
  if (lower === 'opencode-zen') return 'OpenCode Zen';
  if (lower === 'openai') return 'OpenAI';
  if (lower === 'anthropic') return 'Anthropic';
  if (lower === 'google') return 'Google';
  if (lower === 'deepseek') return 'DeepSeek';
  if (lower === 'acme') return 'ACME';
  return providerId
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function isFreeModel(model: ModelInfo): boolean {
  const idLower = (model.id || '').toLowerCase();
  const nameLower = (model.name || '').toLowerCase();
  const provLower = (model.provider_id || '').toLowerCase();
  return (
    provLower === 'opencode' ||
    idLower.includes('free') ||
    nameLower.includes('free') ||
    idLower === 'big-pickle'
  );
}

export const AgentModelSheet = memo(function AgentModelSheet({
  visible,
  selectedModel,
  onSelectModel,
  onClose,
}: AgentModelSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'free'>('all');

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    getAgentCatalog()
      .then((cat) => {
        if (active && cat?.models) setModels(cat.models);
      })
      .catch((err) => {
        console.warn('Failed to load agent catalog:', err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visible]);

  // Filter models by search query and free filter
  const filteredModels = useMemo(() => {
    let list = models;
    if (filterMode === 'free') {
      list = list.filter(isFreeModel);
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => {
      const name = (m.name ?? '').toLowerCase();
      const id = (m.id ?? '').toLowerCase();
      const prov = (m.provider_id ?? '').toLowerCase();
      const family = (m.family ?? '').toLowerCase();
      return name.includes(q) || id.includes(q) || prov.includes(q) || family.includes(q);
    });
  }, [models, searchQuery, filterMode]);

  // Group models by section
  const sections = useMemo(() => {
    const q = searchQuery.trim();
    const result: { title: string; isRecent?: boolean; models: ModelInfo[] }[] = [];

    // If not searching and we have a selected model, show it under "Recent"
    if (!q && selectedModel && filterMode === 'all') {
      const active = models.find(
        (m) =>
          m.id === selectedModel.model_id &&
          (!selectedModel.provider_id || m.provider_id === selectedModel.provider_id)
      );
      if (active) {
        result.push({
          title: t`Recent`,
          isRecent: true,
          models: [active],
        });
      }
    }

    // Group remaining models by provider
    const providerMap = new Map<string, ModelInfo[]>();
    for (const m of filteredModels) {
      const prov = m.provider_id || 'other';
      const list = providerMap.get(prov) || [];
      list.push(m);
      providerMap.set(prov, list);
    }

    // Sort providers: opencode (Free) first, then github-copilot, opencode-go, openai, others
    const preferredOrder = [
      'opencode',
      'github-copilot',
      'opencode-go',
      'openai',
      'anthropic',
      'google',
    ];
    const sortedProviders = Array.from(providerMap.keys()).sort((a, b) => {
      const idxA = preferredOrder.indexOf(a);
      const idxB = preferredOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    for (const prov of sortedProviders) {
      const items = providerMap.get(prov) || [];
      result.push({
        title: formatProviderName(prov),
        models: items,
      });
    }

    return result;
  }, [filteredModels, models, searchQuery, selectedModel, filterMode, t]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          testID="agent-model-sheet"
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheetGround, { backgroundColor: theme.colors.surface }]}>
          {/* Top handle pill */}
          <View style={styles.handle} />

          {/* Header matching OpenCode reference */}
          <View style={styles.header}>
            <View style={styles.headerTitleWrap}>
              <Text variant="heading" style={styles.titleText}>
                {t`Select model`}
              </Text>
            </View>
            <PressableScale
              testID="agent-model-sheet-close"
              onPress={onClose}
              style={styles.closeBtn}
              accessibilityLabel={t`Close`}>
              <X size={18} color={theme.colors.textMuted} />
            </PressableScale>
          </View>

          {/* Search Input Bar */}
          <View
            style={[
              styles.searchBar,
              {
                backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                borderColor: theme.colors.border,
              },
            ]}>
            <Search size={15} color={theme.colors.textMuted} />
            <TextInput
              style={[styles.searchInput, { color: theme.colors.text }]}
              placeholder={t`Search models or providers…`}
              placeholderTextColor={theme.colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchQuery ? (
              <PressableScale onPress={() => setSearchQuery('')} style={styles.clearSearchBtn}>
                <X size={14} color={theme.colors.textMuted} />
              </PressableScale>
            ) : null}
          </View>

          {/* Quick Filter Bar (All / Free Only) */}
          <View style={styles.filterRow}>
            <PressableScale
              testID="agent-model-filter-all"
              onPress={() => setFilterMode('all')}
              style={[
                styles.filterChip,
                filterMode === 'all'
                  ? { backgroundColor: theme.colors.primary }
                  : { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
              ]}>
              <Text
                variant="caption"
                weight={filterMode === 'all' ? 'semibold' : 'medium'}
                color={filterMode === 'all' ? '#fff' : theme.colors.textMuted}>
                {t`All Models`}
              </Text>
            </PressableScale>

            <PressableScale
              testID="agent-model-filter-free"
              onPress={() => setFilterMode('free')}
              style={[
                styles.filterChip,
                filterMode === 'free'
                  ? { backgroundColor: '#10B981' }
                  : { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
              ]}>
              <Text
                variant="caption"
                weight={filterMode === 'free' ? 'semibold' : 'medium'}
                color={filterMode === 'free' ? '#fff' : theme.colors.textMuted}>
                {`✨ ${t`Free Only`}`}
              </Text>
            </PressableScale>
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="small" color={theme.colors.primary} />
            </View>
          ) : (
            <ScrollView
              style={styles.scrollList}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}>
              {sections.length === 0 || filteredModels.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text variant="caption" color={theme.colors.textMuted}>
                    <Trans>No models found matching your search.</Trans>
                  </Text>
                </View>
              ) : (
                <View style={styles.sectionsContainer}>
                  {sections.map((section) => (
                    <View key={section.title} style={styles.sectionBlock}>
                      <View style={styles.sectionHeader}>
                        <Text
                          variant="caption"
                          weight="semibold"
                          color={theme.colors.primary}
                          style={styles.sectionHeaderText}>
                          {section.title}
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.groupCard,
                          {
                            backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
                            borderColor: theme.colors.border,
                          },
                        ]}>
                        {section.models.map((mod, index) => {
                          const isSelected =
                            selectedModel?.model_id === mod.id &&
                            (!selectedModel.provider_id ||
                              selectedModel.provider_id === mod.provider_id);
                          const isFree = isFreeModel(mod);
                          const isLast = index === section.models.length - 1;

                          const hasVariants = mod.variants && mod.variants.length > 0;

                          return (
                            <View
                              key={`${mod.provider_id}:${mod.id}`}
                              style={[
                                styles.modelRowContainer,
                                !isLast && {
                                  borderBottomWidth: StyleSheet.hairlineWidth,
                                  borderBottomColor: theme.colors.border,
                                },
                                isSelected && { backgroundColor: `${theme.colors.primary}12` },
                              ]}>
                              <PressableScale
                                testID={`agent-model-row-${mod.id}`}
                                accessibilityLabel={isFree ? `${mod.name || mod.id} ${t`Free`}` : (mod.name || mod.id)}
                                onPress={() => {
                                  const defaultVariant =
                                    mod.variants?.find((v) => v.id === 'high')?.id ??
                                    mod.variants?.[0]?.id;
                                  onSelectModel({
                                    provider_id: mod.provider_id,
                                    model_id: mod.id,
                                    variant: isSelected ? selectedModel?.variant : defaultVariant,
                                  });
                                }}
                                style={styles.modelRow}>
                                <View style={styles.modelRowLeft}>
                                  <View
                                    style={[
                                      styles.indicatorDot,
                                      {
                                        backgroundColor: isSelected
                                          ? theme.colors.primary
                                          : 'transparent',
                                      },
                                    ]}
                                  />
                                  <View style={styles.modelNameCol}>
                                    <Text
                                      variant="bodySmall"
                                      weight={isSelected ? 'semibold' : 'regular'}
                                      color={isSelected ? theme.colors.primary : theme.colors.text}
                                      numberOfLines={1}
                                      style={styles.modelNameText}>
                                      {mod.name || mod.id}
                                    </Text>
                                    {mod.limit?.context ? (
                                      <Text variant="caption" color={theme.colors.textMuted} style={styles.limitText}>
                                        {mod.limit.context >= 1_000_000
                                          ? `${(mod.limit.context / 1_000_000).toFixed(1)}M context`
                                          : `${(mod.limit.context / 1000).toFixed(0)}k context`}
                                      </Text>
                                    ) : null}
                                  </View>
                                </View>

                                <View style={styles.modelRowRight}>
                                  {isFree ? (
                                    <View
                                      style={[
                                        styles.freeBadge,
                                        { backgroundColor: `${theme.colors.primary}18` },
                                      ]}>
                                      <Text
                                        variant="caption"
                                        weight="semibold"
                                        color={theme.colors.primary}
                                        style={styles.freeBadgeText}>
                                        {t`Free`}
                                      </Text>
                                    </View>
                                  ) : null}

                                  {section.isRecent ? (
                                    <Text
                                      variant="caption"
                                      color={theme.colors.textMuted}
                                      numberOfLines={1}
                                      style={styles.providerTagText}>
                                      {formatProviderName(mod.provider_id)}
                                    </Text>
                                  ) : null}

                                  {isSelected ? (
                                    <Check size={14} color={theme.colors.primary} strokeWidth={2.5} />
                                  ) : null}
                                </View>
                              </PressableScale>

                              {/* Reasoning Effort Variant Selector */}
                              {isSelected && hasVariants ? (
                                <View style={styles.variantSelectorBlock}>
                                  <Text variant="caption" color={theme.colors.textMuted} style={styles.variantLabel}>
                                    {t`Reasoning:`}
                                  </Text>
                                  <View style={styles.variantChipsContainer}>
                                    {mod.variants!.map((v) => {
                                      const activeVariant = selectedModel?.variant || 'high';
                                      const isVarActive = activeVariant === v.id;
                                      const label =
                                        v.id === 'minimal'
                                          ? t`Minimal`
                                          : v.id === 'low'
                                            ? t`Low`
                                            : v.id === 'medium'
                                              ? t`Medium`
                                              : v.id === 'high'
                                                ? t`High`
                                                : v.id === 'xhigh' || v.id === 'max'
                                                  ? t`Max`
                                                  : v.id.charAt(0).toUpperCase() + v.id.slice(1);
                                      return (
                                        <PressableScale
                                          key={v.id}
                                          testID={`agent-model-variant-${v.id}`}
                                          onPress={() => {
                                            onSelectModel({
                                              provider_id: mod.provider_id,
                                              model_id: mod.id,
                                              variant: v.id,
                                            });
                                          }}
                                          style={[
                                            styles.variantChip,
                                            isVarActive
                                              ? {
                                                  backgroundColor: theme.colors.primary,
                                                  borderColor: theme.colors.primary,
                                                }
                                              : {
                                                  backgroundColor: surfaceBackground(theme.colors.surface),
                                                  borderColor: theme.colors.border,
                                                },
                                          ]}>
                                          <Text
                                            variant="caption"
                                            weight={isVarActive ? 'semibold' : 'regular'}
                                            color={isVarActive ? '#fff' : theme.colors.text}>
                                            {label}
                                          </Text>
                                        </PressableScale>
                                      );
                                    })}
                                  </View>
                                </View>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheetGround: {
    maxHeight: '84%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: 'rgba(150,150,150,0.2)',
    overflow: 'hidden',
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(150,150,150,0.35)',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerTitleWrap: {
    flex: 1,
  },
  titleText: {
    fontSize: 17,
    fontWeight: '700',
  },
  closeBtn: {
    padding: 6,
    borderRadius: 16,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginVertical: 6,
    paddingHorizontal: 10,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 0,
  },
  clearSearchBtn: {
    padding: 4,
  },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
  },
  loadingContainer: {
    padding: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyContainer: {
    padding: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollList: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
  sectionsContainer: {
    gap: 12,
    paddingTop: 4,
  },
  sectionBlock: {
    gap: 5,
  },
  sectionHeader: {
    paddingHorizontal: 4,
  },
  sectionHeaderText: {
    fontSize: 12,
    letterSpacing: 0.3,
  },
  groupCard: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 40,
  },
  modelRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  indicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  modelNameText: {
    fontSize: 13,
    flexShrink: 1,
  },
  modelRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 8,
  },
  freeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  freeBadgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
  providerTagText: {
    fontSize: 11,
  },
  modelRowContainer: {
    overflow: 'hidden',
  },
  modelNameCol: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  limitText: {
    fontSize: 11,
  },
  variantSelectorBlock: {
    paddingHorizontal: 24,
    paddingBottom: 8,
    paddingTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  variantLabel: {
    fontSize: 11,
  },
  variantChipsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  variantChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
});

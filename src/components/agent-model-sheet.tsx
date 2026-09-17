import { memo, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView, Modal, Pressable } from 'react-native';
import { Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { Trans, useLingui } from '@lingui/react/macro';
import { Check, X, Sparkles } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassChrome } from '@/components/glass-chrome';
import { Input } from '@/components/themed-input';
import { PressableScale } from '@/components/pressable-scale';
import { SheetFrame, useSheetGroundPlate } from '@/components/sheet-ground';
import { SheetHandle } from '@/components/sheet-route-frame';
import { ThemedSurface } from '@/components/themed-surface';
import { LADDER, SectionLabel, SettingsCard } from '@/components/settings-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import {
  getAgentCatalog,
  type AgentCatalog,
  type ModelInfo,
  type ModelRef,
} from '@/lib/agent-session';

export interface AgentModelSheetProps {
  visible: boolean;
  selectedModel?: ModelRef;
  onSelectModel: (model: ModelRef) => void;
  onClose: () => void;
}

export function isFreeModel(model: ModelInfo): boolean {
  const idLower = (model.id || '').toLowerCase();
  const nameLower = (model.name || '').toLowerCase();
  const provLower = (model.provider_id || '').toLowerCase();
  return (
    idLower.includes('free') ||
    nameLower.includes('free') ||
    provLower === 'opencode' ||
    provLower.includes('free')
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
  const plate = useSheetGroundPlate();
  const insets = useSafeAreaInsets();
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
      .then((cat: AgentCatalog) => {
        if (active && cat?.models) {
          setModels(cat.models);
        }
      })
      .catch((err: unknown) => {
        console.warn('Failed to load model catalog:', err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [visible]);

  const filteredModels = useMemo(() => {
    let list = models;
    if (filterMode === 'free') {
      list = list.filter((m) => isFreeModel(m));
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        (m.name && m.name.toLowerCase().includes(q)) ||
        m.provider_id.toLowerCase().includes(q)
    );
  }, [models, searchQuery, filterMode]);

  const formatProviderName = (prov: string): string => {
    const known: Record<string, string> = {
      anthropic: 'Anthropic',
      openai: 'OpenAI',
      google: 'Google Cloud',
      deepseek: 'DeepSeek',
      ollama: 'Ollama (Local)',
      openrouter: 'OpenRouter',
      opencode: 'OpenCode Free Gateway',
    };
    return (
      known[prov.toLowerCase()] ||
      prov.charAt(0).toUpperCase() + prov.slice(1).replace(/[-_]/g, ' ')
    );
  };

  const sections = useMemo(() => {
    const result: { title: string; models: ModelInfo[] }[] = [];

    const freeModels = models.filter((m) => isFreeModel(m));
    if (filterMode === 'all' && !searchQuery.trim() && freeModels.length > 0) {
      result.push({
        title: t`⚡ Free & Unlimited (Recommended)`,
        models: freeModels,
      });
    }

    const providerMap = new Map<string, ModelInfo[]>();
    for (const m of filteredModels) {
      const prov = m.provider_id || 'other';
      const list = providerMap.get(prov) || [];
      list.push(m);
      providerMap.set(prov, list);
    }

    const preferredOrder = [
      'opencode',
      'deepseek',
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
  }, [filteredModels, models, searchQuery, filterMode, t]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          testID="agent-model-sheet"
          onPress={(e) => e.stopPropagation()}
          style={styles.sheetContainer}>
          <SheetFrame tint="background">
            <View collapsable={false} style={styles.sheetLayout}>
              {/* Pinned Top Navigation Bar */}
              <View style={styles.fixedTop}>
                <SheetHandle style={styles.sheetHandle} />

                <View style={styles.header}>
                  <View style={[styles.headerCopy, plate]}>
                    <Text variant="subheading" style={styles.headerTitle}>
                      {t`Select Model`}
                    </Text>
                    <Text variant="caption" color={theme.colors.textMuted}>
                      {selectedModel?.model_id || t`Choose an LLM model`}
                    </Text>
                  </View>

                  <GlassChrome face="sheet" style={styles.headerButton}>
                    <PressableScale
                      testID="agent-model-sheet-close"
                      accessibilityRole="button"
                      accessibilityLabel={t`Close`}
                      onPress={onClose}
                      style={styles.headerButtonHit}>
                      <X size={19} color={theme.colors.text} strokeWidth={2} />
                    </PressableScale>
                  </GlassChrome>
                </View>

                {/* Unified Search Input */}
                <Input
                  accessibilityLabel={t`Search models`}
                  placeholder={t`Search models or providers...`}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  variant="outline"
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                {/* Filter Mode Tabs */}
                <ThemedSurface
                  slot="tabs.background"
                  baseColor={theme.colors.surface}
                  style={styles.filterTabs}>
                  <PressableScale
                    testID="agent-model-filter-all"
                    onPress={() => setFilterMode('all')}
                    style={[
                      styles.filterTab,
                      filterMode === 'all' && {
                        backgroundColor: surfaceBackground(theme.colors.primarySubtle),
                      },
                    ]}>
                    <Text
                      variant="caption"
                      weight={filterMode === 'all' ? 'semibold' : 'medium'}
                      color={filterMode === 'all' ? theme.colors.primary : theme.colors.textMuted}>
                      {t`All Models`}
                    </Text>
                  </PressableScale>

                  <PressableScale
                    testID="agent-model-filter-free"
                    onPress={() => setFilterMode('free')}
                    style={[
                      styles.filterTab,
                      filterMode === 'free' && {
                        backgroundColor: surfaceBackground(theme.colors.primarySubtle),
                      },
                    ]}>
                    <Text
                      variant="caption"
                      weight={filterMode === 'free' ? 'semibold' : 'medium'}
                      color={filterMode === 'free' ? theme.colors.primary : theme.colors.textMuted}>
                      {`✨ ${t`Free Only`}`}
                    </Text>
                  </PressableScale>
                </ThemedSurface>
              </View>

              {loading ? (
                <View style={styles.loadingContainer}>
                  <Spinner size="lg" color={theme.colors.primary} />
                </View>
              ) : (
                <ScrollView
                  style={styles.scrollViewport}
                  contentContainerStyle={[
                    styles.content,
                    { paddingBottom: LADDER.section + insets.bottom },
                  ]}
                  showsVerticalScrollIndicator={false}>
                  {sections.length === 0 || filteredModels.length === 0 ? (
                    <View style={styles.emptyContainer}>
                      <Text variant="caption" color={theme.colors.textMuted}>
                        <Trans>No models found matching your search.</Trans>
                      </Text>
                    </View>
                  ) : (
                    sections.map((section) => (
                      <View key={section.title} style={styles.sectionBlock}>
                        <SectionLabel
                          title={section.title}
                          color={theme.colors.textMuted}
                        />

                        <SettingsCard>
                          {section.models.map((mod) => {
                            const isSelected =
                              selectedModel?.model_id === mod.id &&
                              (!selectedModel.provider_id ||
                                selectedModel.provider_id === mod.provider_id);
                            const isFree = isFreeModel(mod);
                            const hasVariants = mod.variants && mod.variants.length > 0;

                            return (
                              <View
                                key={`${mod.provider_id}:${mod.id}`}
                                style={[
                                  styles.modelRowWrap,
                                  isSelected && {
                                    backgroundColor: surfaceBackground(theme.colors.primarySubtle),
                                  },
                                ]}>
                                <PressableScale
                                  testID={`agent-model-row-${mod.id}`}
                                  accessibilityLabel={
                                    isFree ? `${mod.name || mod.id} ${t`Free`}` : mod.name || mod.id
                                  }
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
                                          borderColor: isSelected
                                            ? theme.colors.primary
                                            : theme.colors.border,
                                        },
                                      ]}
                                    />
                                    <View style={styles.modelNameCol}>
                                      <View style={styles.nameAndBadge}>
                                        <Text
                                          variant="bodySmall"
                                          weight={isSelected ? 'semibold' : 'regular'}
                                          color={isSelected ? theme.colors.primary : theme.colors.text}
                                          numberOfLines={1}
                                          style={styles.modelNameText}>
                                          {mod.name || mod.id}
                                        </Text>
                                        {isFree ? (
                                          <View
                                            style={[
                                              styles.freeBadge,
                                              { backgroundColor: `${theme.colors.primary}18` },
                                            ]}>
                                            <Sparkles size={9} color={theme.colors.primary} />
                                            <Text
                                              variant="caption"
                                              color={theme.colors.primary}
                                              style={styles.freeBadgeText}>
                                              {t`Free`}
                                            </Text>
                                          </View>
                                        ) : null}
                                      </View>
                                      {mod.limit?.context ? (
                                        <Text
                                          variant="caption"
                                          color={theme.colors.textMuted}
                                          style={styles.limitText}>
                                          {mod.limit.context >= 1_000_000
                                            ? `${(mod.limit.context / 1_000_000).toFixed(1)}M context`
                                            : `${(mod.limit.context / 1000).toFixed(0)}k context`}
                                        </Text>
                                      ) : null}
                                    </View>
                                  </View>

                                  {isSelected ? (
                                    <Check size={18} color={theme.colors.primary} />
                                  ) : null}
                                </PressableScale>

                                {/* Variants Row (e.g. low, medium, high) */}
                                {isSelected && hasVariants ? (
                                  <View style={styles.variantsRow}>
                                    <Text
                                      variant="caption"
                                      color={theme.colors.textMuted}
                                      style={styles.thinkingLabel}>
                                      {t`Thinking:`}
                                    </Text>
                                    <View style={styles.variantChips}>
                                      {mod.variants?.map((v) => {
                                        const isVarSelected =
                                          (selectedModel?.variant || 'high') === v.id;
                                        return (
                                          <PressableScale
                                            key={v.id}
                                            onPress={() =>
                                              onSelectModel({
                                                provider_id: mod.provider_id,
                                                model_id: mod.id,
                                                variant: v.id,
                                              })
                                            }
                                            style={[
                                              styles.variantChip,
                                              {
                                                backgroundColor: isVarSelected
                                                  ? theme.colors.primary
                                                  : surfaceBackground(theme.colors.surfaceRaised),
                                              },
                                            ]}>
                                            <Text
                                              variant="caption"
                                              weight={isVarSelected ? 'semibold' : 'regular'}
                                              color={isVarSelected ? '#fff' : theme.colors.textMuted}
                                              style={styles.variantChipText}>
                                              {v.id}
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
                        </SettingsCard>
                      </View>
                    ))
                  )}
                </ScrollView>
              )}
            </View>
          </SheetFrame>
        </Pressable>
      </Pressable>
    </Modal>
  );
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheetContainer: {
    maxHeight: '88%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  sheetLayout: {
    flexShrink: 1,
    overflow: 'hidden',
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(127, 127, 127, 0.36)',
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
  filterTabs: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: 12,
    borderCurve: 'continuous',
    gap: 4,
  },
  filterTab: {
    flex: 1,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    borderCurve: 'continuous',
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollViewport: {
    flexShrink: 1,
  },
  content: {
    paddingHorizontal: LADDER.gutter,
    paddingTop: 4,
    gap: LADDER.section,
  },
  emptyContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionBlock: {
    gap: LADDER.snug,
  },
  modelRowWrap: {
    overflow: 'hidden',
  },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: LADDER.gutter,
    paddingVertical: LADDER.snug,
  },
  modelRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  indicatorDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
  },
  modelNameCol: {
    flex: 1,
    gap: 2,
  },
  nameAndBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  modelNameText: {
    includeFontPadding: false,
  },
  freeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  freeBadgeText: {
    fontSize: 9,
    fontWeight: '700',
  },
  limitText: {
    fontSize: 11,
  },
  variantsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: LADDER.gutter,
    paddingBottom: 10,
    paddingTop: 2,
    gap: 8,
  },
  thinkingLabel: {
    fontSize: 11,
  },
  variantChips: {
    flexDirection: 'row',
    gap: 6,
  },
  variantChip: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    borderCurve: 'continuous',
  },
  variantChipText: {
    fontSize: 10,
    textTransform: 'capitalize',
  },
});

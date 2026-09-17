import { memo, useEffect, useMemo, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { useLingui } from '@lingui/react/macro';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { SettingsSegmented } from '@/components/settings-segmented';
import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneGroupRule,
  SheetSceneRow,
  SheetSceneSearch,
  SHEET_LADDER,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { appChrome } from '@/constants/appearance';
import { withAlpha } from '@/lib/color';
import { fadeIn, listLayout, riseIn, STAGGER } from '@/lib/motion';
import {
  formatModelName,
  getAgentCatalog,
  isFreeModel,
  type AgentCatalog,
  type ModelInfo,
  type ModelRef,
} from '@/lib/agent-session';

/** Rows past this one arrive together; a stagger that long reads as a wait. */
const STAGGERED_ROWS = 8;

/**
 * Choose a model, as a native form sheet route.
 *
 * Built on `sheet-scene.tsx`: one frosted ground, no cards, and the left rule
 * for the current model. Variants are chips *under the selected row only* --
 * they are a property of the thing you chose, not of every row you did not.
 */
export interface AgentModelSheetProps {
  /** The gateway session whose catalog is listed. */
  sessionId?: string;
  selectedModel?: ModelRef;
  onSelectModel: (model: ModelRef) => void;
  onClose: () => void;
}

/**
 * The provider's own spelling of its name.
 *
 * The group heading is the only thing telling two identically-named models
 * apart -- `opencode` and `opencode-go` both publish a "Union Alpha Free" --
 * so a hyphenated id has to survive as words rather than collapse to one.
 */
function providerName(provider: string): string {
  const known: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google Cloud',
    deepseek: 'DeepSeek',
    ollama: 'Ollama',
    openrouter: 'OpenRouter',
    opencode: 'OpenCode',
    'opencode-go': 'OpenCode Go',
  };
  const lower = provider.toLowerCase();
  if (known[lower]) return known[lower];
  return lower
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => known[word] ?? word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The two facts a row carries under its name: how much it can hold, and what
 * thinking levels it offers. Nothing else -- the provider is the heading and
 * the price is the filter.
 */
function modelCaption(model: ModelInfo): string | undefined {
  const parts: string[] = [];
  const context = model.limit?.context;
  if (context) {
    parts.push(
      context >= 1_000_000
        ? `${(context / 1_000_000).toFixed(1)}M context`
        : `${(context / 1000).toFixed(0)}k context`
    );
  }
  const variants = model.variants ?? [];
  if (variants.length === 1) parts.push(variants[0].id);
  else if (variants.length > 1) {
    parts.push(`${variants[0].id} to ${variants[variants.length - 1].id}`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

export const AgentModelSheet = memo(function AgentModelSheet({
  sessionId,
  selectedModel,
  onSelectModel,
  onClose: _onClose,
}: AgentModelSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'free'>('all');

  // A route mounts when it opens and unmounts when it is dismissed, so the
  // catalog is fetched once per opening without a `visible` flag to watch.
  useEffect(() => {
    let active = true;
    setLoading(true);
    getAgentCatalog(sessionId)
      .then((cat: AgentCatalog) => {
        if (active && cat?.models) setModels(cat.models);
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
  }, [sessionId]);

  const filteredModels = useMemo(() => {
    let list = models;
    if (filterMode === 'free') list = list.filter((m) => isFreeModel(m));
    const q = searchQuery.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (m) =>
        m.id.toLowerCase().includes(q) ||
        (m.name && m.name.toLowerCase().includes(q)) ||
        m.provider_id.toLowerCase().includes(q)
    );
  }, [models, searchQuery, filterMode]);

  /**
   * One group per provider, and nothing else.
   *
   * There used to be a synthetic "Free and unlimited" group above these, which
   * listed the same models a second time -- and because two providers publish a
   * model of the same name, it put two rows reading "Union Alpha Free" next to
   * each other with nothing to tell them apart. The provider heading is what
   * distinguishes them, and the "Free only" segment is what the synthetic group
   * was really for.
   */
  const sections = useMemo(() => {
    const result: { title: string; models: ModelInfo[] }[] = [];
    const byProvider = new Map<string, ModelInfo[]>();
    for (const model of filteredModels) {
      const provider = model.provider_id || 'other';
      const list = byProvider.get(provider) ?? [];
      list.push(model);
      byProvider.set(provider, list);
    }
    const preferred = ['opencode', 'deepseek', 'openai', 'anthropic', 'google'];
    const order = Array.from(byProvider.keys()).sort((a, b) => {
      const ia = preferred.indexOf(a);
      const ib = preferred.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
    for (const provider of order) {
      result.push({ title: providerName(provider), models: byProvider.get(provider) ?? [] });
    }
    return result;
  }, [filteredModels]);

  // The caption is the current value, live -- not a hint.
  const currentValue = selectedModel
    ? [formatModelName(selectedModel), selectedModel.variant].filter(Boolean).join(' · ')
    : undefined;

  let rowIndex = 0;

  return (
    <SheetScene
      testID="agent-model-sheet"
      title={t`Choose a model`}
      caption={currentValue}
      header={
        <>
          <SheetSceneSearch
            testID="agent-model-search"
            accessibilityLabel={t`Search models`}
            placeholder={t`Search models or providers`}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          <SettingsSegmented
            testID="agent-model-filter"
            options={[
              { label: t`All models`, value: 'all' },
              { label: t`Free only`, value: 'free' },
            ]}
            value={filterMode}
            onChange={(next) => setFilterMode(next === 'free' ? 'free' : 'all')}
          />
        </>
      }>
      {loading ? (
        <View style={styles.loading}>
          <Spinner size="lg" color={theme.colors.primary} />
        </View>
      ) : (
        <ScrollView
          style={sheetSceneStyles.scroller}
          contentContainerStyle={sheetSceneStyles.scrollerContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {sections.length === 0 || filteredModels.length === 0 ? (
            <View style={styles.empty}>
              <Text variant="caption" color={theme.colors.textMuted}>
                {t`No models match that search.`}
              </Text>
            </View>
          ) : (
            sections.map((section, sectionIndex) => (
              <Animated.View key={section.title} layout={listLayout('short')}>
                {sectionIndex > 0 ? <SheetSceneGroupRule /> : null}
                <SheetSceneGroupHeading title={section.title} first={sectionIndex === 0} />
                {section.models.map((model) => {
                  const isSelected =
                    selectedModel?.model_id === model.id &&
                    (!selectedModel.provider_id || selectedModel.provider_id === model.provider_id);
                  const variants = model.variants ?? [];
                  const index = rowIndex++;
                  return (
                    <Animated.View
                      key={`${model.provider_id}:${model.id}`}
                      entering={
                        index < STAGGERED_ROWS ? riseIn(index * STAGGER.row) : fadeIn('short')
                      }
                      layout={listLayout('short')}>
                      <SheetSceneRow
                        testID={`agent-model-row-${model.id}`}
                        title={model.name || model.id}
                        caption={modelCaption(model)}
                        selected={isSelected}
                        onPress={() =>
                          onSelectModel({
                            provider_id: model.provider_id,
                            model_id: model.id,
                            variant: isSelected
                              ? selectedModel?.variant
                              : (variants.find((v) => v.id === 'high')?.id ?? variants[0]?.id),
                          })
                        }
                        trailing={
                          isSelected && variants.length > 0 ? (
                            <View style={styles.variants}>
                              {variants.map((variant) => {
                                const active = (selectedModel?.variant || 'high') === variant.id;
                                return (
                                  <PressableScale
                                    key={variant.id}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: active }}
                                    accessibilityLabel={variant.id}
                                    onPress={() =>
                                      onSelectModel({
                                        provider_id: model.provider_id,
                                        model_id: model.id,
                                        variant: variant.id,
                                      })
                                    }
                                    style={[
                                      styles.variantChip,
                                      {
                                        backgroundColor: active
                                          ? theme.colors.primary
                                          : withAlpha(theme.colors.primary, 0.09),
                                      },
                                    ]}>
                                    <Text
                                      variant="caption"
                                      weight={active ? 'semibold' : 'regular'}
                                      color={active ? theme.colors.onPrimary : theme.colors.primary}
                                      style={styles.variantChipText}>
                                      {variant.id}
                                    </Text>
                                  </PressableScale>
                                );
                              })}
                            </View>
                          ) : null
                        }
                      />
                    </Animated.View>
                  );
                })}
              </Animated.View>
            ))
          )}
          <SheetSceneFooter bottomInset={insets.bottom} />
        </ScrollView>
      )}
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  loading: { padding: 40, alignItems: 'center', justifyContent: 'center' },
  empty: { paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  variants: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SHEET_LADDER.gap,
    paddingBottom: SHEET_LADDER.snug,
  },
  variantChip: {
    paddingHorizontal: SHEET_LADDER.snug,
    paddingVertical: 5,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
  },
  variantChipText: { textTransform: 'capitalize', includeFontPadding: false },
});

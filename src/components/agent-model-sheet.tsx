import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet, ScrollView } from 'react-native';
import { Spinner, useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
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
import { loadRecentAgentModels, rememberAgentModel } from '@/lib/agent-model-memory';
import { recentCatalogModels } from '@/lib/recent-agent-models';
import { appChrome } from '@/constants/appearance';
import { withAlpha } from '@/lib/color';
import { fadeIn, listLayout, riseIn, STAGGER } from '@/lib/motion';
import { SECTION_PAGE_SIZE, nearListEnd, pageSections } from '@/lib/paged-sections';
import { findAgentModelPosition } from '@/lib/agent-model-position';
import {
  formatModelName,
  getAgentCatalog,
  isFreeModel,
  type AgentCatalog,
  type CatalogDefaults,
  type ModelInfo,
  type ModelRef,
  type ProviderInfo,
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
  /**
   * The workspace whose catalog is listed.
   *
   * The models are a host-wide list, but `defaults` is not: a project can set
   * its own, and this sheet marks the default row. Asked with the same
   * directory as the workbench so the two cannot disagree about which model is
   * the default, and so both share one cache entry rather than two.
   */
  directory?: string;
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
  directory,
  selectedModel,
  onSelectModel,
  onClose: _onClose,
}: AgentModelSheetProps) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  /**
   * True from the first frame, because the read starts on the first frame.
   *
   * Starting at `false` painted the empty state once before the effect had
   * run -- "No models on this host" under a list that was about to arrive.
   * Nothing on this screen may say the host has nothing until the host has
   * answered.
   */
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [recentRefs, setRecentRefs] = useState(() => loadRecentAgentModels(sessionId ?? ''));
  const selectModel = (model: ModelRef) => {
    if (sessionId) {
      rememberAgentModel(sessionId, directory, model);
      setRecentRefs(loadRecentAgentModels(sessionId));
    }
    onSelectModel(model);
  };
  const [models, setModels] = useState<ModelInfo[]>([]);
  /**
   * The providers, for their `activation`, and the catalog's own defaults.
   *
   * Both were fetched and thrown away. A provider with `activation:
   * "disabled"` and a model with `enabled: false` are carried through by the
   * gateway deliberately -- "grey them out and say OpenCode on the host needs
   * configuring" -- and listing them as ordinary rows meant tapping one
   * switched the session to a model that cannot run, with the refusal arriving
   * later as an unexplained failed turn.
   */
  const [providers, setProviders] = useState<readonly ProviderInfo[]>([]);
  const [defaults, setDefaults] = useState<CatalogDefaults>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'free'>('all');
  const modelListRef = useRef<ScrollView>(null);
  const sectionOffsetsRef = useRef(new Map<number, number>());
  const selectedRowOffsetRef = useRef<number | null>(null);
  const viewportHeightRef = useRef(0);
  const contentHeightRef = useRef(0);
  // Automatic positioning belongs to opening this route. Once the reader
  // searches, filters, or drags, their position is theirs until they dismiss it.
  const autoRevealCancelledRef = useRef(false);
  const autoRevealCompleteRef = useRef(false);
  /**
   * Bumped by "Try again", which is the whole of the retry: the effect below
   * watches it and reads the catalog once more, past the cache.
   */
  const [reloadToken, setReloadToken] = useState(0);

  // A route mounts when it opens and unmounts when it is dismissed, so the
  // catalog is fetched once per opening without a `visible` flag to watch.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    setModels([]);
    setRecentRefs(loadRecentAgentModels(sessionId ?? ''));
    getAgentCatalog(sessionId, undefined, {
      ...(directory ? { directory } : {}),
      // Revalidate on every opening so history never supplies stale model metadata.
      forceRefresh: true,
      requireFresh: true,
    })
      .then((cat: AgentCatalog) => {
        if (!active) return;
        if (cat?.models) setModels(cat.models);
        setProviders(cat?.providers ?? []);
        setDefaults(cat?.defaults ?? {});
      })
      .catch((err: unknown) => {
        if (active) setLoadFailed(true);
        console.warn('Failed to load model catalog:', err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [sessionId, directory, reloadToken]);

  /**
   * Which rows the reader scrolls past, and nothing more.
   *
   * "Free only" is a view filter, not a policy: it hides paid rows from this
   * list, it does not say the app may only run free models. So the model a new
   * session starts on -- the one remembered from the reader's last pick, see
   * `lib/agent-session-defaults.ts` -- is used whether or not it is free and
   * whether or not this segment is on. The current row above says what that is.
   */
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

  /** The session's choice, or the catalogue default for a fresh session. */
  const effectiveModel = selectedModel ?? defaults.model;

  // Recent rows resolve against the same catalog and filters as provider groups.
  const sections = useMemo(() => {
    const recent = recentCatalogModels(recentRefs, filteredModels, providers);
    const result: { title: string; models: ModelInfo[]; recent?: boolean }[] = recent.length
      ? [{ title: t`Recently used`, models: recent, recent: true }]
      : [];
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
  }, [filteredModels, recentRefs, providers, t]);

  // `sections` puts Recently used first, so this finds that row when the same
  // model is also present in its provider section.
  const selectedPosition = useMemo(
    () => findAgentModelPosition(sections, effectiveModel),
    [sections, effectiveModel]
  );

  /**
   * How many rows are drawn. A host can publish hundreds of models, so the
   * sheet draws a page and asks for the next as the reader nears the end of
   * it -- see `paged-sections.ts`. The catalogue itself is already whole: this
   * bounds what is *mounted*, not what is fetched, and search still looks
   * through every model.
   */
  const [rowLimit, setRowLimit] = useState(SECTION_PAGE_SIZE);
  const paged = useMemo(() => pageSections(sections, rowLimit), [sections, rowLimit]);
  const hasMore = paged.shown < paged.total;
  // A new search or filter is a new list: it starts from its first page, or a
  // reader who had scrolled deep would mount every match of the next query.
  useEffect(() => {
    setRowLimit(SECTION_PAGE_SIZE);
  }, [searchQuery, filterMode]);
  const loadMore = useCallback(() => {
    setRowLimit((limit) => (limit < paged.total ? limit + SECTION_PAGE_SIZE : limit));
  }, [paged.total]);

  // The catalogue can have hundreds of models. Grow the existing page just far
  // enough to mount the current row; its `onLayout` below then gives ScrollView
  // the real y coordinate rather than guessing from a row height.
  useEffect(() => {
    if (
      autoRevealCancelledRef.current ||
      autoRevealCompleteRef.current ||
      searchQuery ||
      filterMode !== 'all' ||
      !selectedPosition
    ) {
      return;
    }
    // react-doctor-disable-next-line react-doctor/no-adjust-state-on-prop-change -- this expands virtualization only far enough to mount the externally selected row; it does not mirror the prop.
    setRowLimit((limit) => Math.max(limit, selectedPosition.rowIndex + 1));
  }, [filterMode, searchQuery, selectedPosition]);

  const tryRevealSelectedRow = useCallback(() => {
    if (
      autoRevealCancelledRef.current ||
      autoRevealCompleteRef.current ||
      searchQuery ||
      filterMode !== 'all' ||
      !selectedPosition
    ) {
      return;
    }
    const sectionOffset = sectionOffsetsRef.current.get(selectedPosition.sectionIndex);
    const rowOffset = selectedRowOffsetRef.current;
    const viewportHeight = viewportHeightRef.current;
    const contentHeight = contentHeightRef.current;
    if (sectionOffset === undefined || rowOffset === null || viewportHeight <= 0) return;
    const target = Math.max(0, sectionOffset + rowOffset - SHEET_LADDER.section);
    const offset = Math.min(target, Math.max(0, contentHeight - viewportHeight));
    modelListRef.current?.scrollTo({ y: offset, animated: false });
    autoRevealCompleteRef.current = true;
  }, [filterMode, searchQuery, selectedPosition]);

  /** Which providers the host has switched off. */
  const disabledProviders = useMemo(() => {
    const off = new Set<string>();
    for (const provider of providers) {
      if (provider.activation === 'disabled') off.add(provider.id);
    }
    return off;
  }, [providers]);

  /**
   * What the session is running, or what it would run if it ran now.
   *
   * A session with no model of its own is not a session with no model: the
   * gateway hands OpenCode's configured default, and the catalog says what
   * that is. Showing nothing here meant the sheet had no current row at all on
   * a fresh session, and the reader had to pick one to find out what was
   * already selected.
   */
  const currentModelInfo = effectiveModel
    ? models.find(
        (model) =>
          model.id === effectiveModel.model_id &&
          (!effectiveModel.provider_id || model.provider_id === effectiveModel.provider_id)
      )
    : undefined;
  const currentValue = effectiveModel
    ? [
        formatModelName(effectiveModel, 'Model', currentModelInfo?.name),
        selectedModel ? undefined : t`default`,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined;

  /**
   * What an empty list means, which is three different things.
   *
   * The sheet used to say "No free models on this host" whatever had emptied
   * it, so a host that answered with nothing at all -- a cold workspace, a
   * gateway that had just gone quiet -- was reported as a host whose models
   * were all paid, under a segment reading "All models". Each case is now its
   * own sentence, and the one the reader can do something about is the one
   * that offers to ask again.
   */
  const emptyReason: 'search' | 'free-filter' | 'nothing' = searchQuery.trim()
    ? 'search'
    : filterMode === 'free' && models.length > 0
      ? 'free-filter'
      : 'nothing';

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
            clearAccessibilityLabel={t`Clear the search`}
            placeholder={t`Search models or providers`}
            value={searchQuery}
            onChangeText={(query) => {
              autoRevealCancelledRef.current = true;
              setSearchQuery(query);
            }}
          />
          <SettingsSegmented
            testID="agent-model-filter"
            options={[
              { label: t`All models`, value: 'all' },
              { label: t`Free only`, value: 'free' },
            ]}
            value={filterMode}
            onChange={(next) => {
              autoRevealCancelledRef.current = true;
              setFilterMode(next === 'free' ? 'free' : 'all');
            }}
          />
        </>
      }>
      {loading ? (
        <View style={styles.loading}>
          <Spinner size="lg" color={theme.colors.primary} />
        </View>
      ) : (
        <ScrollView
          ref={modelListRef}
          style={sheetSceneStyles.scroller}
          contentContainerStyle={sheetSceneStyles.scrollerContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={64}
          onLayout={({ nativeEvent }) => {
            viewportHeightRef.current = nativeEvent.layout.height;
            tryRevealSelectedRow();
          }}
          onContentSizeChange={(_width, height) => {
            contentHeightRef.current = height;
            tryRevealSelectedRow();
          }}
          onScrollBeginDrag={() => {
            autoRevealCancelledRef.current = true;
          }}
          onScroll={
            hasMore
              ? ({ nativeEvent }) => {
                  if (
                    nearListEnd({
                      offset: nativeEvent.contentOffset.y,
                      viewport: nativeEvent.layoutMeasurement.height,
                      content: nativeEvent.contentSize.height,
                    })
                  ) {
                    loadMore();
                  }
                }
              : undefined
          }>
          {sections.length === 0 || filteredModels.length === 0 ? (
            <Animated.View entering={fadeIn('short')} style={styles.empty}>
              <Text variant="caption" color={theme.colors.textMuted}>
                {loadFailed
                  ? t`Could not load models`
                  : emptyReason === 'search'
                    ? t`No models match “${searchQuery.trim()}”.`
                    : emptyReason === 'free-filter'
                      ? t`No free models on this host.`
                      : t`No models on this host.`}
              </Text>
              {loadFailed || emptyReason === 'nothing' ? (
                <PressableScale
                  testID="agent-model-retry"
                  accessibilityRole="button"
                  accessibilityLabel={t`Retry`}
                  onPress={() => setReloadToken((token) => token + 1)}
                  style={[
                    styles.retry,
                    { backgroundColor: withAlpha(theme.colors.primary, 0.09) },
                  ]}>
                  <Text variant="caption" weight="semibold" color={theme.colors.primary}>
                    {t`Retry`}
                  </Text>
                </PressableScale>
              ) : null}
            </Animated.View>
          ) : (
            paged.sections.map((section, sectionIndex) => (
              <Animated.View
                key={section.title}
                layout={listLayout('short')}
                onLayout={({ nativeEvent }) => {
                  sectionOffsetsRef.current.set(sectionIndex, nativeEvent.layout.y);
                  tryRevealSelectedRow();
                }}>
                {sectionIndex > 0 ? <SheetSceneGroupRule /> : null}
                <SheetSceneGroupHeading title={section.title} first={sectionIndex === 0} />
                {section.models.map((model, modelIndex) => {
                  const isSelected =
                    effectiveModel?.model_id === model.id &&
                    (!effectiveModel.provider_id ||
                      effectiveModel.provider_id === model.provider_id);
                  // Carried through rather than filtered out, and said plainly:
                  // the host is where a provider is signed in, and the gateway
                  // proxies no credential route.
                  const unavailable =
                    model.enabled === false || disabledProviders.has(model.provider_id);
                  const variants = model.variants ?? [];
                  const index = rowIndex++;
                  return (
                    <Animated.View
                      key={`${model.provider_id}:${model.id}`}
                      onLayout={
                        selectedPosition?.sectionIndex === sectionIndex &&
                        selectedPosition.modelIndex === modelIndex
                          ? ({ nativeEvent }) => {
                              selectedRowOffsetRef.current = nativeEvent.layout.y;
                              tryRevealSelectedRow();
                            }
                          : undefined
                      }
                      entering={
                        index < STAGGERED_ROWS ? riseIn(index * STAGGER.row) : fadeIn('short')
                      }
                      layout={listLayout('short')}>
                      <SheetSceneRow
                        testID={`agent-model-row-${model.id}`}
                        title={model.name || model.id}
                        caption={
                          section.recent
                            ? [providerName(model.provider_id), modelCaption(model)]
                                .filter(Boolean)
                                .join(' · ')
                            : modelCaption(model)
                        }
                        selected={isSelected && !unavailable}
                        disabled={unavailable}
                        disabledCaption={model.status || t`Set up on the host`}
                        {...(!unavailable && isFreeModel(model)
                          ? {
                              // What the "Free only" segment filters on, said on
                              // the row itself: a name ending in "Free" is the
                              // publisher's word for it, not the price list's.
                              meta: (
                                <View
                                  style={[
                                    styles.freeChip,
                                    { backgroundColor: withAlpha(theme.colors.success, 0.14) },
                                  ]}>
                                  <Text
                                    variant="caption"
                                    weight="semibold"
                                    color={theme.colors.success}>
                                    {t`Free`}
                                  </Text>
                                </View>
                              ),
                            }
                          : {})}
                        onPress={() =>
                          selectModel({
                            provider_id: model.provider_id,
                            model_id: model.id,
                            variant: isSelected
                              ? effectiveModel?.variant
                              : (variants.find((v) => v.id === 'high')?.id ?? variants[0]?.id),
                          })
                        }
                        trailing={
                          isSelected && !unavailable && variants.length > 0 ? (
                            <View style={styles.variants}>
                              {variants.map((variant) => {
                                const active = (effectiveModel?.variant || 'high') === variant.id;
                                return (
                                  <PressableScale
                                    key={variant.id}
                                    accessibilityRole="button"
                                    accessibilityState={{ selected: active }}
                                    accessibilityLabel={variant.id}
                                    onPress={() =>
                                      selectModel({
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
          {hasMore ? (
            // Scrolling loads the next page on its own; the row is for a
            // reader who cannot scroll, and it says how much is left.
            <PressableScale
              testID="agent-model-more"
              accessibilityRole="button"
              accessibilityLabel={t`Show more models`}
              onPress={loadMore}
              style={styles.more}>
              <Text variant="caption" color={theme.colors.textMuted}>
                {t`${paged.total - paged.shown} more models`}
              </Text>
            </PressableScale>
          ) : null}
          <SheetSceneFooter bottomInset={insets.bottom} />
        </ScrollView>
      )}
    </SheetScene>
  );
});

const styles = StyleSheet.create({
  more: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  loading: { padding: 40, alignItems: 'center', justifyContent: 'center' },
  empty: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: SHEET_LADDER.gap,
  },
  retry: {
    paddingHorizontal: SHEET_LADDER.snug,
    paddingVertical: 6,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
  },
  variants: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SHEET_LADDER.gap,
    paddingBottom: SHEET_LADDER.snug,
  },
  freeChip: {
    paddingHorizontal: SHEET_LADDER.gap,
    paddingVertical: 2,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
  },
  variantChip: {
    paddingHorizontal: SHEET_LADDER.snug,
    paddingVertical: 5,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
  },
  variantChipText: { textTransform: 'capitalize', includeFontPadding: false },
});

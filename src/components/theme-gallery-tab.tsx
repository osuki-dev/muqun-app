import { useLingui } from '@lingui/react/macro';
import { Button, PressableScale, Text, useThemeTokens } from '@osuki-dev/ui';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { ListLoadMoreFooter } from '@/components/list-load-more-footer';
import { SheetSceneSearch, SHEET_LADDER } from '@/components/sheet-scene';
import {
  ThemeCard,
  ThemeCardPreview,
  ThemeCardSkeleton,
  type ThemeCardAction,
} from '@/components/theme-card';
import { ThemeGrid } from '@/components/theme-grid';
import type { ThemeGallery } from '@/hooks/use-theme-gallery';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { formatAssetSize } from '@/lib/asset-display';
import { fadeIn, STAGGER } from '@/lib/motion';
import { THEME_PICKER_MAX_CONTENT_WIDTH } from '@/lib/theme-picker-layout';
import type { ThemeIndexEntry } from '@/theme/gallery';
import type { InstalledTheme } from '@/theme/repository';

/** How far into a page the arrival stagger keeps counting. */
const STAGGER_CAP = 8;

/** Placeholders while the index is read: two rows of a phone grid. */
const SKELETONS = ['s0', 's1', 's2', 's3', 's4', 's5'] as const;

type GalleryItem = ThemeIndexEntry | (typeof SKELETONS)[number];

/**
 * The published themes, as the third tab of the themes sheet.
 *
 * The search field and the tag chips stay above the grid while it scrolls --
 * they are this tab's own header, outside the scroller -- and everything below
 * them is the shared card grid. The data and the install are `useThemeGallery`'s,
 * owned by the sheet, so leaving this tab neither cancels an install nor
 * forgets the catalogue.
 *
 * A card that is installed already says so; pressing it opens the copy the
 * reader has rather than downloading another, unless the catalogue has a newer
 * version. Pressing any other card downloads it, with the progress on the
 * card's own edge, and opens the detail when it is ready.
 */
export function ThemeGalleryTab({
  gallery,
  installed,
  currentCustomId,
  rises,
  revealed,
  onOpenInstalled,
  actionsFor,
  onMenu,
}: {
  gallery: ThemeGallery;
  installed: readonly InstalledTheme[];
  currentCustomId: string | null;
  /** Whether cards not yet seen rise in: the first load, never a tab switch. */
  rises: boolean;
  revealed: Set<string>;
  onOpenInstalled: (theme: InstalledTheme) => void;
  actionsFor: (theme: InstalledTheme) => readonly ThemeCardAction[];
  onMenu: (title: string, actions: readonly ThemeCardAction[]) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const {
    demo,
    entries,
    failed,
    query,
    needle,
    setQuery,
    tags,
    visible,
    shown,
    total,
    pageStart,
    appending,
    appendPage,
    pending,
    progress,
  } = gallery;

  const installedById = new Map(installed.map((entry) => [entry.manifest.id, entry]));
  const installedKey = installed
    .map((entry) => `${entry.manifest.id}:${entry.manifest.version}`)
    .join(',');

  const counted = progress && progress.phase !== 'downloading' ? progress : null;
  const stepLabel = !progress
    ? ''
    : progress.phase === 'unpacking'
      ? t`Unpacking…`
      : progress.phase === 'assets'
        ? t`Preparing images`
        : t`Downloading…`;
  const stepCount = counted ? `${counted.completed}/${counted.total}` : '';

  /**
   * Everything a card draws that is not its own entry. The list memoises a
   * cell on its item and this, so without it the pressed card would keep the
   * markup it was first rendered with and its progress could never appear.
   */
  const cardState = [
    pending ?? '',
    progress?.phase ?? '',
    counted?.completed ?? '',
    counted?.total ?? '',
    gallery.brokenCount,
    installedKey,
    currentCustomId ?? '',
    pageStart,
    rises ? 1 : 0,
  ].join('|');

  const loading = entries === null && !failed;
  const data: readonly GalleryItem[] = loading ? SKELETONS : visible;

  function press(entry: ThemeIndexEntry) {
    const mine = installedById.get(entry.id);
    if (mine && mine.manifest.version === entry.version) onOpenInstalled(mine);
    else gallery.install(entry);
  }

  const failure = (
    <Animated.View
      key="failed"
      entering={fadeIn('medium')}
      testID="theme-browse-empty"
      style={styles.state}>
      <Text variant="bodySmall">{t`Could not reach the theme catalogue`}</Text>
      <Text variant="caption" color={theme.colors.textMuted}>
        {t`Check your connection and try again.`}
      </Text>
      <View style={styles.stateAction}>
        <Button
          variant="secondary"
          disabled={demo || pending !== null}
          testID="theme-browse-retry"
          onPress={gallery.retry}>{t`Try again`}</Button>
      </View>
    </Animated.View>
  );

  const empty = failed ? (
    failure
  ) : needle ? (
    <Animated.View
      key="no-match"
      entering={fadeIn('medium')}
      testID="theme-browse-no-match"
      style={styles.state}>
      <Text variant="bodySmall">{t`No themes match “${query.trim()}”.`}</Text>
      <Text variant="caption" color={theme.colors.textMuted}>
        {t`Try searching for another name or tag.`}
      </Text>
      <View style={styles.stateAction}>
        <Button variant="secondary" testID="theme-browse-clear-search" onPress={() => setQuery('')}>
          {t`Clear the search`}
        </Button>
      </View>
    </Animated.View>
  ) : (
    <Animated.View
      key="none"
      entering={fadeIn('medium')}
      testID="theme-browse-empty"
      style={styles.state}>
      <Text color={theme.colors.textMuted}>{t`No themes are published yet`}</Text>
    </Animated.View>
  );

  const footer =
    !loading && total > 0 ? (
      <>
        {/* A package that failed with cards on screen: the recovery is the
            catalogue's Retry, said once under the grid rather than on a card
            that may have scrolled away. */}
        {failed ? <View style={styles.footerFailure}>{failure}</View> : null}
        <ListLoadMoreFooter
          testID="theme-browse-page-status"
          buttonTestID="theme-browse-more"
          hasMore={shown < total}
          loading={appending}
          onLoadMore={appendPage}
          shown={shown}
          total={total}
          disabled={pending !== null}>
          {demo ? (
            <Text variant="caption" color={theme.colors.textMuted} style={styles.centered}>
              {t`Demo catalogue. Leave the demo to download themes.`}
            </Text>
          ) : null}
        </ListLoadMoreFooter>
      </>
    ) : null;

  return (
    <View style={styles.tab}>
      {entries && entries.length > 0 && !(failed && visible.length === 0) ? (
        <GallerySearch query={query} needle={needle} tags={tags} onQuery={setQuery} />
      ) : null}
      <ThemeGrid<GalleryItem>
        testID="theme-browse-list"
        data={data}
        keyOf={keyOfItem}
        extraData={cardState}
        onEndReached={appendPage}
        empty={loading ? null : empty}
        footer={footer}
        renderCard={(item, index, layout) => {
          if (typeof item === 'string')
            return (
              <ThemeCardSkeleton
                layout={layout}
                accessibilityLabel={index === 0 ? t`Loading themes…` : undefined}
              />
            );
          const mine = installedById.get(item.id);
          const hasUpdate = Boolean(mine && mine.manifest.version !== item.version);
          const isPending = pending === item.id;
          const isCurrent = Boolean(mine && mine.id === currentCustomId);
          const caption = isPending
            ? [stepLabel, stepCount].filter(Boolean).join(' ')
            : [formatAssetSize(item.bytes), item.author].filter(Boolean).join(' · ');
          const actions = mine ? actionsFor(mine) : undefined;
          const state = [
            isCurrent ? t`Current` : null,
            hasUpdate ? t`Update` : mine ? t`Installed` : null,
          ]
            .filter(Boolean)
            .join(', ');
          return (
            <ThemeCard
              testID={`theme-browse-item:${item.id}`}
              name={item.name}
              caption={caption}
              captionKey={isPending ? 'step' : 'size'}
              layout={layout}
              current={isCurrent}
              badge={isPending ? null : hasUpdate ? t`Update` : mine ? t`Installed` : null}
              progress={
                isPending
                  ? counted
                    ? counted.completed / Math.max(counted.total, 1)
                    : null
                  : undefined
              }
              dimmed={pending !== null && !isPending}
              disabled={demo || (pending !== null && !isPending)}
              rise={{
                revealed,
                key: `gallery:${item.id}`,
                delay: Math.min(Math.max(index - pageStart, 0), STAGGER_CAP) * STAGGER.row,
                enabled: rises,
              }}
              accessibilityLabel={state ? `${item.name}, ${state}` : item.name}
              accessibilityValue={isPending && stepLabel ? { text: caption } : undefined}
              actions={actions}
              onPress={() => (isPending ? undefined : press(item))}
              onLongPress={actions?.length ? () => onMenu(item.name, actions) : undefined}
              preview={
                <ThemeCardPreview
                  image={gallery.coverOf(item)}
                  cachePolicy="memory-disk"
                  recyclingKey={item.id}
                  imageTestID={`theme-browse-preview:${item.id}`}
                  onImageError={() => gallery.markCoverBroken(item.id)}
                />
              }
            />
          );
        }}
      />
    </View>
  );
}

function keyOfItem(item: GalleryItem): string {
  return typeof item === 'string' ? item : item.id;
}

/**
 * The search field and the most used tags, pinned above the grid.
 *
 * A tag is a search for that tag, so the chips and the field are one control
 * said two ways: choosing a chip fills the field, and clearing the field
 * returns the selection to All.
 */
function GallerySearch({
  query,
  needle,
  tags,
  onQuery,
}: {
  query: string;
  needle: string;
  tags: readonly string[];
  onQuery: (next: string) => void;
}) {
  const { t } = useLingui();
  return (
    <View style={styles.search}>
      <SheetSceneSearch
        testID="theme-browse-search-input"
        accessibilityLabel={t`Search by name or tag`}
        placeholder={t`Search by name or tag`}
        clearAccessibilityLabel={t`Clear the search`}
        value={query}
        onChangeText={onQuery}
      />
      {tags.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.tagsContent}
          style={styles.tags}>
          <TagChip
            label={t`All`}
            testID="theme-browse-tag-all"
            selected={needle === ''}
            onPress={() => onQuery('')}
          />
          {tags.map((tag) => {
            const selected = needle === tag.toLowerCase();
            return (
              <TagChip
                key={tag}
                label={tag}
                testID={`theme-browse-tag-${tag}`}
                selected={selected}
                onPress={() => onQuery(selected ? '' : tag)}
              />
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

/** One tag. Its fill goes through the reader's opacity; the selected one is a mark. */
function TagChip({
  label,
  testID,
  selected,
  onPress,
}: {
  label: string;
  testID: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const surfaceBackground = useSurfaceBackground();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      testID={testID}
      onPress={onPress}
      style={[
        styles.chip,
        { borderRadius: profile.chrome.segmentedOption },
        selected
          ? { backgroundColor: theme.colors.primary }
          : {
              backgroundColor: surfaceBackground(theme.colors.surfaceRaised),
              borderColor: theme.colors.border,
            },
      ]}>
      <Text
        variant="caption"
        weight={selected ? 'semibold' : 'regular'}
        color={selected ? theme.colors.onPrimary : theme.colors.textMuted}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tab: { flex: 1, minHeight: 0 },
  search: {
    width: '100%',
    maxWidth: THEME_PICKER_MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: SHEET_LADDER.gutter,
    gap: SHEET_LADDER.gap,
    paddingBottom: SHEET_LADDER.tight,
  },
  tags: { marginHorizontal: -SHEET_LADDER.gutter },
  tagsContent: {
    paddingHorizontal: SHEET_LADDER.gutter,
    gap: 8,
    alignItems: 'center',
    paddingVertical: 2,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    minHeight: 30,
    justifyContent: 'center',
    alignItems: 'center',
  },
  state: { gap: SHEET_LADDER.gap, paddingTop: SHEET_LADDER.gap },
  stateAction: { flexDirection: 'row' },
  footerFailure: { paddingTop: SHEET_LADDER.gap },
  centered: { textAlign: 'center' },
});

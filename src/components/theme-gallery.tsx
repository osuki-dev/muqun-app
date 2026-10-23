import { useSideBleed } from '@/hooks/use-side-insets';
import { useLingui } from '@lingui/react/macro';
import { Button, Text, useThemeTokens } from '@osuki-dev/ui';
import { PressableScale } from '@/components/pressable-scale';
import { ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { ListLoadMoreFooter } from '@/components/list-load-more-footer';
import { SheetSceneSearch, SHEET_LADDER } from '@/components/sheet-scene';
import {
  ThemeCard,
  ThemeCardPreview,
  type CardRise,
  type ThemeCardAction,
  type ThemeGridLayout,
} from '@/components/theme-card';
import type { ThemeGallery } from '@/hooks/use-theme-gallery';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { formatAssetSize } from '@/lib/asset-display';
import { fadeIn } from '@/lib/motion';
import type { ThemeIndexEntry } from '@/theme/gallery';
import type { InstalledTheme } from '@/theme/repository';

/**
 * The published themes' pieces, as rows of the themes sheet's one list.
 *
 * The data and the install are `useThemeGallery`'s, owned by the sheet, so
 * leaving the Gallery tab neither cancels an install nor forgets the
 * catalogue. A card that is installed already says so; pressing it opens the
 * copy the reader has rather than downloading another, unless the catalogue
 * has a newer version. Pressing any other card downloads it, with the progress
 * on the card's own edge, and opens the detail when it is ready.
 */

/** The install step a card says while it is the one installing. */
export function useGalleryStep(gallery: ThemeGallery) {
  const { t } = useLingui();
  const { progress } = gallery;
  const counted = progress && progress.phase !== 'downloading' ? progress : null;
  const label = !progress
    ? ''
    : progress.phase === 'unpacking'
      ? t`Unpacking…`
      : progress.phase === 'assets'
        ? t`Preparing images`
        : t`Downloading…`;
  return {
    label,
    count: counted ? `${counted.completed}/${counted.total}` : '',
    fraction: counted ? counted.completed / Math.max(counted.total, 1) : null,
  };
}

export function GalleryCard({
  entry,
  gallery,
  mine,
  currentCustomId,
  layout,
  rise,
  actions,
  onOpenInstalled,
  onMenu,
}: {
  entry: ThemeIndexEntry;
  gallery: ThemeGallery;
  /** The reader's installed copy, matched by the manifest id the catalogue lists. */
  mine: InstalledTheme | undefined;
  currentCustomId: string | null;
  layout: ThemeGridLayout;
  rise: CardRise;
  actions: readonly ThemeCardAction[] | undefined;
  onOpenInstalled: (theme: InstalledTheme) => void;
  onMenu: (title: string, actions: readonly ThemeCardAction[]) => void;
}) {
  const { t } = useLingui();
  const step = useGalleryStep(gallery);
  const { pending, demo } = gallery;
  const hasUpdate = Boolean(mine && mine.manifest.version !== entry.version);
  const isPending = pending === entry.id;
  const isCurrent = Boolean(mine && mine.id === currentCustomId);
  const caption = isPending
    ? [step.label, step.count].filter(Boolean).join(' ')
    : [formatAssetSize(entry.bytes), entry.author].filter(Boolean).join(' · ');
  const badge = hasUpdate ? t`Update` : mine ? t`Installed` : null;
  const state = [isCurrent ? t`Current` : null, badge].filter(Boolean).join(', ');

  function press() {
    if (isPending) return;
    if (mine && !hasUpdate) onOpenInstalled(mine);
    else gallery.install(entry);
  }

  return (
    <ThemeCard
      testID={`theme-browse-item:${entry.id}`}
      name={entry.name}
      caption={caption}
      captionKey={isPending ? 'step' : 'size'}
      layout={layout}
      current={isCurrent}
      badge={isPending ? null : badge}
      progress={isPending ? step.fraction : undefined}
      dimmed={pending !== null && !isPending}
      disabled={demo || (pending !== null && !isPending)}
      rise={rise}
      accessibilityLabel={state ? `${entry.name}, ${state}` : entry.name}
      accessibilityValue={isPending && step.label ? { text: caption } : undefined}
      actions={actions}
      onPress={press}
      onLongPress={actions?.length ? () => onMenu(entry.name, actions) : undefined}
      preview={
        <ThemeCardPreview
          image={gallery.coverOf(entry)}
          cachePolicy="memory-disk"
          recyclingKey={entry.id}
          imageTestID={`theme-browse-preview:${entry.id}`}
          onImageError={() => gallery.markCoverBroken(entry.id)}
        />
      }
    />
  );
}

/**
 * The search field and the most used tags, stuck to the top of the list while
 * the cards scroll under them.
 *
 * The sheet gives it an opaque plate: the cards pass beneath it and must not
 * read through it. A tag is a search for
 * that tag, so choosing a chip fills the field, and clearing the field returns
 * the selection to All.
 */
export function GallerySearch({ gallery }: { gallery: ThemeGallery }) {
  const { t } = useLingui();
  const { query, needle, tags, setQuery } = gallery;
  // Past the sheet's gutter, and under a side status bar to the sheet's edge.
  const bleed = useSideBleed(SHEET_LADDER.gutter);
  return (
    <View style={styles.search}>
      <SheetSceneSearch
        testID="theme-browse-search-input"
        accessibilityLabel={t`Search by name or tag`}
        placeholder={t`Search by name or tag`}
        clearAccessibilityLabel={t`Clear the search`}
        value={query}
        onChangeText={setQuery}
      />
      {tags.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[styles.tagsContent, bleed.content]}
          style={[
            styles.tags,
            {
              marginLeft: bleed.frame.marginLeft - SHEET_LADDER.gutter,
              marginRight: bleed.frame.marginRight - SHEET_LADDER.gutter,
            },
          ]}>
          <TagChip
            label={t`All`}
            testID="theme-browse-tag-all"
            selected={needle === ''}
            onPress={() => setQuery('')}
          />
          {tags.map((tag) => {
            const selected = needle === tag.toLowerCase();
            return (
              <TagChip
                key={tag}
                label={tag}
                testID={`theme-browse-tag-${tag}`}
                selected={selected}
                onPress={() => setQuery(selected ? '' : tag)}
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
              borderColor: 'transparent',
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

/**
 * What the gallery says when it has no cards to show, or when an install
 * failed: one message, and the one action that recovers from it.
 */
export function GalleryNote({
  kind,
  gallery,
}: {
  kind: 'failed' | 'no-match' | 'none';
  gallery: ThemeGallery;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  if (kind === 'failed')
    return (
      <Animated.View entering={fadeIn('medium')} testID="theme-browse-empty" style={styles.note}>
        <Text variant="bodySmall">{t`Could not reach the theme catalogue`}</Text>
        <Text variant="caption" color={theme.colors.textMuted}>
          {t`Check your connection and try again.`}
        </Text>
        <View style={styles.noteAction}>
          <Button
            variant="secondary"
            disabled={gallery.demo || gallery.pending !== null}
            testID="theme-browse-retry"
            onPress={gallery.retry}>{t`Try again`}</Button>
        </View>
      </Animated.View>
    );
  if (kind === 'no-match')
    return (
      <Animated.View entering={fadeIn('medium')} testID="theme-browse-no-match" style={styles.note}>
        <Text variant="bodySmall">{t`No themes match “${gallery.query.trim()}”.`}</Text>
        <Text variant="caption" color={theme.colors.textMuted}>
          {t`Try searching for another name or tag.`}
        </Text>
        <View style={styles.noteAction}>
          <Button
            variant="secondary"
            testID="theme-browse-clear-search"
            onPress={() => gallery.setQuery('')}>
            {t`Clear the search`}
          </Button>
        </View>
      </Animated.View>
    );
  return (
    <Animated.View entering={fadeIn('medium')} testID="theme-browse-empty" style={styles.note}>
      <Text color={theme.colors.textMuted}>{t`No themes are published yet`}</Text>
    </Animated.View>
  );
}

/**
 * The end of the catalogue in view: the next page loading, or how much of it
 * is showing. Pages are filtered first and paged after, so a search covers the
 * whole catalogue.
 */
export function GalleryFooter({ gallery }: { gallery: ThemeGallery }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const { shown, total, appending, appendPage, pending, demo } = gallery;
  return (
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
  );
}

const styles = StyleSheet.create({
  search: {
    gap: SHEET_LADDER.gap,
    paddingTop: SHEET_LADDER.tight,
    paddingBottom: SHEET_LADDER.gap,
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
  note: {
    gap: SHEET_LADDER.gap,
    paddingTop: SHEET_LADDER.gap,
    paddingBottom: SHEET_LADDER.section,
  },
  noteAction: { flexDirection: 'row' },
  centered: { textAlign: 'center' },
});

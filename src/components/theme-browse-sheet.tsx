import { LegendList } from '@legendapp/list/react-native';
import { useLingui } from '@lingui/react/macro';
import { Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { LADDER } from '@/components/settings-chrome';
import { ThemeArtwork } from '@/components/theme-artwork';
import { ThemeImportProgress } from '@/components/theme-import-progress';
import { Button } from '@/components/themed-button';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { formatAssetSize } from '@/lib/asset-display';
import { DURATION, fadeIn, fadeOut, listLayout, riseIn, STAGGER, timing } from '@/lib/motion';
import { useRenderTally } from '@/lib/render-tally';
import { THEME_PICKER_MAX_CONTENT_WIDTH } from '@/lib/theme-picker-layout';
import { throwIfThemeAborted } from '@/theme/abort';
import type { ThemeAssetProgress } from '@/theme/asset-stream';
import { prepareThemeAssetStream, type PreparedThemeAssets } from '@/theme/assets';
import type { ThemeEditorCandidate } from '@/theme/draft-session';
import {
  loadThemeIndex,
  themePackageUrl,
  themePreviewUrl,
  type ThemeIndexEntry,
} from '@/theme/gallery';
import { cachedThemeIndex, clearThemeIndex, putThemeIndex } from '@/theme/gallery-cache';
import { ThemeImportRequest } from '@/theme/import-request';
import { publicThemeTransport } from '@/theme/public-transport';
import { inspectRemoteTheme } from '@/theme/remote-import';
import { useThemeLibrary } from '@/stores/theme-library';

/**
 * The published themes, as a sheet of their own, with nothing downloaded until
 * one is chosen.
 *
 * This used to be an inline panel inside the theme sheet, capped at a 420pt
 * `ScrollView` under an already-long scroll. Browsing a catalogue is a whole
 * screen's worth of question, so it became one: a virtualized list, a cover per
 * row, and client-side paging so that opening it does not start sixty image
 * requests.
 *
 * The index is read once when this opens -- from the process cache when it is
 * fresh -- and carries everything a row draws, so the list itself costs one
 * small request no matter how long the catalogue grows. A package is a
 * different matter: the format allows 25 MiB, so a row shows its size and
 * downloads nothing until it is pressed.
 *
 * Cancellation is `ThemeGallery`'s, carried over intact and for the unchanged
 * reason: a download that finishes after the screen is gone has staged assets
 * that nothing will ever dispose. One owned request at a time, unmount cancels
 * it, `handoff` is the single ownership boundary, and `finally` disposes
 * whatever did not transfer. Moving this to a route makes unmount *more* likely
 * -- a swipe dismisses a form sheet -- so none of it is rewritten here.
 */

/** One page of rows. See the footer: paging is a press, never a scroll. */
const THEME_BROWSE_PAGE = 20;

/**
 * How far into a page the arrival stagger keeps counting.
 *
 * Twenty rows at `STAGGER.row` each would take 640ms to finish arriving, which
 * is a list the reader waits for. Capping the *index* puts a ceiling of 8
 * beats on the lead-in. An index, not a duration -- there is no token for the
 * ninth row.
 */
const THEME_BROWSE_STAGGER_CAP = 8;

/** 8:5, the shape `skills/muqun-theme` asks every cover to be published in. */
const PREVIEW_ASPECT = 1.6;

/** Name, author, description, size: four capped lines plus the row's padding. */
const ROW_TEXT_HEIGHT = 96;

type BrowseRowType = 'preview' | 'plain';

export function ThemeBrowseSheet({
  onClose,
  onReady,
}: {
  onClose: () => void;
  onReady: (candidate: ThemeEditorCandidate) => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  useRenderTally('ThemeBrowseSheet');
  const { width: windowWidth } = useWindowDimensions();
  const installed = useThemeLibrary((state) => state.library.themes);

  const [entries, setEntries] = useState<ThemeIndexEntry[] | null>(() => cachedThemeIndex());
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState(THEME_BROWSE_PAGE);
  // Where the page in view began, so an appended page starts its own sequence
  // at zero rather than continuing from twenty and arriving half a second late.
  const [pageStart, setPageStart] = useState(0);
  // Which row is downloading. A row, not a boolean: the progress belongs under
  // the theme it is for, and a second press elsewhere must not look like it did
  // something.
  const [pending, setPending] = useState<string | null>(null);
  const [progress, setProgress] = useState<ThemeAssetProgress | null>(null);
  // Covers that screened, were requested, and did not paint. A row keeps its
  // placeholder and its plain height bucket rather than a broken picture.
  const [brokenCovers, setBrokenCovers] = useState<readonly string[]>([]);
  // Ids whose arrival has already been spent. Not a ref: a ref may not be read
  // during render, and the row that decides whether to animate is a render.
  // Mutated only from the row's mount effect.
  const [revealed] = useState(() => new Set<string>());
  const [contentWidth, setContentWidth] = useState(0);

  const active = useRef<ThemeImportRequest | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      active.current?.cancel();
      active.current = null;
    };
  }, []);

  useEffect(() => {
    if (entries !== null) return;
    if (!publicThemeTransport) {
      setFailed(true);
      return;
    }
    const read = new ThemeImportRequest();
    void (async () => {
      try {
        const list = await loadThemeIndex(publicThemeTransport, read.signal);
        if (!mounted.current || read.isCanceled) return;
        putThemeIndex(list);
        setEntries(list);
      } catch {
        // The thrown message is a plain English module string and is in no
        // catalog. A full-width empty state is the last place to show one.
        if (mounted.current && !read.isCanceled) setFailed(true);
      }
    })();
    return () => read.cancel();
    // `attempt` is what `Try again` bumps; `entries` is the guard that stops a
    // re-read of a catalogue already in hand.
  }, [attempt, entries]);

  function retry() {
    clearThemeIndex();
    setFailed(false);
    setEntries(null);
    setShown(THEME_BROWSE_PAGE);
    setPageStart(0);
    setAttempt((value) => value + 1);
  }

  function open(entry: ThemeIndexEntry) {
    if (!publicThemeTransport || active.current) return;
    const owned = new ThemeImportRequest();
    active.current = owned;
    setPending(entry.id);
    setFailed(false);
    void (async () => {
      const { signal } = owned;
      let prepared: PreparedThemeAssets | undefined;
      let transferred = false;
      try {
        // `format: 'package'` because a catalogue entry is always a packed
        // `.muqun-theme`. Its assets come out of the archive rather than off
        // the network, so there are no third-party domains for a reader to
        // review -- one download, from the origin they already chose.
        const inspection = await inspectRemoteTheme(publicThemeTransport, themePackageUrl(entry), {
          signal,
          format: 'package',
        });
        throwIfThemeAborted(signal);
        prepared = await prepareThemeAssetStream(inspection.manifest, inspection.assets(signal), {
          signal,
          onProgress(value) {
            if (mounted.current && !signal.aborted) setProgress(value);
          },
        });
        throwIfThemeAborted(signal);
        if (!mounted.current) return;
        const candidate = { manifest: inspection.manifest, prepared };
        owned.handoff(() => onReady(candidate));
        transferred = true;
      } catch {
        // Same argument as the index read: the module's message is English.
        if (mounted.current && active.current === owned && !owned.isCanceled) setFailed(true);
      } finally {
        if (!transferred) prepared?.dispose();
        if (active.current === owned) active.current = null;
        if (mounted.current) {
          setPending(null);
          setProgress(null);
        }
      }
    })();
  }

  const total = entries?.length ?? 0;
  const rows = entries ? entries.slice(0, shown) : [];
  const installedIds = new Set(installed.map((entry) => entry.manifest.id));
  const broken = new Set(brokenCovers);
  const measured =
    contentWidth ||
    Math.min(THEME_PICKER_MAX_CONTENT_WIDTH, Math.max(0, windowWidth)) - LADDER.gutter * 2;

  function coverOf(entry: ThemeIndexEntry): string | null {
    if (broken.has(entry.id)) return null;
    return themePreviewUrl(entry);
  }

  /**
   * The one failure this screen has, said once.
   *
   * It covers the index read not succeeding, `publicThemeTransport` being null
   * on this build, and a package download that did not finish: all three are
   * the catalogue's own origin not answering, they read the same to a reader,
   * and the recovery is the same button. Translated copy rather than the thrown
   * message, because errors raised inside `src/theme/*` are plain English
   * module strings and are in no catalog.
   */
  const failure = (
    <Animated.View
      key="failed"
      entering={fadeIn('short')}
      testID="theme-browse-empty"
      style={styles.stateBlock}>
      <Text variant="bodySmall">{t`Could not reach the theme catalogue`}</Text>
      <Text
        variant="caption"
        color={theme.colors.textMuted}>{t`Check your connection and try again.`}</Text>
      <View style={styles.stateAction}>
        <Button
          variant="secondary"
          disabled={pending !== null}
          testID="theme-browse-retry"
          onPress={retry}>{t`Try again`}</Button>
      </View>
    </Animated.View>
  );

  const header = (
    <View style={styles.headerBlock}>
      {/* iOS draws the grabber itself; Android's form sheet does not, and a
          sheet with no handle reads as a screen that arrived from the wrong
          direction. The same two lines the settings sheet carries. */}
      {process.env.EXPO_OS === 'android' ? <View style={styles.handle} /> : null}
      <View style={styles.header}>
        <View style={styles.flexOne}>
          <Text variant="bodySmall" style={styles.headerTitle}>
            {t`Browse themes`}
          </Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            {t`Themes published at muqun.dev. Nothing downloads until you open one.`}
          </Text>
        </View>
        <GlassChrome face="sheet" style={styles.closeButton}>
          <PressableScale
            accessibilityLabel={t`Close theme catalogue`}
            disabled={pending !== null}
            onPress={onClose}
            style={styles.closeHit}>
            <X size={18} color={theme.colors.text} />
          </PressableScale>
        </GlassChrome>
      </View>
      {/* A download that failed with a list already on screen. The empty
          component below never renders in that case, and a press that ends in
          nothing at all is the app looking like it ignored it. */}
      {failed && rows.length ? (
        <Animated.View layout={listLayout('short')}>{failure}</Animated.View>
      ) : null}
    </View>
  );

  const empty = (
    <Animated.View layout={listLayout('short')} style={styles.state}>
      {failed ? (
        failure
      ) : entries === null ? (
        <Animated.View
          key="loading"
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          testID="theme-browse-loading"
          style={styles.loading}>
          <Spinner size="sm" color={theme.colors.textMuted} />
          <Text color={theme.colors.textMuted}>{t`Loading themes…`}</Text>
        </Animated.View>
      ) : (
        <Animated.View
          key="none"
          entering={fadeIn('short')}
          testID="theme-browse-none"
          style={styles.stateBlock}>
          <Text color={theme.colors.textMuted}>{t`No themes are published yet`}</Text>
        </Animated.View>
      )}
    </Animated.View>
  );

  // A footer, not `onEndReached`: every newly shown row starts an image
  // request, and infinite scroll would fetch covers faster than anyone reads
  // them. The footer says what it will do before it does it.
  const footer =
    entries && shown < total ? (
      <Animated.View layout={listLayout('short')} style={styles.footer}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t`Load more`}
          testID="theme-browse-more"
          disabled={pending !== null}
          onPress={() => {
            setPageStart(shown);
            setShown((value) => value + THEME_BROWSE_PAGE);
          }}
          style={[styles.more, { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) }]}>
          <Text variant="bodySmall">{t`Load more`}</Text>
          <Text variant="caption" color={theme.colors.textMuted}>
            {t`Showing ${shown} of ${total}`}
          </Text>
        </PressableScale>
      </Animated.View>
    ) : null;

  return (
    <>
      {/* The ground the theme sheet has, because to a reader these two are one
          place. `SessionArtifacts` paints a flat surface instead; that is the
          Files sheet's answer to the same question, and a designer may yet
          want it changed rather than this one matching it. */}
      <View
        testID="settings-sheet-scene"
        pointerEvents="none"
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={StyleSheet.absoluteFill}>
        <ThemeArtwork slot="shell.background" />
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: surfaceBackground(theme.colors.surface) },
          ]}
        />
      </View>
      <LegendList
        testID="theme-browse-list"
        data={rows}
        keyExtractor={keyOfEntry}
        // Entries are stable objects straight out of the parsed index and are
        // never rebuilt per render, so the strictest comparison is both the
        // correct one and the cheapest.
        itemsAreEqual={entriesAreEqual}
        // Never. A row owns a preview image, and recycling would hand one
        // theme's cover to another.
        recycleItems={false}
        getItemType={(entry: ThemeIndexEntry): BrowseRowType =>
          coverOf(entry) ? 'preview' : 'plain'
        }
        // Legend List takes one hint and then learns a real average per type,
        // which is what `getItemType` is for. The hint is the tall bucket,
        // computed off the measured width rather than guessed, so a Pad does
        // not start out with a phone's idea of a row.
        estimatedItemSize={Math.round(measured / PREVIEW_ASPECT) + ROW_TEXT_HEIGHT}
        renderItem={({ item, index }) => (
          <ThemeBrowseRow
            entry={item}
            cover={coverOf(item)}
            installed={installedIds.has(item.id)}
            pending={pending === item.id}
            dimmed={pending !== null && pending !== item.id}
            disabled={pending !== null}
            progress={pending === item.id ? progress : null}
            revealed={revealed}
            delay={Math.min(Math.max(index - pageStart, 0), THEME_BROWSE_STAGGER_CAP) * STAGGER.row}
            onPress={() => open(item)}
            onCoverError={() =>
              setBrokenCovers((value) => (value.includes(item.id) ? value : [...value, item.id]))
            }
          />
        )}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={styles.listHeader}
        ListEmptyComponent={empty}
        ListFooterComponent={footer}
        onLayout={(event: LayoutChangeEvent) =>
          setContentWidth(Math.max(0, event.nativeEvent.layout.width - LADDER.gutter * 2))
        }
        style={styles.sheet}
        // `flexGrow` is what makes this a full-height sheet: the route asks for
        // a single detent, and react-native-screens answers a single detent
        // with a sheet as tall as the content laid out to. Without it a short
        // catalogue gives a short sheet and an empty one gives a stub.
        contentContainerStyle={styles.listContent}
      />
    </>
  );
}

function keyOfEntry(entry: ThemeIndexEntry): string {
  return entry.id;
}

function entriesAreEqual(previous: ThemeIndexEntry, next: ThemeIndexEntry): boolean {
  return previous === next;
}

/**
 * One catalogue entry: its cover, its name, what it costs, and who wrote it.
 *
 * The `Installed` badge is a hint rather than a guarantee. Installation
 * identity is local and content-hashed while the manifest `id` is
 * author-provided and untrusted, so two different packs can claim one id --
 * which is why the badge never disables the row. Pressing still opens the
 * preview, and that is where a duplicate is resolved.
 */
function ThemeBrowseRow({
  entry,
  cover,
  installed,
  pending,
  dimmed,
  disabled,
  progress,
  revealed,
  delay,
  onPress,
  onCoverError,
}: {
  entry: ThemeIndexEntry;
  cover: string | null;
  installed: boolean;
  pending: boolean;
  dimmed: boolean;
  disabled: boolean;
  progress: ThemeAssetProgress | null;
  revealed: Set<string>;
  delay: number;
  onPress: () => void;
  onCoverError: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();

  // Spent once. Legend List mounts and unmounts rows as they cross the
  // viewport even with recycling off, so without this the whole list
  // re-animates every time it is scrolled back -- the difference between a
  // list that arrives and a list that flickers.
  const [entering] = useState(() => (revealed.has(entry.id) ? undefined : riseIn(delay)));
  useEffect(() => {
    revealed.add(entry.id);
  }, [revealed, entry.id]);

  // Twenty rows changing on one frame reads as a flash. Eased, they read as
  // the list settling around the one that was pressed.
  const dim = useSharedValue(dimmed ? 0.5 : 1);
  useEffect(() => {
    dim.value = withTiming(dimmed ? 0.5 : 1, timing('short'));
  }, [dim, dimmed]);
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));

  return (
    <Animated.View entering={entering} layout={listLayout('short')} style={dimStyle}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={entry.name}
        accessibilityState={{ disabled }}
        testID={`theme-browse-item:${entry.id}`}
        disabled={disabled}
        onPress={onPress}
        style={[styles.row, { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) }]}>
        <View style={styles.cover}>
          {/* The placeholder is always underneath, so the image's own fade is
              a cross-fade onto a surface that is already the right colour --
              no flash of sheet background, and no extra code. The index
              carries no palette of its own, so the two swatches are the
              sheet's rather than the theme's. */}
          <View
            accessible={false}
            style={[
              StyleSheet.absoluteFill,
              styles.placeholder,
              { backgroundColor: surfaceBackground(theme.colors.background) },
            ]}>
            <View style={[styles.swatch, { backgroundColor: theme.colors.surfaceRaised }]} />
            <View style={[styles.swatch, { backgroundColor: theme.colors.primary }]} />
          </View>
          {cover ? (
            <Animated.View exiting={fadeOut('micro')} style={StyleSheet.absoluteFill}>
              <Image
                accessible={false}
                testID={`theme-browse-preview:${entry.id}`}
                source={{ uri: cover }}
                cachePolicy="memory-disk"
                recyclingKey={entry.id}
                contentFit="cover"
                transition={DURATION.micro}
                onError={onCoverError}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          ) : null}
        </View>
        <View style={styles.titleRow}>
          <Text style={styles.flexOne} numberOfLines={1}>
            {entry.name}
          </Text>
          {installed ? (
            <Text variant="caption" color={theme.colors.primary}>
              {t`Installed`}
            </Text>
          ) : null}
          <Text variant="caption" color={theme.colors.textMuted}>
            {formatAssetSize(entry.bytes)}
          </Text>
        </View>
        {entry.author ? (
          <Text variant="caption" color={theme.colors.textSubtle} numberOfLines={1}>
            {entry.author}
          </Text>
        ) : null}
        {entry.description ? (
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
            {entry.description}
          </Text>
        ) : null}
        {pending ? (
          <Animated.View
            entering={fadeIn('micro')}
            exiting={fadeOut('micro')}
            style={styles.pendingRow}>
            <Spinner size="sm" color={theme.colors.primary} />
            <View style={styles.flexOne}>
              <ThemeImportProgress
                testID="theme-browse-progress"
                label={progress ? t`Preparing images` : t`Downloading…`}
                completed={progress?.completedAssets}
                total={progress?.totalAssets}
                receivedBytes={progress?.receivedBytes}
              />
            </View>
          </Animated.View>
        ) : null}
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  listContent: {
    // See the call site for why `flexGrow` is here.
    flexGrow: 1,
    width: '100%',
    maxWidth: THEME_PICKER_MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: LADDER.gutter,
    paddingBottom: LADDER.gutter,
    gap: LADDER.gap,
  },
  headerBlock: { paddingTop: 10, gap: LADDER.snug },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(127, 127, 127, 0.36)',
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: LADDER.snug },
  // The settings sheet's title size, so the two announce themselves the same.
  headerTitle: { fontSize: 20, lineHeight: 25, includeFontPadding: false },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  listHeader: { paddingBottom: LADDER.gap },
  flexOne: { flex: 1, minWidth: 0 },
  row: { gap: LADDER.tight + 2, padding: LADDER.snug, borderRadius: 16, borderCurve: 'continuous' },
  cover: {
    width: '100%',
    aspectRatio: PREVIEW_ASPECT,
    maxWidth: '100%',
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  placeholder: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  swatch: { width: 38, height: 28, borderRadius: 8, borderCurve: 'continuous' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: LADDER.gap },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: LADDER.snug },
  state: { paddingTop: LADDER.section, gap: LADDER.gap },
  stateBlock: { gap: LADDER.gap },
  stateAction: { flexDirection: 'row' },
  loading: { flexDirection: 'row', alignItems: 'center', gap: LADDER.gap },
  footer: { paddingTop: LADDER.gap },
  more: {
    alignItems: 'center',
    gap: LADDER.tight,
    padding: LADDER.snug,
    borderRadius: 16,
    borderCurve: 'continuous',
  },
});

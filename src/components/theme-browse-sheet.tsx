import { LegendList } from '@legendapp/list/react-native';
import { useLingui } from '@lingui/react/macro';
import { Spinner, Tag, useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoLoader } from '@/components/logo-loader';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import {
  SheetScene,
  SheetSceneFooter,
  SheetSceneRow,
  SHEET_LADDER,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { ThemeImportProgress } from '@/components/theme-import-progress';
import { Button } from '@/components/themed-button';
import { useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';
import { formatAssetSize } from '@/lib/asset-display';
import { isDemoActive } from '@/lib/demo-gateway';
import { demoThemeIndex } from '@/theme/demo-gallery';
import { DURATION, fadeIn, fadeOut, listLayout, riseIn, STAGGER, timing } from '@/lib/motion';
import { holdFor, remainingVisibleMs } from '@/lib/minimum-visible';
import { useRenderTally } from '@/lib/render-tally';
import { THEME_PICKER_MAX_CONTENT_WIDTH } from '@/lib/theme-picker-layout';
import { throwIfThemeAborted } from '@/theme/abort';
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
import { assetInstallProgress, type ThemeInstallProgress } from '@/theme/install-progress';
import { publicThemeTransport } from '@/theme/public-transport';
import { inspectRemoteTheme } from '@/theme/remote-import';
import { useThemeLibrary } from '@/stores/theme-library';

/**
 * The published themes, as a sheet of their own, with nothing downloaded until
 * one is chosen.
 *
 * This used to be an inline panel inside the theme sheet, capped at a 420pt
 * `ScrollView` under an already-long scroll. Browsing a catalogue is a whole
 * screen's worth of question, so it became one: a virtualized list of compact
 * rows -- a thumbnail, a name, what it costs, who wrote it -- and client-side
 * paging so that opening it does not start sixty image requests.
 *
 * The index is read once when this opens -- from the process cache when it is
 * fresh -- and carries everything a row draws, so the list itself costs one
 * small request no matter how long the catalogue grows. A package is a
 * different matter: the format allows 25 MiB, so a row shows its size and
 * downloads nothing until it is pressed.
 *
 * It is a form sheet like every other picker now. It was a full-screen frame
 * with a hand-drawn X circle in the corner, which is the chrome the sheet
 * system replaced with the grabber and the swipe; the rows were cards in
 * `surfaceRaised` under a separator each, which is the second surface a sheet
 * is not allowed. What is left is the scene: a heading, a frosted ground, and
 * one column of rows whose cover is the row's leading slot.
 *
 * Cancellation is `ThemeGallery`'s, carried over intact and for the unchanged
 * reason: a download that finishes after the screen is gone has staged assets
 * that nothing will ever dispose. One owned request at a time, unmount cancels
 * it, `handoff` is the single ownership boundary, and `finally` disposes
 * whatever did not transfer. Moving this to a route makes unmount *more* likely
 * -- a swipe dismisses a form sheet -- so none of it is rewritten here.
 */

/** Reveal a bounded page near the end; the catalogue index is already cached. */
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

/**
 * The cover, as a thumbnail rather than a poster: 8:5, the gallery contract's
 * preview shape, at the size a scene row can carry without becoming a card.
 * Narrower than the 112 it was:
 * a row on the sheet's own gutter has less to give than a card with its own
 * padding did.
 */
const COVER_WIDTH = 88;
const COVER_HEIGHT = 55;

/** The thumbnail plus the row's own padding; two capped lines fit beside it. */
const ROW_MIN_HEIGHT = 84;

type BrowseRowType = 'preview' | 'plain';

export function ThemeBrowseSheet({
  onReady,
}: {
  onReady: (candidate: ThemeEditorCandidate) => void;
}) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const theme = useThemeTokens();
  useRenderTally('ThemeBrowseSheet');
  const installed = useThemeLibrary((state) => state.library.themes);

  const [demo] = useState(isDemoActive);
  const [entries, setEntries] = useState<ThemeIndexEntry[] | null>(() =>
    demo ? demoThemeIndex() : cachedThemeIndex()
  );
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState(() =>
    Math.min(THEME_BROWSE_PAGE, entries?.length ?? THEME_BROWSE_PAGE)
  );
  // Where the page in view began, so an appended page starts its own sequence
  // at zero rather than continuing from twenty and arriving half a second late.
  const [pageStart, setPageStart] = useState(0);
  const [appending, setAppending] = useState(false);
  const appendInFlight = useRef(false);
  // Which row is downloading. A row, not a boolean: the acknowledgement belongs
  // on the theme it is for, and a second press elsewhere must not look like it
  // did something.
  const [pending, setPending] = useState<string | null>(null);
  // One value for the whole install rather than one per stage. The phases have
  // different things to count and the same place to say them.
  const [progress, setProgress] = useState<ThemeInstallProgress | null>(null);
  // Covers that screened, were requested, and did not paint. A row keeps its
  // placeholder rather than a broken picture.
  const [brokenCovers, setBrokenCovers] = useState<readonly string[]>([]);
  // Ids whose arrival has already been spent. Not a ref: a ref may not be read
  // during render, and the row that decides whether to animate is a render.
  // Mutated only from the row's mount effect.
  const [revealed] = useState(() => new Set<string>());

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
    if (entries !== null || demo) return;
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
        setShown(Math.min(THEME_BROWSE_PAGE, list.length));
      } catch {
        // The thrown message is a plain English module string and is in no
        // catalog. A full-width empty state is the last place to show one.
        if (mounted.current && !read.isCanceled) setFailed(true);
      }
    })();
    return () => read.cancel();
    // `attempt` is what `Try again` bumps; `entries` is the guard that stops a
    // re-read of a catalogue already in hand.
  }, [attempt, entries, demo]);

  // The appended page is on screen once the commit carrying it has run, which
  // is what ends the footer's spinner. Real work, not a timer pretending to be
  // one: the rows are laid out and their covers requested in that commit.
  useEffect(() => {
    appendInFlight.current = false;
    if (appending) setAppending(false);
    // Only the arrival of a new page ends it.
    // oxlint-disable-next-line react/exhaustive-deps -- `appending` is the flag being cleared, not an input
  }, [shown]);

  function retry() {
    clearThemeIndex();
    setFailed(false);
    setEntries(null);
    setShown(THEME_BROWSE_PAGE);
    setPageStart(0);
    setAttempt((value) => value + 1);
  }

  function open(entry: ThemeIndexEntry) {
    if (demo || !publicThemeTransport || active.current) return;
    const owned = new ThemeImportRequest();
    active.current = owned;
    // Synchronously, before anything is awaited, so the render that shows the
    // acknowledgement is already scheduled when this function returns.
    setPending(entry.id);
    setProgress({ phase: 'downloading' });
    setFailed(false);
    const pressedAt = Date.now();
    void (async () => {
      const { signal } = owned;
      let prepared: PreparedThemeAssets | undefined;
      let transferred = false;
      try {
        /*
         * There used to be a hold here, and the pipeline having learned to
         * yield is what removed it.
         *
         * The device review found a press that looked ignored: React had the
         * pending state but never got a frame to commit it in, because
         * everything after the call below took the JS thread and kept it --
         * the download resolved, then the whole archive was inflated and
         * CRC32'd synchronously. A `DURATION.short` hold in front of the work
         * bought the commit a frame, which fixed the symptom by delaying the
         * install.
         *
         * The phases do it properly now. The download is a real await on the
         * native transport, the unpack yields between every ZIP entry and
         * every 256 KiB inside one, and staging yields before each image, so
         * the acknowledgement paints as part of the work starting rather than
         * instead of it. Two mechanisms for one frame would be one too many,
         * so only the floor below survives -- and that one is not about
         * painting at all, it is about a state that did paint staying up long
         * enough to have been seen.
         */
        // `format: 'package'` because a catalogue entry is always a packed
        // `.muqun-theme`. Its assets come out of the archive rather than off
        // the network, so there are no third-party domains for a reader to
        // review -- one download, from the origin they already chose.
        const inspection = await inspectRemoteTheme(publicThemeTransport, themePackageUrl(entry), {
          signal,
          format: 'package',
          onProgress(value) {
            if (mounted.current && !signal.aborted) setProgress(value);
          },
        });
        throwIfThemeAborted(signal);
        prepared = await prepareThemeAssetStream(inspection.manifest, inspection.assets(signal), {
          signal,
          onProgress(value) {
            // The stream counts images in its own vocabulary; the phase model
            // is where the two meet.
            if (mounted.current && !signal.aborted) setProgress(assetInstallProgress(value));
          },
        });
        throwIfThemeAborted(signal);
        // The floor, and the whole of it: a download that beat its own
        // announcement leaves the announcement up for the rest of its welcome
        // rather than flashing through it on the way to another screen.
        await holdFor(remainingVisibleMs(pressedAt, MINIMUM_PENDING_VISIBLE_MS));
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

  function coverOf(entry: ThemeIndexEntry): string | null {
    if (demo || broken.has(entry.id)) return null;
    return themePreviewUrl(entry);
  }

  /**
   * Everything a row draws that is not the row's own entry.
   *
   * Legend List memoises a rendered row on `[itemKey, data, extraData]`, and
   * `itemsAreEqual` deliberately reports that a stable index entry never
   * changes -- so without this the pressed row would keep the markup it was
   * first rendered with and the spinner could never appear. The device review
   * found exactly that. A string rather than an object, so it compares by
   * value and a render that changed nothing re-renders nothing.
   */
  const counted = progress && progress.phase !== 'downloading' ? progress : null;
  const rowState = [
    pending ?? '',
    progress?.phase ?? '',
    counted?.completed ?? '',
    counted?.total ?? '',
    brokenCovers.length,
    installedIds.size,
    pageStart,
  ].join('|');

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
      entering={fadeIn('medium')}
      testID="theme-browse-empty"
      style={styles.stateBlock}>
      <Text variant="bodySmall">{t`Could not reach the theme catalogue`}</Text>
      <Text
        variant="caption"
        color={theme.colors.textMuted}>{t`Check your connection and try again.`}</Text>
      <View style={styles.stateAction}>
        <Button
          variant="secondary"
          disabled={demo || pending !== null}
          testID="theme-browse-retry"
          onPress={retry}>{t`Try again`}</Button>
      </View>
    </Animated.View>
  );

  const empty = (
    <Animated.View layout={listLayout('short')} style={styles.state}>
      {failed ? (
        failure
      ) : entries === null ? (
        <Animated.View
          key="loading"
          entering={fadeIn('medium')}
          exiting={fadeOut('micro')}
          testID="theme-browse-loading"
          // Plain on the ground: the scene frosts it, so nothing on this sheet
          // needs a plate of its own to stay legible over a wallpaper.
          style={styles.loading}>
          <LogoLoader size={56} accessibilityLabel={t`Loading themes…`} />
          <Text color={theme.colors.textMuted} style={{ textAlign: 'center', flexShrink: 1 }}>
            {t`Loading themes…`}
          </Text>
        </Animated.View>
      ) : (
        <Animated.View
          key="none"
          entering={fadeIn('medium')}
          testID="theme-browse-none"
          style={styles.stateBlock}>
          <Text color={theme.colors.textMuted}>{t`No themes are published yet`}</Text>
        </Animated.View>
      )}
    </Animated.View>
  );

  function appendPage() {
    if (!entries || shown >= total || pending !== null || failed || appendInFlight.current) return;
    appendInFlight.current = true;
    setAppending(true);
    setPageStart(shown);
    setShown(Math.min(shown + THEME_BROWSE_PAGE, total));
  }

  const footer =
    entries && total > 0 ? (
      <View testID="theme-browse-page-status" style={styles.footer}>
        {appending ? <Spinner size="sm" color={theme.colors.textMuted} /> : null}
        <Text variant="caption" color={theme.colors.textMuted}>
          {t`Showing ${shown} of ${total}`}
        </Text>
        {demo ? (
          <Text
            variant="caption"
            color={
              theme.colors.textMuted
            }>{t`Demo catalogue. Leave the demo to download themes.`}</Text>
        ) : null}
      </View>
    ) : null;

  /**
   * The status line: what went wrong, and nothing else any more.
   *
   * The install's progress used to be here too -- a full-width step name and
   * bar pinned under the caption, while the row it was about sat at the bottom
   * of the list wearing a spinner. Two places for one fact, and the owner named
   * the problem exactly: "the animation at the top should be on the theme that
   * is being downloaded". It is on it now; see `ThemeBrowseRow`.
   *
   * The failure stays pinned, because it is not about one row in the same way:
   * the recovery is a `Try again` for the catalogue, the press that caused it
   * may have been scrolled far away by then, and a retry button that has to be
   * hunted for is not a recovery. It only appears here when there are rows --
   * with none, the empty component is already saying it.
   */
  const status = (
    <Animated.View layout={listLayout('short')}>
      {failed && rows.length ? <View style={styles.status}>{failure}</View> : null}
    </Animated.View>
  );

  // The scene every other picker is built in: one frosted ground, the heading,
  // and the catalogue under it. No close button, and no `onClose` prop to draw
  // one from: the grabber and the swipe are the close.
  return (
    <SheetScene
      testID="settings-sheet-scene"
      title={t`Browse themes`}
      caption={t`Themes published at muqun.dev. Nothing downloads until you open one.`}
      header={status}>
      <LegendList
        nestedScrollEnabled
        testID="theme-browse-list"
        data={rows}
        onEndReached={appendPage}
        onEndReachedThreshold={0.4}
        keyExtractor={keyOfEntry}
        // Entries are stable objects straight out of the parsed index and are
        // never rebuilt per render, so the strictest comparison is both the
        // correct one and the cheapest. Everything a row draws that is *not*
        // the entry travels in `extraData`; see `rowState`.
        itemsAreEqual={entriesAreEqual}
        extraData={rowState}
        // Never. A row owns a preview image, and recycling would hand one
        // theme's cover to another.
        recycleItems={false}
        getItemType={(entry: ThemeIndexEntry): BrowseRowType =>
          coverOf(entry) ? 'preview' : 'plain'
        }
        // The thumbnail is a fixed box and the text is capped at two lines,
        // so every row is about the same height whichever bucket it is in.
        // No separator: a scene puts a hairline between groups and nowhere
        // else, and a catalogue is one group.
        estimatedItemSize={ROW_MIN_HEIGHT}
        renderItem={({ item, index }) => (
          <ThemeBrowseRow
            entry={item}
            cover={coverOf(item)}
            installed={installedIds.has(item.id)}
            pending={pending === item.id}
            // Only the row it is about: a row that is not installing has
            // nothing to draw and re-renders to the same markup.
            progress={pending === item.id ? progress : null}
            dimmed={pending !== null && pending !== item.id}
            disabled={demo || pending !== null}
            revealed={revealed}
            delay={Math.min(Math.max(index - pageStart, 0), THEME_BROWSE_STAGGER_CAP) * STAGGER.row}
            onPress={() => open(item)}
            onCoverError={() =>
              setBrokenCovers((value) => (value.includes(item.id) ? value : [...value, item.id]))
            }
          />
        )}
        ListEmptyComponent={empty}
        ListFooterComponent={
          <>
            {footer}
            <SheetSceneFooter bottomInset={insets.bottom} />
          </>
        }
        style={sheetSceneStyles.scroller}
        // The scene's gutter and nothing else. No fill: every row is plain
        // text and one thumbnail on the sheet's own frosted ground, so there
        // is no second surface left to paint a seam with.
        contentContainerStyle={styles.listContent}
      />
    </SheetScene>
  );
}

function keyOfEntry(entry: ThemeIndexEntry): string {
  return entry.id;
}

function entriesAreEqual(previous: ThemeIndexEntry, next: ThemeIndexEntry): boolean {
  return previous === next;
}

/**
 * How long the pressed state stays up, however fast the work behind it was.
 *
 * Twice `short`: one for the cross-fade that brings the spinner in, one for it
 * to be a thing the reader saw rather than a frame they can only find in a
 * recording. Composed from the token rather than written out, so the tuning
 * pass the tokens exist for reaches it.
 */
const MINIMUM_PENDING_VISIBLE_MS = DURATION.short * 2;

/**
 * One catalogue entry: its cover, its name, who wrote it and what it costs.
 *
 * A scene row rather than a card. The cover is the row's leading slot at the
 * 8:5 it is published in, the name is the row, the author and description share
 * the caption capped at two lines, and the trailing slot is the size -- which
 * cross-fades to a spinner when this is the row being downloaded.
 *
 * The `Installed` badge is a hint rather than a guarantee. Installation
 * identity is local and content-hashed while the manifest `id` is
 * author-provided and untrusted, so two different packs can claim one id --
 * which is why the badge never disables the row. Pressing still opens the
 * preview, and that is where a duplicate is resolved.
 *
 * And while it is the row installing, the size in that trailing slot becomes
 * the name of the step -- `Unpacking…`, `4/11` -- with the bar underlining the
 * row's own copy. The progress used to be a full-width block at the top of the
 * sheet with a spinner down here standing in for it, which asked the reader to
 * hold two places on one screen together and told them nothing about *which*
 * theme the block was counting. One row, one fact, in the place the reader is
 * already looking.
 */
function ThemeBrowseRow({
  entry,
  cover,
  installed,
  pending,
  progress,
  dimmed,
  disabled,
  revealed,
  delay,
  onPress,
  onCoverError,
}: {
  entry: ThemeIndexEntry;
  cover: string | null;
  installed: boolean;
  pending: boolean;
  /** How far this row's own install has got, and null for every other row. */
  progress: ThemeInstallProgress | null;
  dimmed: boolean;
  disabled: boolean;
  revealed: Set<string>;
  delay: number;
  onPress: () => void;
  onCoverError: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceOpacity = useSurfaceBackgroundOpacity();

  // Spent once. Legend List mounts and unmounts rows as they cross the
  // viewport even with recycling off, so without this the whole list
  // re-animates every time it is scrolled back -- the difference between a
  // list that arrives and a list that flickers.
  const [entering] = useState(() => (revealed.has(entry.id) ? undefined : riseIn(delay)));
  useEffect(() => {
    revealed.add(entry.id);
  }, [revealed, entry.id]);

  // The rows that are not the pressed one settle back rather than flashing.
  // The pressed row is never dimmed: it is the one the reader is waiting on.
  const dim = useSharedValue(dimmed ? 0.5 : 1);
  useEffect(() => {
    dim.value = withTiming(dimmed ? 0.5 : 1, timing('short'));
  }, [dim, dimmed]);
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));

  // One line under the name, assembled rather than stacked: who wrote it, then
  // what it is. Two separate lines would put a third capped run in a row whose
  // whole job is to let a reader compare names.
  const caption = [entry.author, entry.description].filter(Boolean).join(' · ');

  // Three waits, three names -- the same three the pinned block used to say,
  // said here instead. `downloading` has nothing to count and no bar, so its
  // name is the whole of what this row can honestly show.
  const stepLabel = !progress
    ? ''
    : progress.phase === 'unpacking'
      ? t`Unpacking…`
      : progress.phase === 'assets'
        ? t`Preparing images`
        : t`Downloading…`;
  const measured = progress && progress.phase !== 'downloading' ? progress : null;
  const stepCount = measured ? `${measured.completed}/${measured.total}` : '';

  return (
    // Two views, and the split is not cosmetic: a layout animation and an
    // animated `opacity` on one view make Reanimated warn that the layout
    // animation may overwrite the style, and on device it did -- the pressed
    // row's own contents could be left at zero. The outer view owns arrival
    // and reflow, the inner one owns the dim.
    <Animated.View entering={entering} layout={listLayout('short')}>
      <Animated.View style={dimStyle}>
        <SheetSceneRow
          testID={`theme-browse-item:${entry.id}`}
          title={entry.name}
          caption={caption || undefined}
          disabled={disabled}
          onPress={onPress}
          style={styles.row}
          leading={
            <View style={[styles.cover, { backgroundColor: theme.colors.surfaceRaised }]}>
              {/* The placeholder is always underneath, so the image's own fade
                  is a cross-fade onto a surface that is already the right
                  colour -- no flash of sheet background, and no extra code. The
                  index carries no palette of its own, so the two swatches are
                  the sheet's rather than the theme's. */}
              <View accessible={false} style={[StyleSheet.absoluteFill, styles.placeholder]}>
                <View style={[styles.swatch, { backgroundColor: theme.colors.background }]} />
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
                    transition={DURATION.medium}
                    onError={onCoverError}
                    style={StyleSheet.absoluteFill}
                  />
                </Animated.View>
              ) : null}
            </View>
          }
          accessibilityLabel={entry.name}
          // The row's label replaces what is inside it, so the step drawn in
          // the trailing slot would otherwise be seen and never said.
          accessibilityValue={
            pending && stepLabel
              ? { text: [stepLabel, stepCount].filter(Boolean).join(' ') }
              : undefined
          }
          trailing={
            pending ? (
              <View style={styles.rowProgress} pointerEvents="none">
                {/* Absolute, and that is the point: a bar that joined the
                    row's flow would make the row taller the moment it was
                    pressed and push the rest of the catalogue down. It sits in
                    the padding the row already has under its copy, indented to
                    the copy's own left edge so it underlines the name rather
                    than the cover. */}
                <ThemeImportProgress
                  testID="theme-browse-progress"
                  label={stepLabel}
                  phase={progress?.phase}
                  completed={measured?.completed}
                  total={measured?.total}
                  compact
                />
              </View>
            ) : null
          }
          meta={
            <View style={styles.trailing}>
              {/* One thing or the other, never both and never a jump: the size
                  cross-fades out as the step comes in, which is the row
                  acknowledging the tap and then reporting on itself. */}
              {pending ? (
                <Animated.View
                  key="busy"
                  entering={fadeIn('short')}
                  exiting={fadeOut('short')}
                  style={styles.trailingStep}>
                  <Text
                    variant="caption"
                    color={theme.colors.textMuted}
                    numberOfLines={1}
                    style={styles.stepName}>
                    {stepLabel}
                  </Text>
                  {stepCount ? (
                    <Text
                      variant="caption"
                      color={theme.colors.textMuted}
                      // Tabular, so the counter does not reflow while the bar
                      // under the row moves.
                      style={styles.stepCount}>
                      {stepCount}
                    </Text>
                  ) : null}
                </Animated.View>
              ) : (
                <Animated.View
                  key="size"
                  entering={fadeIn('short')}
                  exiting={fadeOut('short')}
                  style={styles.trailingSlot}>
                  <Text variant="caption" color={theme.colors.textMuted}>
                    {formatAssetSize(entry.bytes)}
                  </Text>
                </Animated.View>
              )}
              {installed ? (
                <Animated.View entering={fadeIn('medium')}>
                  <Tag
                    // One layer of paint per pixel: under a custom theme the
                    // kit's opaque chip would be the one thing on the row
                    // refusing the reader's surface slider, so it drops its
                    // fill and the row behind shows through at its own alpha.
                    // A default theme has no alpha to honour and keeps the
                    // kit's.
                    style={surfaceOpacity === 1 ? undefined : styles.badgeTransparent}>
                    {t`Installed`}
                  </Tag>
                </Animated.View>
              ) : null}
            </View>
          }
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  listContent: {
    // A short catalogue still fills the sheet rather than leaving a stub.
    flexGrow: 1,
    width: '100%',
    maxWidth: THEME_PICKER_MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: SHEET_LADDER.gutter,
  },
  status: { paddingTop: SHEET_LADDER.tight },
  row: { minHeight: ROW_MIN_HEIGHT },
  cover: {
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  placeholder: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  swatch: { width: 24, height: 16, borderRadius: 5, borderCurve: 'continuous' },
  badgeTransparent: { backgroundColor: 'transparent' },
  trailing: { minWidth: 56, alignItems: 'flex-end', gap: SHEET_LADDER.tight },
  trailingSlot: { alignItems: 'flex-end', justifyContent: 'center' },
  // Capped, because `Preparing images` is three times the width of `1.2 MB`
  // and the trailing slot does not shrink: without a ceiling the step name
  // would take the width out of the theme's own name.
  trailingStep: { alignItems: 'flex-end', justifyContent: 'center', maxWidth: 108 },
  stepName: { textAlign: 'right' },
  stepCount: { fontVariant: ['tabular-nums'] },
  // Under the copy, not under the cover: `COVER_WIDTH` plus the row's own
  // column gap is exactly where `SheetSceneRow` starts its text. `bottom` sits
  // the bar inside the padding the row already has, so nothing reflows when it
  // appears -- see the note at the call site.
  rowProgress: {
    position: 'absolute',
    left: COVER_WIDTH + SHEET_LADDER.snug,
    right: 0,
    bottom: SHEET_LADDER.tight,
  },
  state: {
    paddingHorizontal: SHEET_LADDER.gutter,
    paddingTop: SHEET_LADDER.section,
    gap: SHEET_LADDER.gap,
  },
  stateBlock: { gap: SHEET_LADDER.gap },
  stateAction: { flexDirection: 'row' },
  loading: { alignItems: 'center', gap: SHEET_LADDER.gap, paddingVertical: SHEET_LADDER.gap },
  footer: { paddingTop: SHEET_LADDER.snug },
});

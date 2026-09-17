import { SheetHeading } from '@/components/sheet-heading';
import { LegendList } from '@legendapp/list/react-native';
import { useLingui } from '@lingui/react/macro';
import { Spinner, Tag, Text, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoLoader } from '@/components/logo-loader';
import { X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { GlassChrome } from '@/components/glass-chrome';
import { SheetFrame, useSheetGroundPlate, useSheetGroundProvided } from '@/components/sheet-ground';
import { PressableScale } from '@/components/pressable-scale';
import { LADDER, SettingsSeparator } from '@/components/settings-chrome';
import { ThemeImportProgress } from '@/components/theme-import-progress';
import { Button } from '@/components/themed-button';
import { useSurfaceBackground, useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';
import { formatAssetSize } from '@/lib/asset-display';
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
 * The cover, as a thumbnail rather than a poster: 8:5, the shape
 * `skills/muqun-theme` asks every cover to be published in, at the size a list
 * row can carry without becoming a card.
 */
const COVER_WIDTH = 112;
const COVER_HEIGHT = 70;

/** The thumbnail plus the row's own padding; three capped lines fit inside it. */
const ROW_MIN_HEIGHT = 96;

type BrowseRowType = 'preview' | 'plain';

export function ThemeBrowseSheet({
  onClose,
  onReady,
}: {
  onClose: () => void;
  onReady: (candidate: ThemeEditorCandidate) => void;
}) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  // The catalogue is a full-screen route, so `FullscreenSheetFrame` already
  // owns the safe edges; padding them again here would double them. It is
  // still its own `SheetFrame` -- the nested ground no-ops and the frame is
  // what publishes the tint its plate is mixed from.
  const groundProvided = useSheetGroundProvided();
  const theme = useThemeTokens();
  // Explicit: this is the component that renders the frame, so it sits above
  // its own tint provider. Everything *inside* the sheet reads the tint from
  // the frame and calls this with no argument.
  const plate = useSheetGroundPlate('surface');
  useRenderTally('ThemeBrowseSheet');
  const installed = useThemeLibrary((state) => state.library.themes);

  const [entries, setEntries] = useState<ThemeIndexEntry[] | null>(() => cachedThemeIndex());
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [shown, setShown] = useState(() =>
    Math.min(THEME_BROWSE_PAGE, cachedThemeIndex()?.length ?? THEME_BROWSE_PAGE)
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
  }, [attempt, entries]);

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
    if (!publicThemeTransport || active.current) return;
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
    if (broken.has(entry.id)) return null;
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
          disabled={pending !== null}
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
          // On the ground now that the list no longer paints a column behind
          // it, so it takes the same plate the header's two lines take.
          style={[styles.loading, plate]}>
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
          style={[styles.stateBlock, plate]}>
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
        <Text variant="caption" color={theme.colors.textMuted} style={plate}>
          {t`Showing ${shown} of ${total}`}
        </Text>
      </View>
    ) : null;

  // The ground the theme sheet has, because to a reader these two are one
  // place -- and now the ground every other form sheet has too, from the one
  // frame they all share.
  return (
    <SheetFrame testID="settings-sheet-scene">
      {/*
        Exactly two subviews, which is the most a native form sheet lays out
        around a scroll view -- the ground above, and this column. The header is
        inside the column rather than inside the list, because a way out that
        scrolls away is one the reader has to go looking for: after two screens
        of catalogue there was no close button anywhere. `collapsable={false}`
        so the column is not flattened into its parent, which would put the
        scroller back at index 0 and hand it the whole sheet's height.
      */}
      <View
        collapsable={false}
        style={[
          styles.column,
          groundProvided ? null : { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}>
        <View style={styles.headerBlock}>
          {/* iOS draws the grabber itself; Android's form sheet does not, and a
              sheet with no handle reads as a screen that arrived from the wrong
              direction. The same two lines the settings sheet carries. */}

          <View style={styles.header}>
            {/* The two lines a reader reads before any row exists, and the only
                text on this sheet not already on a row. Over a wallpaper they
                take the settings page's plate. */}
            <SheetHeading
              title={t`Browse themes`}
              caption={t`Themes published at muqun.dev. Nothing downloads until you open one.`}
            />
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
          {/*
            The status line: what the install is doing, and what went wrong.
            It lives in the pinned header rather than under the pressed row so
            that it cannot scroll out of sight mid-download, and it carries
            `listLayout` so the list below slides down to make room instead of
            jumping. The failure only appears here when there are rows -- with
            none, the empty component below is already saying it.
          */}
          <Animated.View layout={listLayout('short')}>
            {pending ? (
              <Animated.View
                key="progress"
                entering={fadeIn('medium')}
                exiting={fadeOut('short')}
                style={styles.status}>
                {/* Three waits, three names, one bar. `downloading` has
                    nothing to count and says so by not drawing one. */}
                <ThemeImportProgress
                  testID="theme-browse-progress"
                  label={
                    progress?.phase === 'unpacking'
                      ? t`Unpacking…`
                      : progress?.phase === 'assets'
                        ? t`Preparing images`
                        : t`Downloading…`
                  }
                  phase={progress?.phase}
                  completed={counted?.completed}
                  total={counted?.total}
                  receivedBytes={progress?.phase === 'assets' ? progress.receivedBytes : undefined}
                />
              </Animated.View>
            ) : failed && rows.length ? (
              <View style={styles.status}>{failure}</View>
            ) : null}
          </Animated.View>
        </View>
        <LegendList
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
          // The thumbnail is a fixed box and the text is capped at three lines,
          // so every row is about the same height whichever bucket it is in.
          estimatedItemSize={ROW_MIN_HEIGHT}
          ItemSeparatorComponent={SettingsSeparator}
          renderItem={({ item, index }) => (
            <ThemeBrowseRow
              entry={item}
              cover={coverOf(item)}
              installed={installedIds.has(item.id)}
              pending={pending === item.id}
              dimmed={pending !== null && pending !== item.id}
              disabled={pending !== null}
              revealed={revealed}
              delay={
                Math.min(Math.max(index - pageStart, 0), THEME_BROWSE_STAGGER_CAP) * STAGGER.row
              }
              onPress={() => open(item)}
              onCoverError={() =>
                setBrokenCovers((value) => (value.includes(item.id) ? value : [...value, item.id]))
              }
            />
          )}
          ListEmptyComponent={empty}
          ListFooterComponent={footer}
          style={styles.sheet}
          // No fill here. The rows carry their own, in `surfaceRaised`, the
          // way every other list in this app does; painting the whole content
          // container in the ground's own `surface` put a second coat of the
          // same tint over the picture and ended it in a straight line under
          // the header. What is left on the ground is what should be: the
          // header's two lines (plated), the empty state, and the footer.
          contentContainerStyle={styles.listContent}
        />
      </View>
    </SheetFrame>
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
 * One catalogue entry: its cover, its name, what it costs, and who wrote it.
 *
 * A list row rather than a poster. The cover is a left thumbnail at the 8:5 it
 * is published in, and the three lines beside it are capped, so a long
 * description costs an ellipsis instead of half the screen -- which is what
 * decides how many themes a reader can compare without scrolling.
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
  revealed: Set<string>;
  delay: number;
  onPress: () => void;
  onCoverError: () => void;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
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

  return (
    // Two views, and the split is not cosmetic: a layout animation and an
    // animated `opacity` on one view make Reanimated warn that the layout
    // animation may overwrite the style, and on device it did -- the pressed
    // row's own contents could be left at zero. The outer view owns arrival
    // and reflow, the inner one owns the dim.
    <Animated.View entering={entering} layout={listLayout('short')}>
      <Animated.View style={dimStyle}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={entry.name}
          accessibilityState={{ disabled, busy: pending }}
          testID={`theme-browse-item:${entry.id}`}
          disabled={disabled}
          onPress={onPress}
          // The row carries its own fill, and it is the only thing on this
          // sheet that does. The column used to be painted by the list's
          // content container, in the ground's own token -- so under the
          // header the wallpaper came through `surface` once and below it
          // through `surface` twice, which is the hard seam a reader sees
          // across the sheet and the reason this one did not look like the
          // others. `surfaceRaised` is what a row sits on everywhere else in
          // the app (the panels sheet's card, the files list's rows), and
          // adjacent rows in the same fill read as the column they replace.
          style={[styles.row, { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) }]}>
          <View
            style={[
              styles.cover,
              { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
            ]}>
            {/* The placeholder is always underneath, so the image's own fade is
                a cross-fade onto a surface that is already the right colour --
                no flash of sheet background, and no extra code. The index
                carries no palette of its own, so the two swatches are the
                sheet's rather than the theme's. */}
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
          <View style={styles.body}>
            <View style={styles.titleRow}>
              {/* The name gets the line to itself, beside the size and
                  nothing else. The badge used to sit here and cost the name a
                  third of its width, so "Aegean Paperlight" was read as
                  "Aegean Paperl…" -- a row whose one job is to name a theme. */}
              <Text variant="bodySmall" numberOfLines={1} style={styles.flexOne}>
                {entry.name}
              </Text>
              {/* The trailing slot is one thing or the other, never both and
                  never a jump: the size cross-fades out as the spinner comes
                  in, which is the row acknowledging the tap. */}
              <View style={styles.trailing}>
                {pending ? (
                  <Animated.View
                    key="busy"
                    entering={fadeIn('short')}
                    exiting={fadeOut('short')}
                    style={styles.trailingSlot}>
                    <Spinner size="sm" color={theme.colors.primary} />
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
              </View>
            </View>
            {/* The badge leads the author line rather than the name line: it
                is about this row's relationship to the library, which is the
                same register as who wrote the theme, and down here it costs a
                name nothing. */}
            {installed || entry.author ? (
              <View style={styles.metaRow}>
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
                {entry.author ? (
                  <Text
                    variant="caption"
                    color={theme.colors.textSubtle}
                    numberOfLines={1}
                    ellipsizeMode="tail"
                    style={styles.flexOne}>
                    {entry.author}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {entry.description ? (
              <Text
                variant="caption"
                color={theme.colors.textMuted}
                numberOfLines={2}
                ellipsizeMode="tail">
                {entry.description}
              </Text>
            ) : null}
          </View>
        </PressableScale>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1 },
  sheet: { flex: 1, minHeight: 0, overflow: 'hidden' },
  listContent: {
    // A short catalogue still fills the sheet rather than leaving a stub.
    flexGrow: 1,
    width: '100%',
    maxWidth: THEME_PICKER_MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingBottom: LADDER.gutter,
  },
  headerBlock: {
    width: '100%',
    maxWidth: THEME_PICKER_MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingTop: 10,
    paddingBottom: LADDER.gap,
    paddingHorizontal: LADDER.gutter,
    gap: LADDER.snug,
  },
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
  status: { paddingTop: LADDER.tight },
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
  flexOne: { flex: 1, minWidth: 0 },
  row: {
    minHeight: ROW_MIN_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: LADDER.gap,
    paddingHorizontal: LADDER.gutter,
    paddingVertical: LADDER.snug,
  },
  cover: {
    width: COVER_WIDTH,
    height: COVER_HEIGHT,
    borderRadius: 12,
    borderCurve: 'continuous',
    overflow: 'hidden',
  },
  placeholder: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  swatch: { width: 28, height: 20, borderRadius: 6, borderCurve: 'continuous' },
  body: { flex: 1, minWidth: 0, gap: LADDER.tight / 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: LADDER.gap },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: LADDER.gap },
  badgeTransparent: { backgroundColor: 'transparent' },
  trailing: { minWidth: 56, alignItems: 'flex-end', justifyContent: 'center' },
  trailingSlot: { alignItems: 'flex-end', justifyContent: 'center' },
  state: { paddingHorizontal: LADDER.gutter, paddingTop: LADDER.section, gap: LADDER.gap },
  stateBlock: { gap: LADDER.gap },
  stateAction: { flexDirection: 'row' },
  loading: { alignItems: 'center', gap: LADDER.gap, paddingVertical: LADDER.gap },
  footer: { paddingHorizontal: LADDER.gutter, paddingTop: LADDER.snug },
  more: {
    alignItems: 'center',
    gap: LADDER.tight,
    padding: LADDER.snug,
    borderRadius: 16,
    borderCurve: 'continuous',
  },
});

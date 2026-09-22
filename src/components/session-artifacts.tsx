import { LegendList, type LegendListRenderItemProps } from '@legendapp/list/react-native';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { Image } from 'expo-image';
import {
  File as FileIcon,
  FileCode,
  FileImage,
  FileText,
  FileType,
  RefreshCw,
} from 'lucide-react-native';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AssetViewer } from '@/components/asset-viewer';
import { appChrome } from '@/constants/appearance';
import { SettingsSegmented } from '@/components/settings-segmented';
import {
  SHEET_LADDER,
  SheetScene,
  SheetSceneFooter,
  SheetSceneGroupHeading,
  SheetSceneQuietControl,
  SheetSceneRow,
  SheetSceneSearch,
  sheetSceneStyles,
} from '@/components/sheet-scene';
import { formatAssetSize } from '@/lib/asset-display';
import { useRelativeTime } from '@/hooks/use-relative-time';
import { artifactGroupLabel } from '@/i18n/labels';
import { groupByDay, type ArtifactRow } from '@/lib/artifact-groups';
import {
  assetImageSource,
  listSessionAssets,
  MAX_SESSION_ASSET_LIMIT,
  SESSION_ASSET_PAGE_LIMIT,
  type AssetKind,
  type SessionAsset,
} from '@/lib/gateway-client';
import { describeGatewayFailure } from '@/lib/network-error';
import { RenderTally, useRenderTally } from '@/lib/render-tally';
import { responsiveWorkspaceLayout } from '@/lib/responsive-layout';

/**
 * Everything the session has produced.
 *
 * This used to be a fourth section at the bottom of the panels sheet, under a
 * panel list of unpredictable length -- so it was usually below the fold, and
 * it sat among three controls for switching panels, which is not what a file
 * is. Given a surface of its own it can be what it should have been: a browser.
 * Search, a filter by kind, files grouped by the day they were written, and a
 * thumbnail for anything that has one.
 *
 * Newest first, because the question this answers is almost always "what did it
 * just make".
 *
 * Drawn by Legend List, for the reason the chat transcript is (card #652): this
 * is a paged list that grows at the far end, and both of the things that makes
 * hard are the library's own. `maintainVisibleContentPosition` with
 * `data: true` holds the reader's place across a change of *data* -- which is
 * what a page of older files is here, because the assets endpoint has no cursor
 * and "more" means asking for a wider window and being handed the whole listing
 * again. And the rows are handed out with their identity intact by
 * `groupByDay`, so a keystroke in the search field or a re-read of the window
 * re-renders the rows that actually changed rather than all of them.
 */

type KindFilter = 'all' | 'image' | 'document' | 'code';

/**
 * A row of the sheet: a day heading, a file, or the one row that stands in for
 * a listing with nothing in it.
 *
 * That last one is why this type exists rather than `ArtifactRow` being used
 * directly. Legend List 3.3.3 carries an open React 19 crash
 * (LegendApp/legend-list#502): a mounted list whose data goes non-empty, empty,
 * non-empty runs its reset path, and that path calls `setState` during render.
 * Every one of those sequences is an ordinary use of this sheet -- type a
 * search that matches nothing and delete a letter, or tap a kind chip whose
 * window holds none of that kind and then tap back.
 *
 * The chat view mitigates the same bug by unmounting the list while there is
 * nothing to show. That would work here now that the search field is the
 * scene's pinned header rather than the list's -- but it would also mean the
 * sheet's one scroll view coming and going, and react-native-screens lays a
 * form sheet out around the scroll view it finds among the frame's children.
 * So this list is simply never handed an empty array -- the empty state is a
 * row -- and the crashing branch is never reached at all.
 */
type FilesRow =
  | ArtifactRow
  | {
      type: 'empty';
      key: 'empty';
      /** Whether this gateway has no asset routes, which is not an error. */
      unavailable: boolean;
      /** The sentence to show; empty when `unavailable` writes its own. */
      text: string;
      /**
       * What `flex: 1` used to do. The empty state was centred in the space
       * under the header by a stretching child of the content container, and a
       * row cannot stretch -- a virtualized list positions rows by their
       * measured height. So the height is measured instead: the list's own
       * viewport, less the header laid out above it.
       */
      height: number;
    };

/**
 * The seed for a row's height, before any have been measured. `getItemType`
 * below buckets rows by kind, so the list keeps a running average per kind and
 * this is only what it starts from. A file row is the scene's own row floor
 * plus its padding; a day heading is about half that, and the empty row is
 * measured the moment it appears.
 */
const ESTIMATED_ROW_HEIGHT = 60;

/**
 * How near the end counts as "the reader has reached it", as a fraction of the
 * viewport. Half a screen: the listing re-reads the whole window to grow it, so
 * asking a little early is what keeps the next page from being a wait.
 */
const LOAD_MORE_THRESHOLD = 0.5;

/**
 * Anchor on a change of *data*, not only on rows changing size -- the same
 * decision, and the same constant, as the chat transcript. The default covers
 * the second and skips the first, and the first is the one paging needs here:
 * widening the window answers with the same rows plus older ones, and the rows
 * the reader was looking at have to stay under their eyes while every row above
 * them is measured again.
 *
 * Never anchor to the empty row. It is the one row that is *replaced* rather
 * than moved -- a listing arrives and it is gone -- so holding it in place is
 * holding something that no longer exists, and a list that had nothing in it
 * has no reader's place to keep in the first place.
 */
const MAINTAIN_POSITION = {
  data: true,
  size: true,
  shouldRestorePosition: (row: FilesRow) => row.type !== 'empty',
} as const;

/** Nothing smaller than this is worth centring a sentence in. */
const MIN_EMPTY_HEIGHT = 160;

/**
 * The gateway kinds behind each segment.
 *
 * A segment is the question a person asks -- "files" -- and a kind is what the
 * scanner sniffed off the bytes; "files" is two of them. These go to the
 * gateway so the filtering happens where the files are. `all` sends nothing and
 * keeps the plain newest-N listing.
 */
const FILTER_KINDS: Record<KindFilter, readonly AssetKind[]> = {
  all: [],
  image: ['image'],
  document: ['markdown', 'pdf'],
  code: ['text'],
};

/**
 * Applied again to what comes back, because a gateway too old to know `kind=`
 * answers with everything and the segment still has to mean something.
 */
function matchesFilter(asset: SessionAsset, filter: KindFilter): boolean {
  const kinds = FILTER_KINDS[filter];
  return kinds.length === 0 || kinds.includes(asset.kind);
}

/** The segmented control hands back a `string`; this is the narrowing. */
function isKindFilter(value: string): value is KindFilter {
  return value in FILTER_KINDS;
}

export function SessionArtifacts({
  sessionId,
  tabId,
  label,
}: {
  sessionId: string;
  /**
   * Which tab on the backend to scope the listing to. A tmux backend's
   * workspace is a whole tmux session -- commonly one long-running session
   * with a window per project -- so without narrowing to the tab (the tmux
   * window) the gateway would have no way to tell this session's files from
   * another project's.
   */
  tabId: string;
  /** The server's name, for the line under the title. */
  label: string;
}) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro`.
  //
  // React Compiler is enabled, and it will memoize a global `t` call whose
  // arguments have not changed -- it has no way to know the result also depends
  // on the active locale. The symptom is a half-translated screen after a
  // language switch: `<Trans>` elements move and everything built from a `t`
  // call keeps the old language. The hook's `t` is bound to the Lingui context,
  // so the compiler sees a dependency that actually changes.
  const { t } = useLingui();
  useRenderTally('SessionArtifacts');

  // The segment labels are built here, in the body that holds the hook, and not
  // in a module helper handed a `t` parameter. The Lingui babel macro rewrites
  // ``t`...` `` only where it can walk the reference back to the very
  // `useLingui()` destructuring it came from; a `t` that arrives as a function
  // argument is a different binding, so the macro leaves the tagged template
  // alone and the runtime calls Lingui's `_` with a raw strings array, which
  // has no id and answers with an empty string. That is what emptied these four
  // chips in a release build -- silently, because nothing throws.
  //
  // Rebuilt on every render rather than frozen in a module constant: a constant
  // is evaluated once, at import time, and would keep whichever language
  // happened to be active then.
  //
  // Four segments and no spoken labels beside them. The chips each carried a
  // `Show images` sentence of their own, because a chip is a button and a
  // button with a one-word face needs one. A segmented control is not a row of
  // buttons: it is one control whose segments are named by what they say, and
  // the kit reports the chosen one through `accessibilityState.selected`. A
  // second, invented sentence on top of that is VoiceOver reading the control
  // twice.
  const filters: { value: KindFilter; label: string }[] = [
    { value: 'all', label: t`All` },
    { value: 'image', label: t`Images` },
    { value: 'document', label: t`Files` },
    { value: 'code', label: t`Code` },
  ];

  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // One column, whatever the width. A scene is one column against one gutter --
  // the left selection rule and the day headings both belong to that edge -- so
  // a Pad gets a wider reading measure, centred, rather than a second column of
  // files beside the first.
  const isPadLayout = responsiveWorkspaceLayout(width).mode === 'pad';
  const [assets, setAssets] = useState<SessionAsset[]>([]);
  /** When the listing was fetched, which is the clock the day headings use. */
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // An older gateway simply has no asset routes. Saying so plainly is the
  // honest answer; an error would blame the user for the server's age.
  const [available, setAvailable] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<KindFilter>('all');
  const [openAsset, setOpenAsset] = useState<SessionAsset | null>(null);
  /**
   * How wide a listing to ask for, which is this sheet's whole notion of a
   * page. The endpoint answers with the newest N and has no cursor, so the way
   * to reach older files is to ask for a larger N and read the listing again --
   * the same shape as the transcript's load-earlier, and the reason the list
   * anchors on a change of data rather than on a prepend.
   */
  const [windowSize, setWindowSize] = useState(SESSION_ASSET_PAGE_LIMIT);
  /** Whether a wider window could still answer with more than this one did. */
  const [atEnd, setAtEnd] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  /**
   * The listing in flight, and the only one whose answer is wanted.
   *
   * Exactly one question is on the table at a time: the chip that is lit, the
   * window that has been asked for, the tab that is selected. Asking a new one
   * -- or leaving the sheet entirely -- makes the old answer worthless, and an
   * answer that is worthless must not be allowed to land. Two things follow
   * from that, and this ref is how both are said:
   *
   * The request is *cancelled*, not merely ignored. A gateway that has gone
   * quiet is answered for by a fifteen-second budget, and until that budget
   * runs out an abandoned listing holds a socket open for a screen that is no
   * longer there.
   *
   * And its `setState` calls are dropped. Nothing about a request guarantees
   * the order its answer arrives in, so the slower of two overlapping loads
   * could land last and repaint the sheet with the question before the one the
   * reader is looking at -- files for the chip they just left, and `loading`
   * cleared while the listing they actually asked for is still on the wire.
   */
  const inFlightRef = useRef<AbortController | null>(null);

  // Keyed on the chip and on the window as well as the session: the filter is
  // the gateway's job now, so changing it is a new question to ask rather than
  // a narrower way of reading the answer already in hand, and so is asking for
  // more of the listing.
  const load = useCallback(async () => {
    inFlightRef.current?.abort();
    const controller = new AbortController();
    inFlightRef.current = controller;
    // No tab to scope to yet -- the first render or two, before the server
    // screen's selection has settled -- so there is no request worth making.
    // An empty id would only ever hit a URL with an empty segment. Showing
    // the sheet's own empty state is the honest answer; once the selection
    // catches up this effect runs again from the dependency below.
    if (!tabId) {
      setAssets([]);
      setAtEnd(true);
      setLoadedAt(Date.now());
      setAvailable(true);
      setError(null);
      setLoading(false);
      setLoadingMore(false);
      return;
    }
    setLoading(true);
    try {
      const page = await listSessionAssets(sessionId, tabId, {
        kind: FILTER_KINDS[filter],
        limit: windowSize,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setAssets(page);
      // A window that came back with room to spare is the whole listing, and a
      // window at the endpoint's ceiling is as much of it as can be asked for.
      // Either way there is nothing further to fetch, so the list stops asking.
      setAtEnd(page.length < windowSize || windowSize >= MAX_SESSION_ASSET_LIMIT);
      // Read once per load rather than per render: the day headings must not
      // renumber themselves because a keystroke in the search field happened to
      // land after local midnight.
      setLoadedAt(Date.now());
      setAvailable(true);
      setError(null);
    } catch (failure) {
      // A listing this sheet itself gave up on is not a failure to report. It
      // usually surfaces as the abort, but a request cancelled between the
      // headers and the body can also come back as the budget's own timeout,
      // so the controller is what decides -- not the shape of the error.
      if (controller.signal.aborted) return;
      setAssets([]);
      // A window that failed says nothing about whether a wider one would, but
      // it must not leave the list asking for one on every scroll.
      setAtEnd(true);
      if (isMissingEndpoint(failure)) {
        setAvailable(false);
        setError(null);
        return;
      }
      setError(describeGatewayFailure(failure, t`Could not load files.`).message);
    } finally {
      // Not the abandoned load's business either. Clearing these would hand the
      // spinner belonging to the request still on the wire to the one that has
      // already been given up on.
      if (!controller.signal.aborted) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [filter, sessionId, t, windowSize, tabId]);

  useEffect(() => {
    void load();
    // Leaving is a cancellation like any other. The sheet is a route, so the
    // reader closing it -- by the button, by the swipe, or by the Android back
    // gesture -- unmounts this component while the listing may still be in
    // flight, and the request has no reason to finish.
    return () => inFlightRef.current?.abort();
  }, [load, t]);

  /**
   * The rows the listing in hand makes, with the ones that have not changed
   * kept as the very objects they were.
   *
   * Written to the ref during render on purpose, the way the chat transcript
   * does it: this is derived state, and the derivation is idempotent -- built
   * twice from the same assets it returns the same objects.
   */
  const previousRowsRef = useRef<ArtifactRow[]>([]);
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = assets.filter(
      (asset) =>
        matchesFilter(asset, filter) &&
        // Path as well as name: the way to find one of five `index.ts` is to
        // type the directory that tells them apart.
        (!needle ||
          asset.name.toLowerCase().includes(needle) ||
          asset.path.toLowerCase().includes(needle))
    );
    // oxlint-disable-next-line react/refs -- deliberate: the ref carries last render's rows in so unchanged ones keep their objects. Nothing is rendered *from* it -- the rows returned are, and they are recomputed from the props and state in the dependency list.
    const next = groupByDay(matching, loadedAt, previousRowsRef.current);
    // oxlint-disable-next-line react/refs -- deliberate: the same idempotent derivation, written back. Building twice from the same assets returns the same objects.
    previousRowsRef.current = next;
    return next;
  }, [assets, filter, loadedAt, query]);

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  /**
   * The reader has come within half a screen of the oldest file in hand, so ask
   * for a wider window.
   *
   * Guarded on a load already being in flight as well as on there being nothing
   * left to ask for: the list calls this on every scroll pass that ends near
   * the end, and a widening window is a re-read of the whole listing.
   */
  function loadMore() {
    if (loading || loadingMore || atEnd) return;
    setLoadingMore(true);
    setWindowSize((current) =>
      Math.min(current + SESSION_ASSET_PAGE_LIMIT, MAX_SESSION_ASSET_LIMIT)
    );
  }

  /**
   * A segment is a new question, so the window it was asked with goes back to
   * the first page. Keeping a widened one would ask the gateway to scan for two
   * hundred images because the reader had once paged through the documents.
   */
  function chooseFilter(value: string) {
    if (!isKindFilter(value) || value === filter) return;
    setFilter(value);
    setWindowSize(SESSION_ASSET_PAGE_LIMIT);
    setAtEnd(false);
  }

  // What the empty row has to fill, measured rather than declared: see the
  // `height` field on `FilesRow`. The handler writes only when the number has
  // actually moved, so a layout pass that reports the same size does not
  // re-render the sheet. There is no header to subtract any more: the search
  // field and the segments are pinned above the scroller by the scene, so the
  // list's own viewport is exactly the room the sentence has.
  const [viewportHeight, setViewportHeight] = useState(0);
  // What the scene's footer leaves under the last row, repeated here because
  // the empty row is sized against the viewport and has to stop short of it.
  const listBottomPadding = insets.bottom + SHEET_LADDER.section;
  const onListLayout = useCallback((event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    setViewportHeight((current) => (Math.abs(current - height) < 1 ? current : height));
  }, []);

  const emptyRow = useMemo<FilesRow>(
    () => ({
      type: 'empty',
      key: 'empty',
      unavailable: !available,
      text: !available
        ? ''
        : error
          ? error
          : assets.length === 0
            ? t`Nothing here yet. Files the session writes show up on their own.`
            : t`No files match.`,
      // The viewport, less the padding the content container keeps below it --
      // which together are exactly what `flex: 1` used to be given.
      height: Math.max(MIN_EMPTY_HEIGHT, viewportHeight - listBottomPadding),
    }),
    [assets.length, available, error, listBottomPadding, t, viewportHeight]
  );

  // The list is never handed an empty array -- see `FilesRow`. While the first
  // listing is still in flight there is no sentence to show either, so the
  // empty row carries none and draws nothing.
  const listRows: FilesRow[] = useMemo(() => {
    if (!available || rows.length === 0) return [loading && available ? SILENT_EMPTY : emptyRow];
    return rows;
  }, [available, emptyRow, loading, rows]);

  const openRow = useCallback((asset: SessionAsset) => {
    // A search field may still own focus after the query is cleared. Opening a
    // full-screen viewer without releasing it lets Android restore the IME as
    // soon as the viewer closes, covering the older rows at the foot of the
    // Pad sheet. A file tap is navigation, so keeping the keyboard is never
    // useful here.
    Keyboard.dismiss();
    setOpenAsset(asset);
  }, []);

  const renderRow = useCallback(
    ({ item, index }: LegendListRenderItemProps<FilesRow>) => {
      if (item.type === 'heading')
        return <DayHeading label={item.label} count={item.count} first={index === 0} />;
      if (item.type === 'asset')
        // The hairline runs between two files and nowhere else: not under a day
        // heading, where the heading itself is already the break, and not under
        // the last file, where it would be a line drawn across empty ground.
        return (
          <AssetRow
            asset={item.asset}
            onOpen={openRow}
            separated={listRows[index - 1]?.type === 'asset'}
          />
        );
      return <EmptyState row={item} />;
    },
    [listRows, openRow]
  );

  return (
    <RenderTally id="files">
      {/* The scene every sheet in the app is built in: one frosted ground, the
          heading, the pinned search and segments, and the listing under them.
          Two subviews, which is the most a native form sheet lays out around a
          scroll view -- the ground costs no layout because it is absolutely
          positioned, so the list is still the thing the sheet measures. */}
      <SheetScene
        testID="session-artifacts"
        title={t`Files`}
        caption={label}
        headingTrailing={
          <SheetSceneQuietControl
            testID="artifacts-refresh"
            accessibilityLabel={t`Refresh files`}
            busy={loading}
            onPress={() => void load()}>
            <RefreshCw size={17} color={theme.colors.textMuted} />
          </SheetSceneQuietControl>
        }
        header={
          available ? (
            <>
              <SheetSceneSearch
                testID="artifacts-search"
                value={query}
                onChangeText={setQuery}
                placeholder={t`Search files`}
                accessibilityLabel={t`Search files`}
              />
              {/* No segment greys itself out. A segment used to disable itself
                  when the page in hand held none of its kind, which stopped
                  being true the moment the filtering moved to the gateway: what
                  is in hand is one page of `all`, and "no images among the
                  newest hundred" is not "no images". The segment is the
                  question; the answer only exists after it has been asked. */}
              <SettingsSegmented
                testID="artifact-kind"
                options={filters.map((entry) => ({ label: entry.label, value: entry.value }))}
                value={filter}
                onChange={chooseFilter}
              />
            </>
          ) : null
        }>
        <LegendList
          nestedScrollEnabled
          testID="artifacts-list"
          showsVerticalScrollIndicator={false}
          data={listRows}
          keyExtractor={keyOfRow}
          renderItem={renderRow}
          // The other half of the identity deal, stated to the list: a row whose
          // object has not changed has not changed. `groupByDay` is handed the
          // previous rows and guarantees exactly that, so the strictest possible
          // comparison is both the correct one and the cheapest.
          itemsAreEqual={rowsAreEqual}
          // Never. The argument above is stable row objects plus `React.memo`;
          // recycling a row into another row's props is the one thing that would
          // undo it -- and it would hand a file's thumbnail to a day heading.
          recycleItems={false}
          // A day heading and a file row are half an inch apart in height, and a
          // single average across both is what makes a virtualized list jump when
          // a page of older files lands. The kind is already the right bucket.
          getItemType={rowTypeOf}
          estimatedItemSize={ESTIMATED_ROW_HEIGHT}
          // The reader's place across a change of data. Off by default, and the
          // reason this list is Legend List: see MAINTAIN_POSITION.
          maintainVisibleContentPosition={MAINTAIN_POSITION}
          onEndReached={loadMore}
          onEndReachedThreshold={LOAD_MORE_THRESHOLD}
          onLayout={onListLayout}
          style={sheetSceneStyles.scroller}
          // The scene's gutter, and on a Pad a reading measure rather than a
          // second column: see `isPadLayout` above.
          contentContainerStyle={[
            sheetSceneStyles.scrollerContent,
            styles.listContent,
            isPadLayout ? styles.padListContent : null,
          ]}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={theme.colors.textMuted}
              colors={[theme.colors.primary]}
            />
          }
          // The page in flight, said where it is being waited for. The heading's
          // refresh already spins for a re-read of the same window; this is the
          // one at the bottom, under the oldest file in hand, and it carries no
          // words of its own -- a spinner where the next rows will appear says
          // what it is doing without a string to translate. The scene's footer
          // follows it: the sheet's own bottom room plus whatever the keyboard
          // is standing on, so the last file stays reachable with the search
          // field focused.
          ListFooterComponent={
            <>
              {loadingMore ? (
                <View style={styles.footer}>
                  <ActivityIndicator size="small" color={theme.colors.textMuted} />
                </View>
              ) : null}
              <SheetSceneFooter bottomInset={insets.bottom} />
            </>
          }
        />
      </SheetScene>
      {/* A `Modal`, so it is never a third subview of the sheet's own layout. */}
      {openAsset ? <AssetViewer asset={openAsset} onClose={() => setOpenAsset(null)} /> : null}
    </RenderTally>
  );
}

function keyOfRow(row: FilesRow): string {
  return row.key;
}

/** The kind is the size bucket: see `getItemType` at the call site. */
function rowTypeOf(row: FilesRow): string {
  return row.type;
}

function rowsAreEqual(previous: FilesRow, next: FilesRow): boolean {
  return previous === next;
}

/**
 * The empty row while the first listing is still in flight: no sentence, no
 * height, and the same object every time, so the wait costs nothing and says
 * nothing. "Nothing here yet" is a verdict, and it must not be delivered
 * before the question has been asked.
 */
const SILENT_EMPTY: FilesRow = {
  type: 'empty',
  key: 'empty',
  unavailable: false,
  text: '',
  height: 0,
};

/**
 * The listing with nothing in it, centred in the space under the header rather
 * than tucked below the filter row. A sentence about there being nothing is
 * the only thing on the surface, so putting it flush against the top left with
 * a screen of empty below reads as a listing that failed to draw rather than
 * as an answer.
 */
const EmptyState = memo(function EmptyState({
  row,
}: {
  row: Extract<FilesRow, { type: 'empty' }>;
}) {
  const theme = useThemeTokens();
  if (!row.unavailable && !row.text) return <View style={{ height: row.height }} />;
  return (
    <View style={[styles.centerState, { height: row.height }]}>
      <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.centerText}>
        {row.unavailable ? (
          <Trans>
            This gateway does not serve files yet. Update the Muqun gateway plugin to browse what a
            session writes.
          </Trans>
        ) : (
          row.text
        )}
      </Text>
    </View>
  );
});

/**
 * `groupByDay` names the three buckets that are not dates -- today, yesterday
 * and "no date at all" -- in English, because `artifact-groups` is a pure
 * module under test and cannot hold a macro. The words are what it names them,
 * so this is where they are translated. A weekday or a month-and-day is already
 * in the reader's language: `dayLabel` formats those through `Intl`.
 */
const DAY_BUCKET_LABEL = {
  Today: artifactGroupLabel.today,
  Yesterday: artifactGroupLabel.yesterday,
  'Unknown date': artifactGroupLabel.unknown,
} as const;

/**
 * The day, as the group heading every other sheet in the app uses.
 *
 * It used to be the app's one deliberately full-width heading: a pill, a
 * hairline ruled across the rest of the sheet, and the count at the far end --
 * `Today ──── 23`. That is a divider bar, and a scene already has a divider,
 * the hairline it puts between one group and the next. Two kinds of separator
 * on one surface is what made the files sheet read as a different app from the
 * pickers beside it. So the day is a name in the heading row and the count is
 * the meta at its trailing edge, which is where a group's one number goes.
 *
 * `spoken.toUpperCase()` went with the pill. `variant="label"` carries
 * `textTransform: 'uppercase'`, which the platform applies per script; the
 * JavaScript call did nothing on Japanese and the wrong thing on a few others,
 * and this heading's text is a translated bucket name -- `Today`, `Yesterday`
 * -- not an English constant.
 */
const DayHeading = memo(function DayHeading({
  label,
  count,
  first,
}: {
  label: string;
  count: number;
  first: boolean;
}) {
  const theme = useThemeTokens();
  const { _ } = useLinguiRuntime();
  useRenderTally('ArtifactDayHeading');
  const bucket = DAY_BUCKET_LABEL[label as keyof typeof DAY_BUCKET_LABEL];
  const spoken = bucket ? _(bucket) : label;
  return (
    <SheetSceneGroupHeading
      title={spoken}
      first={first}
      meta={
        <Text variant="caption" color={theme.colors.textSubtle}>
          {count}
        </Text>
      }
    />
  );
});

/**
 * One file.
 *
 * Memoized, and handed the asset object rather than a closure over it: the row
 * only re-renders when `groupByDay` hands out a new object for it, which it
 * only does when the file itself has changed. `onOpen` takes the asset for the
 * same reason -- a fresh `() => setOpenAsset(item.asset)` per render would be a
 * new prop on every rebuild and would undo the memo on every row.
 *
 * A scene row, so there is no fill and no radius under it: the thumbnail is the
 * only rounded thing left, because a picture of a file is the one piece of a
 * row that is genuinely an object rather than text.
 */
const AssetRow = memo(function AssetRow({
  asset,
  onOpen,
  separated,
}: {
  asset: SessionAsset;
  onOpen: (asset: SessionAsset) => void;
  /** Whether a file stands above this one, and so whether a hairline does. */
  separated: boolean;
}) {
  const { t } = useLingui();
  useRenderTally('ArtifactRow');
  const relativeTime = useRelativeTime();
  const theme = useThemeTokens();
  const thumbnail = asset.kind === 'image' && asset.previewable ? assetImageSource(asset) : null;
  const detail = [formatAssetSize(asset.size), relativeTime(asset.modified_unix_ms)]
    .filter(Boolean)
    .join(' \u00b7 ');

  return (
    <SheetSceneRow
      title={asset.name}
      caption={detail}
      accessibilityLabel={t`Open ${asset.name}`}
      onPress={() => onOpen(asset)}
      style={
        separated
          ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border }
          : undefined
      }
      leading={
        /* A picture of the file beats a glyph that says "this is a picture". */
        <View
          style={[
            styles.assetIcon,
            thumbnail ? { backgroundColor: theme.colors.background } : null,
          ]}>
          {thumbnail ? (
            <Image
              source={{ uri: thumbnail.uri, headers: thumbnail.headers }}
              cachePolicy="memory-disk"
              recyclingKey={thumbnail.cacheKey}
              contentFit="cover"
              style={styles.thumbnail}
            />
          ) : (
            <AssetKindIcon kind={asset.kind} color={theme.colors.textMuted} />
          )}
        </View>
      }
    />
  );
});

function AssetKindIcon({ kind, color }: { kind: AssetKind; color: string }) {
  if (kind === 'image') return <FileImage size={18} color={color} />;
  if (kind === 'markdown') return <FileText size={18} color={color} />;
  if (kind === 'text') return <FileCode size={18} color={color} />;
  if (kind === 'pdf') return <FileType size={18} color={color} />;
  return <FileIcon size={18} color={color} />;
}

/** An older gateway simply has no asset routes; that is not a failure to report. */
function isMissingEndpoint(failure: unknown): boolean {
  return failure instanceof Error && /^HTTP 40[45]:/.test(failure.message);
}

const styles = StyleSheet.create({
  // No `gap`, no fill, no radius: the scene's gutter is on the content
  // container already and the rows sit straight on the ground. `flexGrow` is
  // what makes this a full-height sheet, and it is not decoration. The route
  // asks for a single detent, and react-native-screens answers a single detent
  // with `isFitToContents` -- the sheet is as tall as the content laid out to,
  // with the detent only a cap. Without it a short listing gave a short sheet
  // and an empty one gave a stub.
  listContent: {
    flexGrow: 1,
  },
  // A Pad gets a reading measure rather than a second column of files.
  padListContent: {
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
  },
  footer: {
    alignItems: 'center',
    paddingTop: 12,
  },
  assetIcon: {
    width: 34,
    height: 34,
    borderRadius: appChrome.radius.control,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbnail: {
    width: '100%',
    height: '100%',
  },
  // No `flex: 1` any more: this is a row now, and a row in a virtualized list
  // is as tall as it measures. The height it used to take from the container
  // comes down on the row itself -- see the `height` field on `FilesRow`.
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  centerText: {
    textAlign: 'center',
  },
});

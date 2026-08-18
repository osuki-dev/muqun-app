import { LegendList, type LegendListRenderItemProps } from '@legendapp/list/react-native';
import { Trans, useLingui } from '@lingui/react/macro';
import { SearchInput, Text, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import {
  File as FileIcon,
  FileCode,
  FileImage,
  FileText,
  FileType,
  RefreshCw,
  X,
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
import { GlassChrome } from '@/components/glass-chrome';
import { PressableScale } from '@/components/pressable-scale';
import { formatAssetSize } from '@/lib/asset-display';
import { useRelativeTime } from '@/hooks/use-relative-time';
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
 * nothing to show. That is not available here: the search field and the kind
 * chips are the list's own header (see `header` below for why they have to be),
 * so unmounting the list would tear down the field mid-keystroke and take the
 * keyboard with it. So this list is simply never handed an empty array -- the
 * empty state is a row -- and the crashing branch is never reached at all.
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
 * this is only what it starts from. A file row is a 56pt card plus the list's
 * 8pt gap; a day heading is about half that, and the empty row is measured the
 * moment it appears.
 */
const ESTIMATED_ROW_HEIGHT = 64;

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
 * File cards share Pad rows, while chronology and empty-state copy keep the
 * whole reading width. Legend List owns the placement, so spanning belongs in
 * its layout callback rather than in wrappers around individual rows.
 */
function filesGridItemLayout(
  layout: { span?: number },
  row: FilesRow,
  _index: number,
  maxColumns: number
): void {
  if (row.type !== 'asset') layout.span = maxColumns;
}

/**
 * The gateway kinds behind each chip.
 *
 * A chip is the question a person asks -- "docs" -- and a kind is what the
 * scanner sniffed off the bytes; "docs" is two of them. These go to the gateway
 * so the filtering happens where the files are. `all` sends nothing and keeps
 * the plain newest-N listing.
 */
const FILTER_KINDS: Record<KindFilter, readonly AssetKind[]> = {
  all: [],
  image: ['image'],
  document: ['markdown', 'pdf'],
  code: ['text'],
};

/**
 * Applied again to what comes back, because a gateway too old to know `kind=`
 * answers with everything and the chip still has to mean something.
 */
function matchesFilter(asset: SessionAsset, filter: KindFilter): boolean {
  const kinds = FILTER_KINDS[filter];
  return kinds.length === 0 || kinds.includes(asset.kind);
}

export function SessionArtifacts({

  sessionId,
  tabId,
  label,
  onClose,
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
  onClose: () => void;
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

  // The chip labels are built here, in the body that holds the hook, and not in
  // a module helper handed a `t` parameter. The Lingui babel macro rewrites
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
  // Each chip carries its spoken label as its own message rather than as
  // ``Show ${label.toLowerCase()}``. Concatenation looks like it translates --
  // the noun is a message, after all -- but the verb around it never was, so
  // VoiceOver in zh-TW read "Show 圖片": an English sentence with a Chinese word
  // dropped into it. Half a sentence per language is worse than none, because
  // the reader cannot tell whether they misheard. Nor does `toLowerCase()` mean
  // anything outside a cased script; it is a no-op on Chinese and wrong in the
  // languages where the noun is capitalised for grammar rather than for style.
  const filters: { value: KindFilter; label: string; spokenLabel: string }[] = [
    { value: 'all', label: t`All`, spokenLabel: t`Show all files` },
    { value: 'image', label: t`Images`, spokenLabel: t`Show images` },
    { value: 'document', label: t`Docs`, spokenLabel: t`Show documents` },
    { value: 'code', label: t`Code`, spokenLabel: t`Show code` },
  ];

  const theme = useThemeTokens();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isPadLayout = responsiveWorkspaceLayout(width).mode === 'pad';
  const fileColumns = isPadLayout ? 2 : 1;
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

  // Keyed on the chip and on the window as well as the session: the filter is
  // the gateway's job now, so changing it is a new question to ask rather than
  // a narrower way of reading the answer already in hand, and so is asking for
  // more of the listing.
  const load = useCallback(async () => {
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
      });
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
      setLoading(false);
      setLoadingMore(false);
    }
  }, [filter, sessionId, t, windowSize, tabId]);

  useEffect(() => {
    void load();
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
        matchesFilter(asset, filter)
        // Path as well as name: the way to find one of five `index.ts` is to
        // type the directory that tells them apart.
        && (!needle
          || asset.name.toLowerCase().includes(needle)
          || asset.path.toLowerCase().includes(needle))
    );
    // eslint-disable-next-line react-hooks/refs -- deliberate: the ref carries last render's rows in so unchanged ones keep their objects. Nothing is rendered *from* it -- the rows returned are, and they are recomputed from the props and state in the dependency list.
    const next = groupByDay(matching, loadedAt, previousRowsRef.current);
    // eslint-disable-next-line react-hooks/refs -- deliberate: the same idempotent derivation, written back. Building twice from the same assets returns the same objects.
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
   * A chip is a new question, so the window it was asked with goes back to the
   * first page. Keeping a widened one would ask the gateway to scan for two
   * hundred images because the reader had once paged through the documents.
   */
  function chooseFilter(value: KindFilter) {
    if (value === filter) return;
    setFilter(value);
    setWindowSize(SESSION_ASSET_PAGE_LIMIT);
    setAtEnd(false);
  }

  // What the empty row has to fill, measured rather than declared: see the
  // `height` field on `FilesRow`. Both handlers write only when the number has
  // actually moved, so a layout pass that reports the same size does not
  // re-render the sheet.
  const [viewportHeight, setViewportHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const listBottomPadding = insets.bottom + 40;
  const onListLayout = useCallback((event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    setViewportHeight((current) => (Math.abs(current - height) < 1 ? current : height));
  }, []);
  const onHeaderLayout = useCallback((event: LayoutChangeEvent) => {
    const { height } = event.nativeEvent.layout;
    setHeaderHeight((current) => (Math.abs(current - height) < 1 ? current : height));
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
      // The viewport, less the header above this row and the padding the
      // content container keeps below it -- which together are exactly what
      // `flex: 1` used to be given.
      height: Math.max(MIN_EMPTY_HEIGHT, viewportHeight - headerHeight - listBottomPadding),
    }),
    [assets.length, available, error, headerHeight, listBottomPadding, t, viewportHeight]
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
    ({ item }: LegendListRenderItemProps<FilesRow>) => {
      if (item.type === 'heading') return <DayHeading label={item.label} count={item.count} />;
      if (item.type === 'asset') return <AssetRow asset={item.asset} onOpen={openRow} />;
      return <EmptyState row={item} />;
    },
    [openRow]
  );

  /**
   * Everything above the list -- title, search, filters -- as the list's own
   * header rather than as siblings above it.
   *
   * react-native-screens lays a form sheet out specially when its content is a
   * scrolling view, and warns "FormSheet with ScrollView expects at most 2
   * subviews" as soon as anything else shares the container, after which the
   * sheet renders empty. So the list is the sheet's root and everything else
   * rides inside it -- which also means the controls scroll away with the
   * content instead of eating a third of a phone screen forever.
   */
  const header = (
    <View style={styles.headerBlock} onLayout={onHeaderLayout}>
      {/* The panels sheet draws this and this one did not, which is the sort of
          difference that reads as two different apps. Android only: iOS has the
          system grabber. */}
      {process.env.EXPO_OS === 'android' ? <View style={styles.sheetHandle} /> : null}
      <View style={styles.header}>
        <View style={styles.flexOne}>
          <Text variant="bodySmall" style={styles.headerTitle}>
            <Trans>Files</Trans>
          </Text>
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
            {label}
          </Text>
        </View>
        {/* The same chrome as the panels sheet, from the same component: two
            sheets whose close buttons were different materials would read as
            two apps. `sheet`, not `floating` -- see `GlassChrome`. */}
        <GlassChrome face="sheet" style={styles.iconButton}>
          <PressableScale
            accessibilityLabel={t`Refresh files`}
            onPress={() => void load()}
            style={styles.iconButtonHit}>
            {loading ? (
              <ActivityIndicator size="small" color={theme.colors.primary} />
            ) : (
              <RefreshCw size={17} color={theme.colors.textMuted} />
            )}
          </PressableScale>
        </GlassChrome>
        <GlassChrome face="sheet" style={styles.iconButton}>
          <PressableScale
            accessibilityLabel={t`Close files`}
            onPress={onClose}
            style={styles.iconButtonHit}>
            <X size={18} color={theme.colors.text} />
          </PressableScale>
        </GlassChrome>
      </View>

      {available ? (
        <>
          <SearchInput
            value={query}
            onChangeText={setQuery}
            placeholder={t`Search files`}
            accessibilityLabel={t`Search files`}
            // The library input stretches itself and pins its 22pt line to the
            // top of the taller field; centering has to be reasserted here
            // until the kit fixes alignSelf.
            inputStyle={{ alignSelf: 'center' }}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.filterRow}>
            {filters.map((entry) => {
              const selected = entry.value === filter;
              // No chip greys itself out any more. It used to disable itself
              // when the page in hand held none of its kind, which stopped
              // being true the moment the filtering moved to the gateway: what
              // is in hand is one page of `all`, and "no images among the
              // newest hundred" is not "no images". The chip is the question;
              // the answer only exists after it has been asked.
              return (
                <PressableScale
                  key={entry.value}
                  accessibilityLabel={entry.spokenLabel}
                  onPress={() => chooseFilter(entry.value)}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: selected
                        ? theme.colors.primary
                        : theme.colors.surfaceRaised,
                    },
                  ]}>
                  <Text
                    variant="caption"
                    color={selected ? theme.colors.onPrimary : theme.colors.text}>
                    {entry.label}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </>
      ) : null}
    </View>
  );

  return (
    <RenderTally id="files">
      <LegendList
        data={listRows}
        keyExtractor={keyOfRow}
        renderItem={renderRow}
        numColumns={fileColumns}
        overrideItemLayout={filesGridItemLayout}
        columnWrapperStyle={isPadLayout ? styles.fileGrid : undefined}
        // The other half of the identity deal, stated to the list: a row whose
        // object has not changed has not changed. `groupByDay` is handed the
        // previous rows and guarantees exactly that, so the strictest possible
        // comparison is both the correct one and the cheapest.
        itemsAreEqual={rowsAreEqual}
        // Never. The argument above is stable row objects plus `React.memo`;
        // recycling a row into another row's props is the one thing that would
        // undo it -- and it would hand a file's thumbnail to a day heading.
        recycleItems={false}
        // A day heading and a file card are half an inch apart in height, and a
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
        style={[styles.sheet, { backgroundColor: theme.colors.surface }]}
        // `flexGrow` is what makes this a full-height sheet, and it is not
        // decoration. The route asks for a single detent, and react-native-
        // screens answers a single detent with `isFitToContents` -- the sheet
        // is as tall as the content laid out to, with the detent only a cap.
        // Without it a short listing gave a short sheet and an empty one gave a
        // stub. The panels sheet is full height for an unrelated reason: two
        // detents pin a 0.65 peek. This is the frame `ScrollScreen` would have
        // supplied, written out because the list has to be the sheet's own root.
        contentContainerStyle={[
          styles.listContent,
          isPadLayout && styles.padListContent,
          { paddingBottom: listBottomPadding },
        ]}
        ListHeaderComponent={header}
        // The gap the content container used to leave here.
        //
        // Legend List cannot keep `gap` on the content container -- its rows are
        // positioned rather than laid out in flow -- so it lifts the value off
        // and re-applies it as trailing padding on each row. That reproduces the
        // space between rows exactly and loses the one between the header and
        // the first row, which is the only place the gap was doing something a
        // row's own padding does not. Eight, because that is the gap; checked
        // by putting the e2e flow's screenshot of the sheet beside the one the
        // FlatList version took, where the first day heading now lands on the
        // same pixel row it did.
        ListHeaderComponentStyle={styles.listHeader}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={theme.colors.textMuted}
            colors={[theme.colors.primary]}
          />
        }
        // The page in flight, said where it is being waited for. The header's
        // refresh control already spins for a re-read of the same window; this
        // is the one at the bottom, under the oldest file in hand, and it
        // carries no words of its own -- a spinner where the next rows will
        // appear says what it is doing without a string to translate.
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footer}>
              <ActivityIndicator size="small" color={theme.colors.textMuted} />
            </View>
          ) : null
        }
      />
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
const EmptyState = memo(function EmptyState({ row }: { row: Extract<FilesRow, { type: 'empty' }> }) {
  const theme = useThemeTokens();
  if (!row.unavailable && !row.text) return <View style={{ height: row.height }} />;
  return (
    <View style={[styles.centerState, { height: row.height }]}>
      <Text variant="bodySmall" color={theme.colors.textMuted} style={styles.centerText}>
        {row.unavailable ? (
          <Trans>
            This gateway does not serve files yet. Update the Muqun gateway plugin to browse what
            a session writes.
          </Trans>
        ) : (
          row.text
        )}
      </Text>
    </View>
  );
});

/**
 * The day is a rule across the list rather than another chip: it separates, it
 * is not something you press.
 */
const DayHeading = memo(function DayHeading({ label, count }: { label: string; count: number }) {
  const theme = useThemeTokens();
  useRenderTally('ArtifactDayHeading');
  return (
    <View style={styles.dayHeading}>
      <Text variant="caption" color={theme.colors.textMuted} style={styles.eyebrow}>
        {label.toUpperCase()}
      </Text>
      <View style={[styles.rule, { backgroundColor: theme.colors.border }]} />
      <Text variant="caption" color={theme.colors.textMuted}>
        {count}
      </Text>
    </View>
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
 */
const AssetRow = memo(function AssetRow({
  asset,
  onOpen,
}: {
  asset: SessionAsset;
  onOpen: (asset: SessionAsset) => void;
}) {
  const { t } = useLingui();
  useRenderTally('ArtifactRow');
  const relativeTime = useRelativeTime();
  const theme = useThemeTokens();
  const thumbnail = asset.kind === 'image' && asset.previewable ? assetImageSource(asset) : null;
  const detail = [formatAssetSize(asset.size), relativeTime(asset.modified_unix_ms)]
    .filter(Boolean)
    .join(' · ');

  return (
    <PressableScale
      accessibilityLabel={t`Open ${asset.name}`}
      onPress={() => onOpen(asset)}
      style={[
        styles.assetRow,
        { backgroundColor: theme.colors.surfaceRaised },
      ]}>
      {/* A picture of the file beats a glyph that says "this is a picture". */}
      <View style={[styles.assetIcon, { backgroundColor: theme.colors.background }]}>
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
      <View style={styles.flexOne}>
        <Text variant="bodySmall" numberOfLines={1}>
          {asset.name}
        </Text>
        <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
          {detail}
        </Text>
      </View>
    </PressableScale>
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
  sheet: {
    flex: 1,
  },
  headerBlock: {
    paddingTop: 10,
    paddingBottom: 4,
    gap: 12,
  },
  sheetHandle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(127, 127, 127, 0.36)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    fontSize: 20,
    lineHeight: 25,
    includeFontPadding: false,
  },
  // Shape only; the fill comes from `GlassChrome`, as it does in the panels
  // sheet and in the server page's header circles.
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderCurve: 'continuous',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonHit: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flexOne: {
    flex: 1,
    minWidth: 0,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterChip: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: {
    // See the call site for why `flexGrow` is here.
    flexGrow: 1,
    paddingHorizontal: 16,
    gap: 8,
  },
  padListContent: {
    width: '100%',
    maxWidth: 1040,
    alignSelf: 'center',
    paddingHorizontal: 24,
    // Legend List receives the Pad row/column gaps explicitly below. Keeping
    // the compact content gap as well would double the space between grid rows.
    gap: 0,
  },
  fileGrid: {
    columnGap: 10,
    rowGap: 8,
  },
  // See `ListHeaderComponentStyle` at the call site.
  listHeader: {
    paddingBottom: 8,
  },
  footer: {
    alignItems: 'center',
    paddingTop: 12,
  },
  dayHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 10,
    paddingBottom: 2,
  },
  eyebrow: {
    letterSpacing: 0.8,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  assetRow: {
    minHeight: 56,
    borderRadius: 15,
    borderCurve: 'continuous',
    paddingHorizontal: 10,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  assetIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
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

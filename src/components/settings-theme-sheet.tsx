/**
 * The themes sheet: what the app is wearing, and every theme it could wear.
 *
 * One sheet, three tabs -- the reader's own themes, the ones that ship with the
 * app, and the published gallery -- over one card grid, so a theme looks the
 * same in every list it appears in. The gallery used to be a sheet of its own
 * opened from this one, which stacked three sheets before a reader saw a
 * catalogue theme; it is a tab now, and a theme's detail is the only level
 * under this sheet.
 *
 * The whole sheet is one virtualized list, and that list is the sheet's scroll
 * view: the heading, the current-theme bar and the tabs are its header, the
 * gallery's search is a sticky row, every card row has a known height, and the
 * notes and the end of the catalogue are rows too. A fixed block above a
 * nested list left the native form sheet nothing to hand a drag to on Android.
 * Switching tabs keeps the header and swaps the rows.
 *
 * The slim bar at the top is the current theme: its picture, its name, and
 * the two things a reader does to the theme they are wearing -- Customise,
 * which opens its detail, and Restore default, which only a custom theme has a
 * use for. Destructive actions are never in the grid: Remove lives in a card's
 * long-press menu and in the detail, and asks before it acts.
 *
 * Which tab is open is remembered for the session. A reader with no themes of
 * their own starts on the gallery, where the themes are.
 */
import { useMeasuredSideInsets } from '@/hooks/use-side-insets';
import { LegendList, type LegendListRef } from '@legendapp/list/react-native';
import { useLingui } from '@lingui/react/macro';
import { Button, PressableScale, Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentActionMenu, type AgentActionMenuItem } from '@/components/agent-action-menu';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useReskinTransition } from '@/components/reskin-transition';
import { SettingsSegmented } from '@/components/settings-segmented';
import { SheetFrame } from '@/components/sheet-ground';
import { SheetHandle, useSheetIsFullscreen } from '@/components/sheet-route-frame';
import {
  SheetSceneClose,
  SheetSceneFooter,
  SheetSceneHeading,
  SheetSceneQuietAction,
  SHEET_LADDER,
} from '@/components/sheet-scene';
import {
  THEME_GRID_GAP,
  ThemeCard,
  ThemeCardPreview,
  ThemeCardSkeleton,
  ThemeImportCard,
  themeGridLayout,
  type ThemeCardAction,
  type ThemeGridLayout,
} from '@/components/theme-card';
import { GalleryCard, GalleryFooter, GalleryNote, GallerySearch } from '@/components/theme-gallery';
import { ThemeImportProgress } from '@/components/theme-import-progress';
import { ThemeLinkImport } from '@/components/theme-link-import';
import { appChrome } from '@/constants/appearance';
import {
  THEME_PACKS,
  resolveThemePack,
  themeVariant,
  type ThemeAppearance,
  type ThemePack,
  type ThemePackId,
} from '@/constants/theme-packs';
import { useOpenThemeEditor } from '@/hooks/use-open-theme-editor';
import { useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';
import { useThemeGallery } from '@/hooks/use-theme-gallery';
import { useThemePack } from '@/hooks/use-theme-pack';
import { AppearanceIcon, DeleteIcon, UploadFileIcon } from '@/icons';
import { recoverWith, settleAfter } from '@/lib/compiler-safe-control-flow';
import { carryBox, carryForward } from '@/lib/carry-forward';
import { withAlpha } from '@/lib/color';
import { fadeIn, fadeInDown, fadeOut, fadeOutDown, STAGGER } from '@/lib/motion';
import { useRenderTally } from '@/lib/render-tally';
import { loadThemeTab, saveThemeTab, type ThemeTab } from '@/lib/theme-tab-preference';
import { chunkCardRows, type CardRow } from '@/lib/theme-grid-rows';
import { THEME_PICKER_MAX_CONTENT_WIDTH } from '@/lib/theme-picker-layout';
import { useThemeLibrary } from '@/stores/theme-library';
import { exportInstalledTheme } from '@/theme/assets';
import type { ThemeIndexEntry } from '@/theme/gallery';
import { pickThemeManifest, shareThemeFile, type ThemeFileStage } from '@/theme/local-files';
import { prepareThemeArtwork } from '@/theme/prepare-artwork';
import { isRenderableThemeAsset } from '@/theme/renderable-asset';
import { BUILTIN_THEME_INSTALLATION_ID, type InstalledTheme } from '@/theme/repository';
import type { ThemeManifest } from '@/theme/schema';
import { sheetFrostAlpha, surfaceBackgroundFill } from '@/theme/surface-background';

/** How far into a grid the first arrival keeps counting. */
const STAGGER_CAP = 8;

/** The current bar's thumbnail, and the gap between it and the copy. */
const CURRENT_PREVIEW_WIDTH = 56;
const CURRENT_IDENTITY_GAP = 12;

/** Placeholder rows while the catalogue is read. */
const SKELETON_ROWS = 2;

/** One cell of a card row. */
type Cell =
  | { kind: 'installed'; theme: InstalledTheme }
  | { kind: 'import' }
  | { kind: 'default' }
  | { kind: 'pack'; pack: ThemePack }
  | { kind: 'entry'; entry: ThemeIndexEntry }
  | { kind: 'skeleton'; key: string };

/**
 * The sticky bar every tab's list starts with: the gallery's search and tags,
 * or nothing, at no height, on the tabs that have no search.
 *
 * Always there, so the list's sticky index never changes. Toggling it handed
 * the scroll view a different scroll handler on every tab switch and while the
 * catalogue loaded, and the sticky row's offset stopped following the scroll
 * while it was off -- coming back to the gallery drew the search over the
 * cards until the next scroll event.
 */
type BarRow =
  | { kind: 'bar'; key: 'bar:none'; search: null }
  | { kind: 'bar'; key: 'search'; search: { query: string; tags: readonly string[] } };

/** One row of the sheet's list. Card rows and the empty bar have fixed heights. */
type Row =
  | BarRow
  | CardRow<Cell>
  | { kind: 'mine-empty'; key: 'mine-empty' }
  | { kind: 'gallery-note'; key: string; note: 'failed' | 'no-match' | 'none'; query: string };

const NO_BAR: BarRow = { kind: 'bar', key: 'bar:none', search: null };
const MINE_EMPTY: Row = { kind: 'mine-empty', key: 'mine-empty' };
/** The bar is the list's first row in every tab. */
const STICKY_BAR = [0];

type CardMenu = { title: string; actions: readonly ThemeCardAction[] };

/** A theme's own published picture, when the files are on this device. */
function coverOf(manifest: ThemeManifest, assets?: Record<string, string>): string | null {
  const uri = manifest.preview ? assets?.[manifest.preview] : undefined;
  return isRenderableThemeAsset(uri) ? (uri ?? null) : null;
}

function cellKey(cell: Cell): string {
  switch (cell.kind) {
    case 'installed':
      return `mine:${cell.theme.id}`;
    case 'import':
      return 'mine:import';
    case 'default':
      return 'builtin:default';
    case 'pack':
      return `builtin:${cell.pack.id}`;
    case 'entry':
      return `gallery:${cell.entry.id}`;
    case 'skeleton':
      return `skeleton:${cell.key}`;
  }
}

/** Whether two cells draw the same theme: the cell objects are rebuilt every render. */
function sameCell(a: Cell, b: Cell): boolean {
  switch (a.kind) {
    case 'installed':
      return b.kind === 'installed' && a.theme === b.theme;
    case 'pack':
      return b.kind === 'pack' && a.pack === b.pack;
    case 'entry':
      return b.kind === 'entry' && a.entry === b.entry;
    case 'skeleton':
      return b.kind === 'skeleton' && a.key === b.key;
    case 'import':
      // Its state (open, busy) reaches it through the list's `extraData`.
      return b.kind === 'import';
    case 'default':
      // Drawn from the library's default theme, which the cell does not carry.
      return false;
  }
}

function keyOfRow(row: Row): string {
  return row.key;
}

function typeOfRow(row: Row): Row['kind'] {
  return row.kind;
}

export function SettingsThemeSheet({
  onClose,
  initialTab,
}: {
  onClose: () => void | Promise<void>;
  /** A link that asked for a tab: the old Browse route asks for the gallery. */
  initialTab?: ThemeTab;
}) {
  // `t` from the hook, not the global `t` from `@lingui/core/macro` -- see the
  // note at the top of the settings screen for why.
  const { t } = useLingui();
  useRenderTally('SettingsThemeSheet');
  const { colors } = useThemeTokens();
  const openEditor = useOpenThemeEditor();
  const reskin = useReskinTransition();
  const { resolvedMode } = useThemeMode();
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const fullscreen = useSheetIsFullscreen();

  const themes = useThemeLibrary((state) => state.library.themes);
  const selection = useThemeLibrary((state) => state.library.selection);
  const defaultTheme = useThemeLibrary((state) => state.defaultTheme);
  const defaultAssets = useThemeLibrary((state) => state.defaultAssets);
  const defaultActive = useThemeLibrary(
    (state) => state.active?.installationId === BUILTIN_THEME_INSTALLATION_ID
  );
  const themePack = useThemePack();
  const currentCustomId = selection?.kind === 'custom' ? selection.id : null;

  const [tab, setTab] = useState<ThemeTab>(
    () => initialTab ?? loadThemeTab() ?? (themes.length > 0 ? 'mine' : 'gallery')
  );
  // The tab the sheet opened on is the only one whose cards rise in; a tab
  // switch cross-fades the cards that replace the old ones instead.
  const [openedOn] = useState(tab);
  const [switchedAt, setSwitchedAt] = useState<number | undefined>(undefined);
  const [revealed] = useState(() => new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<CardMenu | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [linkImportOpen, setLinkImportOpen] = useState(false);
  const [readStage, setReadStage] = useState<ThemeFileStage | null>(null);
  const [busy, setBusy] = useState(false);
  const [listWidth, setListWidth] = useState(0);
  const listRef = useRef<LegendListRef>(null);
  // Where the grid starts: the list header's height, as the list measured it.
  const gridStart = useRef(0);

  const gallery = useThemeGallery({ enabled: tab === 'gallery', onReady: openEditor });

  // The column the content sits in: the sheet's gutter on both sides, and on a
  // wide Pad no wider than the cap, centred. Cards, tabs and the bar share it.
  // A phone's sheet is as wide as the window and its top corner runs under a
  // side status bar (iPhone Duo): the column keeps clear of it.
  const side = useMeasuredSideInsets();
  const sheetWidth = (listWidth || window.width) - side.left - side.right;
  const columnWidth = Math.min(
    sheetWidth - SHEET_LADDER.gutter * 2,
    THEME_PICKER_MAX_CONTENT_WIDTH
  );
  const layout = themeGridLayout(columnWidth, window.fontScale);
  const column = { width: columnWidth, alignSelf: 'center' as const };

  function chooseTab(next: ThemeTab) {
    if (next === tab) return;
    setMenu(null);
    setSwitchedAt(Date.now());
    setTab(next);
    saveThemeTab(next);
  }

  /**
   * Apply under the reskin cover, then leave once the new theme has painted.
   *
   * Closing in the same turn as the write made the sheet dismissal and the
   * ripple reveal fight, and Home showed through while it was still painting.
   * The write stays in `apply`; the sheet leaves in `settle`, one frame before
   * the cover lifts. The new theme's primary is what the wash's front is lit
   * in: the one moment that tells the reader in colour what they just chose.
   */
  function wear(options: {
    pack: Pick<ThemeAppearance, 'light' | 'dark'>;
    prepare?: () => ReturnType<typeof prepareThemeArtwork>;
    apply: () => void;
  }) {
    setError(null);
    setMenu(null);
    void reskin
      .run({
        kind: 'theme',
        accent: themeVariant(options.pack, resolvedMode).colors.primary,
        prepare: options.prepare,
        apply: options.apply,
        settle: onClose,
      })
      .catch(() => {
        // A rejected apply skips settle; say so once the cover is gone.
        setError(t`Could not save theme`);
      });
  }

  function choosePack(id: ThemePackId) {
    wear({
      pack: resolveThemePack(id),
      apply: () => useThemeLibrary.getState().apply({ kind: 'builtin', id }),
    });
  }

  function chooseDefault() {
    const builtin = useThemeLibrary.getState().defaultTheme;
    if (!builtin) return;
    wear({
      pack: builtin,
      prepare: () =>
        prepareThemeArtwork(
          builtin.manifest,
          useThemeLibrary.getState().defaultAssets,
          resolvedMode,
          window.width
        ),
      apply: () => useThemeLibrary.getState().resetToDefault(),
    });
  }

  function chooseCustom(theme: InstalledTheme) {
    wear({
      pack: theme.manifest.variants,
      prepare: () => prepareThemeArtwork(theme.manifest, theme.assets, resolvedMode, window.width),
      apply: () => useThemeLibrary.getState().apply({ kind: 'custom', id: theme.id }),
    });
  }

  function openInstalled(theme: InstalledTheme) {
    setMenu(null);
    openEditor({ manifest: theme.manifest, id: theme.id, assets: theme.assets });
  }

  /** One guarded piece of work at a time, with its failure said in the header. */
  function perform(action: () => void | Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    void settleAfter(
      () =>
        recoverWith(
          async () => {
            await action();
          },
          (cause) => {
            setError(cause instanceof Error ? cause.message : t`Something went wrong`);
          }
        ),
      () => setBusy(false)
    );
  }

  function actionsFor(theme: InstalledTheme): readonly ThemeCardAction[] {
    const actions: ThemeCardAction[] = [];
    if (theme.id !== currentCustomId)
      actions.push({
        name: 'apply',
        label: t`Apply theme`,
        Icon: AppearanceIcon,
        run: () => chooseCustom(theme),
      });
    actions.push({
      name: 'export',
      label: t`Export theme`,
      Icon: UploadFileIcon,
      run: () =>
        perform(() =>
          shareThemeFile(`${theme.manifest.id}.muqun-theme`, exportInstalledTheme(theme), true)
        ),
    });
    actions.push({
      name: 'remove',
      label: t`Remove`,
      Icon: DeleteIcon,
      tone: 'danger',
      confirm: {
        label: t`Tap again to remove`,
        detail: t`The theme will be removed from this device`,
      },
      run: () => perform(() => useThemeLibrary.getState().remove(theme.id)),
    });
    return actions;
  }

  function openMenu(title: string, actions: readonly ThemeCardAction[]) {
    setError(null);
    setMenu({ title, actions });
  }

  function importFile() {
    perform(async () => {
      const value = await pickThemeManifest(setReadStage).finally(() => setReadStage(null));
      if (value === null) return;
      setImportOpen(false);
      openEditor(value);
    });
  }

  const currentKey = currentCustomId
    ? `custom:${currentCustomId}`
    : defaultActive
      ? 'default'
      : `pack:${themePack.id}`;
  const [openedWith] = useState(currentKey);
  const currentInstalled = currentCustomId
    ? themes.find((theme) => theme.id === currentCustomId)
    : undefined;
  const installedByManifest = new Map(themes.map((theme) => [theme.manifest.id, theme]));

  // ---- The rows of the tab on screen ----
  const galleryLoading = gallery.entries === null && !gallery.failed;
  const cells = useMemo((): Cell[] => {
    if (tab === 'mine')
      return [...themes.map((theme): Cell => ({ kind: 'installed', theme })), { kind: 'import' }];
    if (tab === 'builtin')
      return [
        ...(defaultTheme ? [{ kind: 'default' } as const] : []),
        ...THEME_PACKS.map((pack): Cell => ({ kind: 'pack', pack })),
      ];
    if (galleryLoading)
      return Array.from({ length: SKELETON_ROWS * layout.columns }, (_, index): Cell => ({
        kind: 'skeleton',
        key: String(index),
      }));
    return gallery.visible.map((entry): Cell => ({ kind: 'entry', entry }));
  }, [tab, themes, defaultTheme, galleryLoading, gallery.visible, layout.columns]);
  // Carried from the last build so a row whose cards did not change keeps its
  // identity, and the list leaves it alone; see `chunkCardRows`.
  const [previousCardRows] = useState(() => carryBox<CardRow<Cell>[]>([]));
  const cardRows = useMemo(
    () =>
      carryForward(previousCardRows, (previous) =>
        chunkCardRows(cells, layout.columns, layout.itemHeight, cellKey, sameCell, previous)
      ),
    [cells, layout.columns, layout.itemHeight, previousCardRows]
  );
  const hasSearch = tab === 'gallery' && (gallery.entries?.length ?? 0) > 0;
  const bar = useMemo(
    (): BarRow =>
      hasSearch
        ? { kind: 'bar', key: 'search', search: { query: gallery.query, tags: gallery.tags } }
        : NO_BAR,
    [hasSearch, gallery.query, gallery.tags]
  );
  const galleryNote =
    tab !== 'gallery' || galleryLoading
      ? null
      : gallery.failed
        ? 'failed'
        : gallery.visible.length === 0
          ? gallery.needle
            ? 'no-match'
            : 'none'
          : null;
  const noteQuery = galleryNote === 'no-match' ? gallery.query : '';
  const note = useMemo(
    (): Row | null =>
      galleryNote
        ? {
            kind: 'gallery-note',
            key: galleryNote === 'failed' ? 'gallery-failed' : 'gallery-empty',
            note: galleryNote,
            query: noteQuery,
          }
        : null,
    [galleryNote, noteQuery]
  );
  const rows: Row[] = [bar, ...cardRows];
  if (tab === 'mine' && themes.length === 0) rows.push(MINE_EMPTY);
  if (note) rows.push(note);

  /**
   * Everything a row draws that is not its own cells, as one string the list
   * compares cheaply: the list memoises a row on its item and this, so without
   * it the pressed card would keep its old markup and its progress could
   * never appear.
   */
  const rowState = [
    tab,
    currentCustomId ?? '',
    defaultActive ? 1 : 0,
    themePack.id,
    busy ? 1 : 0,
    importOpen ? 1 : 0,
    gallery.pending ?? '',
    gallery.progress?.phase ?? '',
    gallery.progress && gallery.progress.phase !== 'downloading'
      ? `${gallery.progress.completed}/${gallery.progress.total}`
      : '',
    gallery.brokenCount,
    themes.map((theme) => `${theme.id}:${theme.manifest.version}`).join(','),
    layout.itemHeight,
  ].join('|');

  function riseFor(cell: Cell, index: number) {
    const key = cellKey(cell);
    const rises =
      cell.kind === 'entry'
        ? openedOn === 'gallery' || gallery.arrivedLive
        : cell.kind !== 'skeleton' && openedOn === tab;
    const offset = cell.kind === 'entry' ? Math.max(index - gallery.pageStart, 0) : index;
    return {
      revealed,
      key,
      delay: Math.min(offset, STAGGER_CAP) * STAGGER.row,
      enabled: rises,
      switchedAt,
    };
  }

  function renderCell(cell: Cell, index: number, cardLayout: ThemeGridLayout) {
    const rise = riseFor(cell, index);
    switch (cell.kind) {
      case 'skeleton':
        return (
          <ThemeCardSkeleton
            layout={cardLayout}
            accessibilityLabel={index === 0 ? t`Loading themes…` : undefined}
          />
        );
      case 'import':
        return (
          <ThemeImportCard
            layout={cardLayout}
            rise={rise}
            expanded={importOpen}
            disabled={busy}
            onPress={() => {
              setLinkImportOpen(false);
              setImportOpen(!importOpen);
            }}
          />
        );
      case 'installed': {
        const { theme } = cell;
        const current = theme.id === currentCustomId;
        const actions = actionsFor(theme);
        return (
          <ThemeCard
            testID={`theme-row-${theme.manifest.id}`}
            name={theme.manifest.name}
            caption={theme.manifest.author ?? t`Imported`}
            layout={cardLayout}
            current={current}
            rise={rise}
            disabled={busy}
            accessibilityLabel={
              current ? `${theme.manifest.name}, ${t`Current`}` : theme.manifest.name
            }
            actions={actions}
            onPress={() => openInstalled(theme)}
            onLongPress={() => openMenu(theme.manifest.name, actions)}
            preview={
              <ThemeCardPreview
                image={coverOf(theme.manifest, theme.assets)}
                pack={theme.manifest.variants}
              />
            }
          />
        );
      }
      case 'default':
        if (!defaultTheme) return null;
        return (
          <ThemeCard
            // The id carries the selection state, because the flows that drive
            // this grid match on it: a role reads differently on the two
            // runtimes.
            testID={`settings-selection:${defaultActive ? 'on' : 'off'}:theme-builtin`}
            name={defaultTheme.label}
            caption={t`Default`}
            layout={cardLayout}
            current={defaultActive}
            rise={rise}
            accessibilityLabel={
              defaultActive ? `${defaultTheme.label}, ${t`Current`}` : defaultTheme.label
            }
            onPress={chooseDefault}
            preview={
              <ThemeCardPreview
                image={coverOf(defaultTheme.manifest, defaultAssets)}
                pack={defaultTheme}
              />
            }
          />
        );
      case 'pack': {
        const { pack } = cell;
        const current = pack.id === themePack.id;
        return (
          <ThemeCard
            testID={`settings-selection:${current ? 'on' : 'off'}:theme-${pack.id}`}
            name={pack.label}
            caption={`${pack.lightName} · ${pack.darkName}`}
            layout={cardLayout}
            current={current}
            rise={rise}
            accessibilityLabel={current ? `${pack.label}, ${t`Current`}` : pack.label}
            onPress={() => choosePack(pack.id)}
            preview={<ThemeCardPreview pack={pack} />}
          />
        );
      }
      case 'entry': {
        const mine = installedByManifest.get(cell.entry.id);
        return (
          <GalleryCard
            entry={cell.entry}
            gallery={gallery}
            mine={mine}
            currentCustomId={currentCustomId}
            layout={cardLayout}
            rise={rise}
            actions={mine ? actionsFor(mine) : undefined}
            onOpenInstalled={openInstalled}
            onMenu={openMenu}
          />
        );
      }
    }
  }

  function renderRow(row: Row) {
    switch (row.kind) {
      case 'bar':
        if (!row.search) return null;
        // Opaque, edge to edge: the cards scroll under the bar, never show
        // through it. The frost's alpha let the reader's opacity thin it until
        // the captions of the cards beneath read between the chips.
        return (
          <View style={{ backgroundColor: withAlpha(colors.surface, 1) }}>
            <View style={column}>
              <GallerySearch gallery={gallery} />
            </View>
          </View>
        );
      case 'cards':
        return (
          <View style={[column, styles.cardRow, { height: layout.itemHeight }]}>
            {Array.from({ length: layout.columns }, (_, slot) => {
              const cell = row.cells[slot];
              return (
                <View key={cell ? cellKey(cell) : `empty:${slot}`} style={styles.cardCell}>
                  {cell ? renderCell(cell, row.start + slot, layout) : null}
                </View>
              );
            })}
          </View>
        );
      case 'mine-empty':
        return (
          <View testID="theme-mine-empty" style={[column, styles.emptyMine]}>
            <Text variant="bodySmall" color={colors.textMuted}>
              {t`No personal themes yet. Import one, or browse the published themes.`}
            </Text>
            <SheetSceneQuietAction
              testID="theme-browse-gallery"
              label={t`Browse the gallery`}
              onPress={() => chooseTab('gallery')}
            />
          </View>
        );
      case 'gallery-note':
        return (
          <View style={column}>
            <GalleryNote kind={row.note} gallery={gallery} />
          </View>
        );
    }
  }

  /**
   * A new search or tag is a new set of results, read from its first row: a
   * reader who was down the old results is brought back to the top of the
   * grid, with the bar stuck above it and the header left scrolled away. A
   * short way glides; a long way jumps, rather than streaming every old row
   * past. A reader still above the grid is not moved.
   */
  const revealGridStart = useEffectEvent(() => {
    const list = listRef.current;
    if (!list || tab !== 'gallery') return;
    const { scroll, scrollLength } = list.getState();
    const distance = scroll - gridStart.current;
    if (distance <= 1) return;
    void list.scrollToOffset({ offset: gridStart.current, animated: distance <= scrollLength });
  });
  useEffect(() => {
    revealGridStart();
  }, [gallery.needle]);

  const header = (
    <View
      style={[
        column,
        styles.header,
        { paddingTop: SHEET_LADDER.gap + (fullscreen ? insets.top : 0) },
      ]}>
      <SheetHandle />
      <SheetSceneHeading
        title={t`Themes`}
        caption={t`Terminal colours follow the theme.`}
        trailing={fullscreen ? <SheetSceneClose /> : undefined}
      />
      <CurrentThemeBar
        key={currentKey}
        name={themePack.label}
        source={
          currentInstalled
            ? (currentInstalled.manifest.author ?? t`Imported`)
            : defaultActive
              ? t`Default`
              : t`Built-in`
        }
        preview={
          <ThemeCardPreview
            image={
              currentInstalled
                ? coverOf(currentInstalled.manifest, currentInstalled.assets)
                : defaultActive && defaultTheme
                  ? coverOf(defaultTheme.manifest, defaultAssets)
                  : null
            }
            pack={themePack}
          />
        }
        onCustomise={currentInstalled ? () => openInstalled(currentInstalled) : undefined}
        onRestore={currentCustomId ? chooseDefault : undefined}
        busy={busy}
        animate={currentKey !== openedWith}
      />
      {error ? (
        <Animated.View entering={fadeIn('short')} exiting={fadeOut('micro')}>
          <Text variant="caption" color={colors.danger} accessibilityRole="alert" selectable>
            {error}
          </Text>
        </Animated.View>
      ) : null}
      <SettingsSegmented
        testID="theme-tab"
        value={tab}
        onChange={(value) => chooseTab(value as ThemeTab)}
        options={[
          { label: t`Mine`, value: 'mine' },
          { label: t`Built-in`, value: 'builtin' },
          { label: t`Gallery`, value: 'gallery' },
        ]}
      />
      {tab === 'mine' && importOpen ? (
        <Animated.View entering={fadeInDown('dropdown')} exiting={fadeOutDown('micro')}>
          {linkImportOpen ? (
            <ThemeLinkImport
              onClose={() => setLinkImportOpen(false)}
              onReady={(value) => {
                setLinkImportOpen(false);
                setImportOpen(false);
                openEditor(value);
              }}
            />
          ) : (
            <ImportChoices busy={busy} onLink={() => setLinkImportOpen(true)} onFile={importFile} />
          )}
        </Animated.View>
      ) : null}
      {readStage ? (
        <ThemeImportProgress
          testID="theme-read-progress"
          label={
            readStage.phase === 'staging'
              ? t`Installing images`
              : readStage.phase === 'unpacking'
                ? t`Reading the theme`
                : t`Opening that file`
          }
          completed={readStage.phase === 'staging' ? readStage.completed : undefined}
          total={readStage.phase === 'staging' ? readStage.total : undefined}
        />
      ) : null}
    </View>
  );

  const showGalleryFooter = tab === 'gallery' && gallery.entries !== null && gallery.total > 0;

  return (
    <SheetFrame testID="settings-theme-sheet" tint="surface" frosted>
      {/* One column, one scroller: the list is the view the native sheet
          hands its drags to, so it is a direct child of the frame's column
          and sets `nestedScrollEnabled` for Android's sheet behaviour. */}
      <View
        collapsable={false}
        style={[styles.sheet, { paddingLeft: side.left, paddingRight: side.right }]}
        onLayout={(event) => {
          side.onLayout(event);
          setListWidth(event.nativeEvent.layout.width);
        }}>
        <LegendList
          ref={listRef}
          onMetricsChange={(metrics) => {
            gridStart.current = metrics.headerSize;
          }}
          testID={
            tab === 'gallery'
              ? 'theme-browse-list'
              : tab === 'mine'
                ? 'theme-mine-grid'
                : 'theme-picker-grid'
          }
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          data={rows}
          // A tab, or a change of column count, is a different set of rows;
          // the list is told so rather than left to reuse positions.
          dataKey={`${tab}:${layout.columns}`}
          keyExtractor={keyOfRow}
          getItemType={typeOfRow}
          extraData={rowState}
          // Never: a card owns a picture, and recycling would hand one
          // theme's picture to another for a frame.
          recycleItems={false}
          getFixedItemSize={(row: Row) =>
            row.kind === 'cards'
              ? layout.itemHeight
              : row.kind === 'bar' && !row.search
                ? 0
                : undefined
          }
          estimatedItemSize={layout.itemHeight}
          stickyHeaderIndices={STICKY_BAR}
          onEndReached={tab === 'gallery' ? gallery.appendPage : undefined}
          onEndReachedThreshold={0.5}
          renderItem={({ item }: { item: Row }) => renderRow(item)}
          ListHeaderComponent={header}
          ListFooterComponent={
            <>
              {showGalleryFooter ? (
                <View style={column}>
                  <GalleryFooter gallery={gallery} />
                </View>
              ) : null}
              <SheetSceneFooter bottomInset={insets.bottom} />
            </>
          }
          style={styles.sheet}
        />
        {menu ? <CardMenuOverlay menu={menu} onClose={() => setMenu(null)} /> : null}
      </View>
    </SheetFrame>
  );
}

/**
 * The theme being worn, as one compact bar rather than a second big card.
 *
 * Its picture is the same one its card shows in the grid, so the two agree
 * about which theme is on. Keyed on the theme by the sheet, so a change of
 * theme cross-fades the bar's content instead of rewriting it in place.
 */
function CurrentThemeBar({
  name,
  source,
  preview,
  onCustomise,
  onRestore,
  busy,
  animate,
}: {
  name: string;
  source: string;
  preview: ReactNode;
  onCustomise?: () => void;
  onRestore?: () => void;
  busy: boolean;
  /** False for the theme the sheet opened on: it arrives with the sheet. */
  animate: boolean;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  // Whether everything fits on one line is measured, never guessed: the
  // bar's width, the copy's natural width and the buttons' natural width,
  // the last two from an invisible copy laid out without constraint. Until
  // all three are known, and whenever they do not fit, the buttons take a
  // second row -- the phone layout, where one row truncated both the label
  // and the name.
  const [barWidth, setBarWidth] = useState(0);
  const [copyWidth, setCopyWidth] = useState(0);
  const [actionsWidth, setActionsWidth] = useState(0);
  const hasActions = Boolean(onCustomise || onRestore);
  const oneRow =
    hasActions &&
    barWidth > 0 &&
    copyWidth > 0 &&
    actionsWidth > 0 &&
    CURRENT_PREVIEW_WIDTH + CURRENT_IDENTITY_GAP + copyWidth + SHEET_LADDER.snug + actionsWidth <=
      barWidth;

  const caption = `${t`Current theme`} · ${source}`;
  const buttons = (measuring: boolean) => (
    <>
      {onCustomise ? (
        <Button
          variant="secondary"
          testID={measuring ? undefined : 'theme-customise'}
          disabled={busy}
          style={measuring || oneRow ? undefined : styles.currentButton}
          onPress={onCustomise}>{t`Customise`}</Button>
      ) : null}
      {onRestore ? (
        <Button
          variant="ghost"
          testID={measuring ? undefined : 'theme-restore-default'}
          disabled={busy}
          style={measuring || oneRow ? undefined : styles.currentButton}
          onPress={onRestore}>{t`Restore default`}</Button>
      ) : null}
    </>
  );

  return (
    <Animated.View
      testID="theme-current-summary"
      entering={animate ? fadeIn('short') : undefined}
      exiting={fadeOut('micro')}
      onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
      style={oneRow ? styles.currentOneRow : styles.currentTwoRows}>
      {hasActions ? (
        // The invisible measure: never seen, never announced, never pressed.
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={styles.currentMeasure}>
          <View
            style={styles.currentMeasureItem}
            onLayout={(event) => setCopyWidth(Math.ceil(event.nativeEvent.layout.width))}>
            <Text variant="caption" numberOfLines={1}>
              {caption}
            </Text>
            <Text weight="semibold" numberOfLines={1}>
              {name}
            </Text>
          </View>
          <View
            style={[styles.currentMeasureItem, styles.currentActions]}
            onLayout={(event) => setActionsWidth(Math.ceil(event.nativeEvent.layout.width))}>
            {buttons(true)}
          </View>
        </View>
      ) : null}
      <View style={[styles.currentIdentity, oneRow ? styles.currentIdentityGrow : undefined]}>
        <View
          style={[
            styles.currentPreview,
            { borderRadius: profile.chrome.control, borderColor: theme.colors.border },
          ]}>
          {preview}
        </View>
        <View style={styles.currentCopy}>
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
            {caption}
          </Text>
          <Text weight="semibold" numberOfLines={2}>
            {name}
          </Text>
        </View>
      </View>
      {hasActions ? <View style={styles.currentActions}>{buttons(false)}</View> : null}
    </Animated.View>
  );
}

/** The two ways a theme the reader already has comes in. */
function ImportChoices({
  busy,
  onLink,
  onFile,
}: {
  busy: boolean;
  onLink: () => void;
  onFile: () => void;
}) {
  const { t } = useLingui();
  return (
    <View style={styles.importChoices}>
      <Button variant="secondary" disabled={busy} testID="theme-import-link" onPress={onLink}>
        {t`Import link`}
      </Button>
      <Button variant="secondary" disabled={busy} testID="theme-import-file" onPress={onFile}>
        {t`Import file`}
      </Button>
    </View>
  );
}

/**
 * A card's long-press menu, raised over the grid.
 *
 * Drawn over the grid rather than inside the card: a two-column card is
 * narrower than the menu, and a cell of a virtualized list is the last place
 * to put something that must sit above its neighbours. The plate floats over
 * live content, so it keeps the frost's legibility floor under the reader's
 * opacity; the dim behind it is a scrim, and a tap on it closes the menu.
 */
function CardMenuOverlay({ menu, onClose }: { menu: CardMenu; onClose: () => void }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const profile = useAppearanceProfile();
  const opacity = useSurfaceBackgroundOpacity();
  const insets = useSafeAreaInsets();
  const items: AgentActionMenuItem[] = menu.actions.map((action) => ({
    id: action.name,
    label: action.label,
    Icon: action.Icon,
    tone: action.tone,
    confirm: action.confirm,
    testID: `theme-menu-${action.name}`,
    onPress: () => {
      onClose();
      action.run();
    },
  }));
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        entering={fadeIn('micro')}
        exiting={fadeOut('micro')}
        style={StyleSheet.absoluteFill}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t`Close`}
          testID="theme-menu-scrim"
          onPress={onClose}
          // Opacity audit: scrim -- a dim over the grid while the menu is up.
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: withAlpha(theme.colors.background, 0.4) },
          ]}
        />
      </Animated.View>
      <View
        pointerEvents="box-none"
        style={[styles.menuDock, { bottom: SHEET_LADDER.section + insets.bottom }]}>
        <Animated.View
          testID="theme-card-menu"
          entering={fadeInDown('dropdown')}
          exiting={fadeOutDown('micro')}
          accessibilityViewIsModal
          style={[
            styles.menu,
            {
              borderRadius: profile.chrome.popover,
              backgroundColor: surfaceBackgroundFill(
                theme.colors.surface,
                sheetFrostAlpha(opacity)
              ),
            },
          ]}>
          <Text
            variant="caption"
            weight="semibold"
            color={theme.colors.textMuted}
            numberOfLines={1}
            style={styles.menuTitle}>
            {menu.title}
          </Text>
          <AgentActionMenu surface="ground" items={items} />
          <View style={[styles.menuRule, { backgroundColor: theme.colors.border }]} />
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Cancel`}
            testID="theme-menu-cancel"
            onPress={onClose}
            style={styles.menuCancel}>
            <Text variant="bodySmall" weight="semibold" color={theme.colors.textMuted}>
              {t`Cancel`}
            </Text>
          </PressableScale>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, minHeight: 0 },
  header: { gap: SHEET_LADDER.gap, paddingBottom: SHEET_LADDER.gap },
  // The gap under a row is part of it, so the fixed height the list is told is
  // the whole of what the row occupies.
  cardRow: { flexDirection: 'row', gap: THEME_GRID_GAP, paddingBottom: THEME_GRID_GAP },
  cardCell: { flex: 1, minWidth: 0 },
  currentOneRow: { flexDirection: 'row', alignItems: 'center', gap: SHEET_LADDER.snug },
  currentTwoRows: { gap: SHEET_LADDER.gap },
  currentIdentity: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: CURRENT_IDENTITY_GAP,
    minWidth: 0,
  },
  // The bar's own width, so a measured item is never wider than the bar it is for.
  currentMeasure: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
  currentMeasureItem: { position: 'absolute', top: 0, left: 0, flexShrink: 0 },
  currentButton: { flex: 1 },
  currentIdentityGrow: { flex: 1 },
  // 4:3, the cards' own shape, at the size a bar can carry.
  currentPreview: {
    width: CURRENT_PREVIEW_WIDTH,
    height: 42,
    overflow: 'hidden',
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
  },
  currentCopy: { flex: 1, minWidth: 0, gap: 2 },
  currentActions: { flexDirection: 'row', gap: 8 },
  importChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emptyMine: { gap: SHEET_LADDER.gap, paddingTop: SHEET_LADDER.tight, alignItems: 'flex-start' },
  menuDock: {
    position: 'absolute',
    left: SHEET_LADDER.gutter,
    right: SHEET_LADDER.gutter,
    alignItems: 'center',
  },
  menu: {
    width: '100%',
    maxWidth: 420,
    paddingVertical: 6,
    borderCurve: 'continuous',
    overflow: 'hidden',
    boxShadow: appChrome.shadow.popover,
  },
  menuTitle: { paddingHorizontal: 14, paddingTop: 6, paddingBottom: 2 },
  menuRule: { height: StyleSheet.hairlineWidth, marginHorizontal: 14, marginVertical: 4 },
  menuCancel: { minHeight: 42, justifyContent: 'center', paddingHorizontal: 14 },
});

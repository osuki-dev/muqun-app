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
 * The slim bar at the top is the current theme: its picture, its name, and
 * the two things a reader does to the theme they are wearing -- Customise,
 * which opens its detail, and Restore default, which only a custom theme has a
 * use for. Destructive actions are never in the grid: Remove lives in a card's
 * long-press menu and in the detail, and asks before it acts.
 *
 * Which tab is open is remembered for the session. A reader with no themes of
 * their own starts on the gallery, where the themes are.
 */
import { useLingui } from '@lingui/react/macro';
import { Button, PressableScale, Text, useThemeMode, useThemeTokens } from '@osuki-dev/ui';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AgentActionMenu, type AgentActionMenuItem } from '@/components/agent-action-menu';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useReskinTransition } from '@/components/reskin-transition';
import { SettingsSegmented } from '@/components/settings-segmented';
import { SheetScene, SheetSceneQuietAction, SHEET_LADDER } from '@/components/sheet-scene';
import {
  ThemeCard,
  ThemeCardPreview,
  ThemeImportCard,
  type ThemeCardAction,
} from '@/components/theme-card';
import { ThemeGalleryTab } from '@/components/theme-gallery-tab';
import { ThemeGrid } from '@/components/theme-grid';
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
import { withAlpha } from '@/lib/color';
import { fadeIn, fadeInDown, fadeOut, fadeOutDown, STAGGER } from '@/lib/motion';
import { useRenderTally } from '@/lib/render-tally';
import { loadThemeTab, saveThemeTab, type ThemeTab } from '@/lib/theme-tab-preference';
import { THEME_PICKER_MAX_CONTENT_WIDTH } from '@/lib/theme-picker-layout';
import { useThemeLibrary } from '@/stores/theme-library';
import { exportInstalledTheme } from '@/theme/assets';
import { pickThemeManifest, shareThemeFile, type ThemeFileStage } from '@/theme/local-files';
import { prepareThemeArtwork } from '@/theme/prepare-artwork';
import { isRenderableThemeAsset } from '@/theme/renderable-asset';
import { BUILTIN_THEME_INSTALLATION_ID, type InstalledTheme } from '@/theme/repository';
import type { ThemeManifest } from '@/theme/schema';
import { sheetFrostAlpha, surfaceBackgroundFill } from '@/theme/surface-background';

/** How far into a grid the first arrival keeps counting. */
const STAGGER_CAP = 8;

type MineItem = InstalledTheme | 'import';
type BuiltinItem = 'default' | ThemePack;
type CardMenu = { title: string; actions: readonly ThemeCardAction[] };

/** A theme's own published picture, when the files are on this device. */
function coverOf(manifest: ThemeManifest, assets?: Record<string, string>): string | null {
  const uri = manifest.preview ? assets?.[manifest.preview] : undefined;
  return isRenderableThemeAsset(uri) ? (uri ?? null) : null;
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
  const { width: artworkWidth } = useWindowDimensions();

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
  // The tab the sheet opened on is the only one whose cards rise in: a tab
  // switch is a cross-fade, never a second arrival.
  const [openedOn] = useState(tab);
  const [revealed] = useState(() => new Set<string>());
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<CardMenu | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [linkImportOpen, setLinkImportOpen] = useState(false);
  const [readStage, setReadStage] = useState<ThemeFileStage | null>(null);
  const [busy, setBusy] = useState(false);

  const gallery = useThemeGallery({ enabled: tab === 'gallery', onReady: openEditor });

  function chooseTab(next: ThemeTab) {
    setMenu(null);
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
        ...(options.prepare ? { prepare: options.prepare } : {}),
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
          artworkWidth
        ),
      apply: () => useThemeLibrary.getState().resetToDefault(),
    });
  }

  function chooseCustom(theme: InstalledTheme) {
    wear({
      pack: theme.manifest.variants,
      prepare: () => prepareThemeArtwork(theme.manifest, theme.assets, resolvedMode, artworkWidth),
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

  const header = (
    <View style={styles.header}>
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

  const mineData: readonly MineItem[] = [...themes, 'import'];
  const builtinData: readonly BuiltinItem[] = defaultTheme
    ? ['default', ...THEME_PACKS]
    : THEME_PACKS;

  return (
    <SheetScene
      testID="settings-theme-sheet"
      title={t`Themes`}
      caption={t`Terminal colours follow the theme.`}
      header={header}>
      <View style={styles.body}>
        {/* Keyed on the tab, so switching unmounts one grid and mounts the
            other and the two cross-fade; nothing slides. */}
        <Animated.View
          key={tab}
          entering={fadeIn('micro')}
          exiting={fadeOut('micro')}
          style={styles.body}>
          {tab === 'mine' ? (
            <ThemeGrid<MineItem>
              testID="theme-mine-grid"
              data={mineData}
              keyOf={(item) => (item === 'import' ? 'import' : item.id)}
              extraData={`${currentCustomId ?? ''}|${importOpen ? 1 : 0}|${busy ? 1 : 0}`}
              footer={
                themes.length === 0 ? (
                  <View testID="theme-mine-empty" style={styles.emptyMine}>
                    <Text variant="bodySmall" color={colors.textMuted}>
                      {t`No personal themes yet. Import one, or browse the published themes.`}
                    </Text>
                    <SheetSceneQuietAction
                      testID="theme-browse-gallery"
                      label={t`Browse the gallery`}
                      onPress={() => chooseTab('gallery')}
                    />
                  </View>
                ) : null
              }
              renderCard={(item, index, layout) => {
                const rise = {
                  revealed,
                  key: `mine:${item === 'import' ? 'import' : item.id}`,
                  delay: Math.min(index, STAGGER_CAP) * STAGGER.row,
                  enabled: openedOn === 'mine',
                };
                if (item === 'import')
                  return (
                    <ThemeImportCard
                      layout={layout}
                      rise={rise}
                      expanded={importOpen}
                      disabled={busy}
                      onPress={() => {
                        setLinkImportOpen(false);
                        setImportOpen(!importOpen);
                      }}
                    />
                  );
                const current = item.id === currentCustomId;
                const actions = actionsFor(item);
                return (
                  <ThemeCard
                    testID={`theme-row-${item.manifest.id}`}
                    name={item.manifest.name}
                    caption={item.manifest.author ?? t`Imported`}
                    layout={layout}
                    current={current}
                    rise={rise}
                    disabled={busy}
                    accessibilityLabel={
                      current ? `${item.manifest.name}, ${t`Current`}` : item.manifest.name
                    }
                    actions={actions}
                    onPress={() => openInstalled(item)}
                    onLongPress={() => openMenu(item.manifest.name, actions)}
                    preview={
                      <ThemeCardPreview
                        image={coverOf(item.manifest, item.assets)}
                        pack={item.manifest.variants}
                      />
                    }
                  />
                );
              }}
            />
          ) : tab === 'builtin' ? (
            <ThemeGrid<BuiltinItem>
              testID="theme-picker-grid"
              data={builtinData}
              keyOf={(item) => (item === 'default' ? 'default' : item.id)}
              extraData={`${defaultActive ? 1 : 0}|${themePack.id}`}
              renderCard={(item, index, layout) => {
                const rise = {
                  revealed,
                  key: `builtin:${item === 'default' ? 'default' : item.id}`,
                  delay: Math.min(index, STAGGER_CAP) * STAGGER.row,
                  enabled: openedOn === 'builtin',
                };
                if (item === 'default') {
                  if (!defaultTheme) return null;
                  return (
                    <ThemeCard
                      // The id carries the selection state, because the flows
                      // that drive this grid match on it: a role reads
                      // differently on the two runtimes.
                      testID={`settings-selection:${defaultActive ? 'on' : 'off'}:theme-builtin`}
                      name={defaultTheme.label}
                      caption={t`Default`}
                      layout={layout}
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
                }
                const current = item.id === themePack.id;
                return (
                  <ThemeCard
                    testID={`settings-selection:${current ? 'on' : 'off'}:theme-${item.id}`}
                    name={item.label}
                    caption={`${item.lightName} · ${item.darkName}`}
                    layout={layout}
                    current={current}
                    rise={rise}
                    accessibilityLabel={current ? `${item.label}, ${t`Current`}` : item.label}
                    onPress={() => choosePack(item.id)}
                    preview={<ThemeCardPreview pack={item} />}
                  />
                );
              }}
            />
          ) : (
            <ThemeGalleryTab
              gallery={gallery}
              installed={themes}
              currentCustomId={currentCustomId}
              rises={openedOn === 'gallery' || gallery.arrivedLive}
              revealed={revealed}
              onOpenInstalled={openInstalled}
              actionsFor={actionsFor}
              onMenu={openMenu}
            />
          )}
        </Animated.View>
        {menu ? <CardMenuOverlay menu={menu} onClose={() => setMenu(null)} /> : null}
      </View>
    </SheetScene>
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
  return (
    <Animated.View
      testID="theme-current-summary"
      entering={animate ? fadeIn('short') : undefined}
      exiting={fadeOut('micro')}
      style={styles.current}>
      <View style={styles.currentIdentity}>
        <View
          style={[
            styles.currentPreview,
            { borderRadius: profile.chrome.control, borderColor: theme.colors.border },
          ]}>
          {preview}
        </View>
        <View style={styles.currentCopy}>
          <Text variant="caption" color={theme.colors.textMuted} numberOfLines={1}>
            {t`Current theme`} · {source}
          </Text>
          <Text weight="semibold" numberOfLines={1}>
            {name}
          </Text>
        </View>
      </View>
      {onCustomise || onRestore ? (
        <View style={styles.currentActions}>
          {onCustomise ? (
            <Button
              variant="secondary"
              testID="theme-customise"
              disabled={busy}
              onPress={onCustomise}>{t`Customise`}</Button>
          ) : null}
          {onRestore ? (
            <Button
              variant="ghost"
              testID="theme-restore-default"
              disabled={busy}
              onPress={onRestore}>{t`Restore default`}</Button>
          ) : null}
        </View>
      ) : null}
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
  header: {
    width: '100%',
    maxWidth: THEME_PICKER_MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    gap: SHEET_LADDER.gap,
  },
  body: { flex: 1, minHeight: 0 },
  current: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: SHEET_LADDER.snug,
    rowGap: SHEET_LADDER.gap,
  },
  currentIdentity: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minWidth: 0,
  },
  // 4:3, the cards' own shape, at the size a bar can carry.
  currentPreview: {
    width: 56,
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

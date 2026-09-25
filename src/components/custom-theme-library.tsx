import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useLingui } from '@lingui/react/macro';
import { Tag, useThemeTokens } from '@osuki-dev/ui';
import { Text } from '@/components/text';
import { Button } from '@/components/themed-button';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { ChevronRight, MoreHorizontal, Trash2, X } from 'lucide-react-native';

import { CustomThemePreview } from '@/components/custom-theme-preview';
import { SettingsSegmented } from '@/components/settings-segmented';
import { ThemeLinkImport } from '@/components/theme-link-import';
import { ThemeImportProgress } from '@/components/theme-import-progress';
import { ThemeAppearanceSettings } from '@/components/theme-appearance-settings';
import { TwoStepAction } from '@/components/two-step-action';
import { useSurfaceBackground, useSurfaceBackgroundOpacity } from '@/hooks/use-surface-background';
import {
  DURATION,
  fadeIn,
  fadeInLeft,
  fadeInRight,
  fadeOutLeft,
  fadeOutRight,
  listLayout,
} from '@/lib/motion';
import { loadThemeTab, saveThemeTab, type ThemeTab } from '@/lib/theme-tab-preference';
import { effectiveThemeManifest, type InstalledTheme } from '@/theme/repository';
import { PressableScale } from '@/components/pressable-scale';
import { useSheetGroundPlate } from '@/components/sheet-ground';
import { ThemePaletteStrip } from '@/components/theme-palette-strip';
import { useThemePack } from '@/hooks/use-theme-pack';
import { useReskinTransition } from '@/components/reskin-transition';
import { useThemeLibrary } from '@/stores/theme-library';
import { auditThemeContrast } from '@/theme/contrast';
import {
  pickThemeManifest,
  shareThemeColors,
  shareThemeFile,
  type ThemeFileStage,
} from '@/theme/local-files';
import { exportInstalledTheme } from '@/theme/assets';
import { useAppSettings } from '@/stores/app-settings';
import type { ThemeAppearance } from '@/constants/theme-packs';
import type { ThemeManifest } from '@/theme/schema';
import type { ThemeEditorCandidate } from '@/theme/draft-session';
import { settleAfter } from '@/lib/compiler-safe-control-flow';

/**
 * One layer of paint per pixel: under a custom theme the kit's opaque chip
 * would be the one thing on a row that refused the reader's surface slider, so
 * it drops its fill and the row behind it shows through at its own alpha.
 */
const transparentFill = { backgroundColor: 'transparent' } as const;

/** The pack cover, as a row thumbnail and as the summary's larger one. Both 8:5. */
const ROW_COVER = { width: 56, height: 35 } as const;
const SUMMARY_COVER = { width: 96, height: 60 } as const;

/**
 * An installed theme's own cover, when it published one.
 *
 * The manifest's `preview` is an asset id naming a file *inside* the pack, so
 * an installed theme already has it on disk and `assets[preview]` is the
 * `file:///` it was written to. App-owned files only -- the same rule every
 * other artwork consumer applies, so a manifest cannot point this at an
 * arbitrary path or a remote URL.
 *
 * A pack without one falls back to the swatch pair, which is what every row
 * showed before: never a gap, and never a broken picture.
 */
function ThemeCover({
  manifest,
  assets,
  pack,
  size,
}: {
  manifest: ThemeManifest;
  assets?: Record<string, string>;
  pack: Pick<ThemeAppearance, 'light' | 'dark'>;
  size: { width: number; height: number };
}) {
  const profile = useAppearanceProfile();
  const uri = manifest.preview ? assets?.[manifest.preview] : undefined;
  if (!uri?.startsWith('file:///')) return <ThemePaletteStrip pack={pack} />;
  return (
    <Image
      source={{ uri }}
      contentFit="cover"
      // `memory` rather than `memory-disk`: the file is already on this
      // device's disk, and a second copy of it in the image cache is the same
      // bytes twice.
      cachePolicy="memory"
      transition={DURATION.medium}
      accessible={false}
      style={{ ...size, borderRadius: profile.chrome.card }}
    />
  );
}

/**
 * What the one primary button on a theme does, described rather than drawn.
 *
 * `applies` is the difference between the two things that button can be: the
 * theme is not the current one and pressing writes it, or it already is and
 * pressing only leaves. `disabled` folds in the same guards the inline button
 * carried, so a host cannot forget one of them, and `run` is the whole action
 * including the leave that follows an apply.
 */
export type ThemePrimaryAction = { applies: boolean; disabled: boolean; run: () => void };
type DraftAppearance = Pick<
  InstalledTheme,
  | 'terminalBackgroundOpacity'
  | 'surfaceBackgroundOpacity'
  | 'hideHomeLogo'
  | 'hideHomeText'
  | 'homeArtwork'
>;

export function CustomThemeLibrary({
  initialManifest,
  initialCandidate,
  onOpenCandidate,
  detail = false,
  ownsPreparedAssets = true,
  onClosePreview,
  onPrimaryActionChange,
  mode = 'manage',
  onPreviewAppearanceChange,
  tabs = false,
  children,
}: {
  initialManifest?: ThemeManifest;
  initialCandidate?: ThemeEditorCandidate;
  onOpenCandidate?: (candidate: ThemeEditorCandidate) => void;
  detail?: boolean;
  mode?: 'preview' | 'manage';
  onPreviewAppearanceChange?: (appearance: InstalledTheme) => void;
  ownsPreparedAssets?: boolean;
  onClosePreview?: () => void;
  /**
   * Hand the primary action to the host instead of drawing it here.
   *
   * The detail route (`app/custom-theme.tsx`) pins one button to the bottom of
   * the screen, and that button is now the apply: an inline Apply halfway up a
   * scroll plus a sticky Done underneath it were two confirm-ish controls for
   * one decision. Passing this prop is the host saying it draws that control
   * itself, so this component stops rendering its own and reports the state the
   * host needs instead. Hosts that do not pass it -- the theme picker sheet, and
   * the packaged-theme preview inside the file viewer, which has no footer of
   * its own -- keep the inline button exactly as before.
   *
   * `null` means there is no candidate on screen and so nothing to confirm.
   */
  onPrimaryActionChange?: (action: ThemePrimaryAction | null) => void;
  /**
   * Split `children` and the personal library into two tabs.
   *
   * Only the picker sheet passes this. The detail route and the file viewer see
   * one theme at a time and have no second collection to switch to, so they get
   * today's single column and this prop never reaches them.
   */
  tabs?: boolean;
  children?: ReactNode;
} = {}) {
  const profile = useAppearanceProfile();
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const reskin = useReskinTransition();
  // The plate a label takes when the pack draws a wallpaper behind this sheet.
  // Bare, because this component is always somebody else's child: inside the
  // theme sheet it takes that sheet's `surface`, and on the full-screen editor
  // it takes the screen's `background`. Both are the ground it is actually on.
  const plate = useSheetGroundPlate();
  const background = useSurfaceBackground();
  const surfaceOpacity = useSurfaceBackgroundOpacity();
  const { width } = useWindowDimensions();
  const wideActions = width >= 840;
  const wideDetail = detail && wideActions;
  const library = useThemeLibrary((state) => state.library);
  const currentPack = useThemePack();
  const router = useRouter();
  /**
   * Which half of the sheet is on screen, remembered across launches.
   *
   * The default is computed at mount and only at mount: a reader who removes
   * their last theme while looking at the list should not have the tab move
   * out from under them, and a reader who has installed nothing has nothing to
   * look at on `mine`.
   */
  const [tab, setTab] = useState<ThemeTab>(
    () => loadThemeTab() ?? (library.themes.length > 0 ? 'mine' : 'builtin')
  );
  const [importOpen, setImportOpen] = useState(false);
  const [linkImportOpen, setLinkImportOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(detail);
  const [removing, setRemoving] = useState(false);
  const [candidate, setCandidate] = useState<ThemeEditorCandidate | null>(
    initialCandidate ?? (initialManifest ? { manifest: initialManifest } : null)
  );
  const [error, setError] = useState<string | null>(null);
  const [draftAppearance, setDraftAppearance] = useState<DraftAppearance>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Copying a dozen images into permanent storage reports nothing on its own.
  const [step, setStep] = useState<'installing' | null>(null);
  /**
   * What a file chosen from the picker is doing, while it does it.
   *
   * Reading a pack is the slowest thing on this screen -- a 4 MB archive is a
   * read, a validated unpack, and every image decoded and written -- and until
   * now the sheet showed nothing at all between the picker closing and the
   * editor opening, which on a phone is about ten seconds of a screen that
   * looks like it ignored the tap.
   */
  const [readStage, setReadStage] = useState<ThemeFileStage | null>(null);
  // Removal reachable from the list, without opening the theme to find it.
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const legacyTheme = useAppSettings((state) => state.themePack);
  const canUndo =
    Boolean(library.previous) ||
    library.selection?.kind === 'custom' ||
    (library.selection?.kind === 'builtin' && library.selection.id !== legacyTheme);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(
    () => () => {
      if (ownsPreparedAssets) candidate?.prepared?.dispose();
    },
    [candidate?.prepared, ownsPreparedAssets]
  );
  const contrast = candidate ? auditThemeContrast(candidate.manifest) : [];
  const imageCount = Object.keys(candidate?.manifest.assets ?? {}).length;
  const assets = candidate?.assets ?? candidate?.prepared?.assets ?? {};
  const missingImages = Object.keys(assets).length !== imageCount;
  const candidateSelected =
    library.selection?.kind === 'custom' && library.selection.id === candidate?.id;
  const browsing = !initialManifest && !initialCandidate && !candidate;
  const installedCandidate = library.themes.find((entry) => entry.id === candidate?.id);
  const appearance =
    installedCandidate ??
    (candidate
      ? {
          id: 'candidate',
          manifest: candidate.manifest,
          assets,
          ...draftAppearance,
        }
      : undefined);
  useEffect(() => {
    if (candidate && !installedCandidate) {
      onPreviewAppearanceChange?.({
        id: 'candidate',
        manifest: candidate.manifest,
        assets: candidate.assets ?? candidate.prepared?.assets ?? {},
        ...draftAppearance,
      });
    }
  }, [candidate, installedCandidate, draftAppearance, onPreviewAppearanceChange]);
  // The applied theme, when it is one of the reader's rather than a built-in
  // pack -- which is the only case that has a manifest, and so a cover.
  const currentInstalled =
    library.selection?.kind === 'custom'
      ? library.themes.find((entry) => entry.id === library.selection?.id)
      : undefined;

  async function perform(action: () => void | Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    return settleAfter(
      async () => {
        try {
          await action();
        } catch (cause) {
          if (mounted.current)
            setError(cause instanceof Error ? cause.message : t`Something went wrong`);
        }
      },
      () => {
        pending.current = false;
        if (mounted.current) {
          setBusy(false);
          setStep(null);
        }
      }
    );
  }

  function closePreview() {
    setDraftAppearance({});
    setRemoving(false);
    setActionsOpen(false);
    setNotice(null);
    setError(null);
    if (onClosePreview) onClosePreview();
    else setCandidate(null);
  }

  function confirmRemove() {
    const id = candidate?.id;
    if (!id) return;
    void perform(() => {
      useThemeLibrary.getState().remove(id);
      closePreview();
    });
  }

  async function save(apply: boolean) {
    if (!candidate) return;
    let installedAssets: Record<string, string> | undefined;
    if (!candidate.id && candidate.prepared) {
      setStep('installing');
      installedAssets = await candidate.prepared.install();
    }
    if (!mounted.current) return;
    const store = useThemeLibrary.getState();
    const id = candidate.id ?? store.save(JSON.stringify(candidate.manifest), installedAssets).id;
    // Retain the installed identity even if a subsequent activation write fails.
    setCandidate({ ...candidate, id });
    if (!installedCandidate) {
      if (draftAppearance.terminalBackgroundOpacity !== undefined)
        store.setTerminalBackgroundOpacity(id, draftAppearance.terminalBackgroundOpacity);
      if (draftAppearance.surfaceBackgroundOpacity !== undefined)
        store.setSurfaceBackgroundOpacity(id, draftAppearance.surfaceBackgroundOpacity);
      if (draftAppearance.hideHomeLogo !== undefined)
        store.setHideHomeLogo(id, draftAppearance.hideHomeLogo);
      if (draftAppearance.hideHomeText !== undefined)
        store.setHideHomeText(id, draftAppearance.hideHomeText);
      if (draftAppearance.homeArtwork !== undefined)
        store.setHomeArtwork(id, draftAppearance.homeArtwork);
    }
    if (apply) {
      // `colors` here is the *candidate's* palette -- this editor is already
      // wearing the theme being judged -- so the wash's front is lit in the
      // theme the reader is about to get, without having to apply it to find
      // out what colour that is.
      void reskin.run({
        kind: 'theme',
        accent: colors.primary,
        apply: () => {
          store.apply({ kind: 'custom', id });
          // Applying is a confirmation, exactly as choosing a built-in pack
          // is: write first, then leave. Holding the screen open behind a
          // notice read as the app having ignored the tap.
          closePreview();
        },
      });
      return;
    }
    setNotice(t`Theme saved`);
  }

  /**
   * The host's button is pressed long after the render that described it, so
   * `run` must reach today's `candidate` rather than the one captured when the
   * description was last sent. Everything it needs -- `perform`, `save`,
   * `closePreview` -- is rebuilt on every render, so a ref refreshed on every
   * commit keeps the call current while letting the reported action be rebuilt
   * only when something the host can see actually changes. Reporting on every
   * render instead would hand the host a new object each time, and the host
   * storing it in state would render again, forever.
   */
  const primaryRef = useRef({ apply: () => {}, close: () => {} });
  useEffect(() => {
    primaryRef.current = {
      apply: () => void perform(() => save(true)),
      close: closePreview,
    };
  });
  const hostDrivesPrimaryAction = Boolean(onPrimaryActionChange);
  // Depend on the count, not the array: `auditThemeContrast` returns a fresh
  // array every render and only its emptiness is a guard.
  const contrastBlocked = contrast.length > 0;
  const hasCandidate = Boolean(candidate);
  useEffect(() => {
    if (!onPrimaryActionChange) return;
    if (!hasCandidate) {
      onPrimaryActionChange(null);
      return;
    }
    // Already the selected theme: the only thing left to do is leave, and the
    // single guard on leaving is that nothing is mid-write.
    const applies = !candidateSelected;
    onPrimaryActionChange({
      applies,
      disabled: applies ? busy || contrastBlocked || missingImages : busy,
      run: () => (applies ? primaryRef.current.apply() : primaryRef.current.close()),
    });
  }, [
    onPrimaryActionChange,
    hasCandidate,
    candidateSelected,
    busy,
    contrastBlocked,
    missingImages,
  ]);
  // A host holding the description in state would otherwise keep a button alive
  // for a screen that has gone.
  useEffect(() => () => onPrimaryActionChange?.(null), [onPrimaryActionChange]);

  function chooseTab(next: ThemeTab) {
    setPendingRemoval(null);
    setTab(next);
    saveThemeTab(next);
  }

  /**
   * Which way the strip slides.
   *
   * Two tabs, so the direction belongs to the panel rather than to the change:
   * `builtin` is the higher index, so it always arrives from the right and
   * always leaves back to the right, and `mine` always does the mirror. Which
   * is also the only form that works -- a panel's `exiting` is read off the
   * render before it was removed, and that render cannot know which tab was
   * chosen next.
   */
  const forward = tab === 'builtin';

  /**
   * Whether the actions card has anything to put in itself.
   *
   * Every button in it is conditional, and on the detail route all four
   * conditions can be false at once: a candidate that is not installed yet has
   * no id, so Export, Export colors and Remove are all out, and the host draws
   * the primary action, so Save is out too. The card then rendered as a bare
   * `surfaceRaised` box with its own padding and nothing inside -- an empty
   * pill under the preview, with no content and no accessibility node, which is
   * what the device review found on every theme opened from the catalogue.
   * Pre-existing rather than new: the same four conditions and the same
   * container are on `main` at `custom-theme-library.tsx:537-554`, reachable
   * there from a link or file import, which is simply a rarer way in than the
   * browse sheet this branch adds.
   */
  const candidateHasActions =
    mode === 'manage' && (Boolean(candidate?.id) || !hostDrivesPrimaryAction);

  const importPanel =
    importOpen && !linkImportOpen ? (
      <View
        style={{
          flexDirection: wideActions ? 'row' : 'column',
          flexWrap: 'wrap',
          gap: 8,
          padding: 12,
          borderRadius: profile.chrome.card,
          backgroundColor: background(colors.surfaceRaised),
        }}>
        <Button
          variant="secondary"
          disabled={busy}
          testID="theme-import-link"
          onPress={() => setLinkImportOpen(true)}>{t`Import link`}</Button>
        <Button
          variant="secondary"
          disabled={busy}
          testID="theme-import-file"
          onPress={() =>
            void perform(async () => {
              const value = await pickThemeManifest(setReadStage).finally(() => setReadStage(null));
              if (value !== null) {
                if (!mounted.current) {
                  value.prepared?.dispose();
                  return;
                }
                if (onOpenCandidate) onOpenCandidate(value);
                else {
                  setDraftAppearance({});
                  setCandidate(value);
                }
                setImportOpen(false);
                setActionsOpen(false);
              }
            })
          }>{t`Import file`}</Button>
      </View>
    ) : null;

  const linkPanel =
    importOpen && linkImportOpen ? (
      <ThemeLinkImport
        onClose={() => setLinkImportOpen(false)}
        onReady={(value) => {
          if (onOpenCandidate) onOpenCandidate(value);
          else {
            setDraftAppearance({});
            setCandidate(value);
          }
          setLinkImportOpen(false);
          setImportOpen(false);
          setActionsOpen(false);
        }}
      />
    ) : null;

  /**
   * The personal library.
   *
   * Under a tab it loses its heading: the tab names the collection, and a
   * heading under it that repeats the word is the word twice.
   */
  const mineList = (
    <View style={{ gap: 8 }}>
      {tabs ? null : <Text variant="bodySmall">{t`My themes`}</Text>}
      {library.themes.map((installed) => (
        <View key={installed.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={installed.manifest.name}
            // The row and its remove button both carry the theme's name, so
            // the name alone cannot name the row. The manifest id is the
            // stable handle a test can hold.
            testID={`theme-row-${installed.manifest.id}`}
            disabled={busy}
            onPress={() => {
              const next = {
                manifest: installed.manifest,
                id: installed.id,
                assets: installed.assets,
              };
              if (onOpenCandidate) onOpenCandidate(next);
              else {
                setDraftAppearance({});
                setCandidate(next);
              }
              setError(null);
              setNotice(null);
              setPendingRemoval(null);
              setActionsOpen(false);
              setImportOpen(false);
            }}
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              padding: 12,
              borderRadius: profile.chrome.control,
              backgroundColor: background(colors.surfaceRaised),
            }}>
            <ThemeCover
              manifest={installed.manifest}
              assets={installed.assets}
              pack={installed.manifest.variants}
              size={ROW_COVER}
            />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              {/* The name has the line to itself: a marker beside it cost the
                  name a third of its width, and naming the theme is the row's
                  one job. */}
              <Text variant="bodySmall" numberOfLines={1}>
                {installed.manifest.name}
              </Text>
              {/* A row that says only a name reads as a label. The second line
                  is what the pack itself offers, and when it offers nothing it
                  is what the row does -- which is the thing the chevron was
                  failing to say on its own. The marker leads it: "this is the
                  one you are wearing" belongs with who made it, not in front of
                  what it is called.

                  The applied theme used to swap its chevron for a check, which
                  took the one affordance saying "this opens" off the row a
                  reader is most likely to want to open. Every row keeps the
                  chevron now. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {library.selection?.kind === 'custom' && library.selection.id === installed.id ? (
                  <Animated.View entering={fadeIn('medium')}>
                    <Tag
                      style={surfaceOpacity === 1 ? undefined : transparentFill}>{t`Current`}</Tag>
                  </Animated.View>
                ) : null}
                <Text
                  variant="caption"
                  color={colors.textMuted}
                  numberOfLines={1}
                  style={{ flex: 1, minWidth: 0 }}>
                  {installed.manifest.author ?? t`Tap to preview and adjust`}
                </Text>
              </View>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </PressableScale>
          <TwoStepAction
            testID={`theme-remove-${installed.id}`}
            presentation="compact"
            label={t`Remove`}
            confirmLabel={t`Tap again to remove`}
            accessibilityLabel={t`Remove ${installed.manifest.name}`}
            confirmAccessibilityLabel={`${t`Tap again to remove`}: ${installed.manifest.name}`}
            Icon={Trash2}
            armed={pendingRemoval === installed.id}
            disabled={busy}
            onArmedChange={(armed) => {
              setPendingRemoval((current) =>
                armed ? installed.id : current === installed.id ? null : current
              );
              setError(null);
              setNotice(null);
            }}
            onConfirm={() =>
              void perform(() => {
                useThemeLibrary.getState().remove(installed.id);
              })
            }
          />
        </View>
      ))}
    </View>
  );

  return (
    <View testID="custom-theme-library" style={{ gap: 16 }}>
      {browsing ? (
        <View style={{ gap: 16 }}>
          <View
            testID="theme-current-summary"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            {/* Which pack is on, drawn straight onto the sheet's ground -- the
                one block here that is not a row on a card. Over a wallpaper it
                takes the plate the settings page gives a section label. */}
            <View style={[{ flex: 1, minWidth: 0, gap: 4 }, plate]}>
              <Text variant="caption" color={colors.textMuted}>{t`Current theme`}</Text>
              <Text numberOfLines={1}>{currentPack.label}</Text>
            </View>
            {/* The applied theme's own cover when it has one, at the size a
                summary can carry: the same picture the row below shows, so the
                two agree about which theme is on. A built-in pack has no
                manifest and keeps the swatch pair. */}
            {currentInstalled ? (
              <ThemeCover
                manifest={currentInstalled.manifest}
                assets={currentInstalled.assets}
                pack={currentPack}
                size={SUMMARY_COVER}
              />
            ) : (
              <ThemePaletteStrip pack={currentPack} />
            )}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              variant="secondary"
              disabled={busy}
              testID="theme-browse"
              onPress={() => {
                setImportOpen(false);
                router.push('/settings-theme-browse');
              }}>{t`Browse themes`}</Button>
            <Button
              variant="secondary"
              disabled={busy}
              testID="theme-import"
              onPress={() => {
                // The panel a reader has just asked for must not open on the
                // tab they are not looking at, so Import picks its tab first.
                // It is also what keeps `theme-import` -> `theme-import-link`
                // working whatever tab was persisted.
                if (tabs) chooseTab('mine');
                setImportOpen(!importOpen);
              }}>{t`Import`}</Button>
            {canUndo ? (
              <Button
                variant="ghost"
                disabled={busy}
                onPress={() =>
                  void perform(() => useThemeLibrary.getState().undo())
                }>{t`Undo`}</Button>
            ) : null}
          </View>
          {tabs ? (
            <SettingsSegmented
              testID="theme-tab"
              value={tab}
              onChange={(value) => chooseTab(value as ThemeTab)}
              options={[
                { label: t`My themes`, value: 'mine' },
                { label: t`Built-in`, value: 'builtin' },
              ]}
            />
          ) : null}
          {/* Under tabs these two live on `mine`, with the list they belong
              to. Without tabs they stay exactly where they were. */}
          {tabs ? null : (
            <>
              {importPanel}
              {linkPanel}
            </>
          )}
        </View>
      ) : null}
      {step ? (
        <ThemeImportProgress testID="theme-install-progress" label={t`Installing images`} />
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
      {error || notice ? (
        <View
          testID="theme-status-message"
          style={{
            padding: 12,
            borderRadius: profile.chrome.surface,
            backgroundColor: background(colors.surfaceRaised),
          }}>
          {error ? (
            <Text selectable accessibilityRole="alert" color={colors.danger}>
              {error}
            </Text>
          ) : (
            <Text selectable accessibilityLiveRegion="polite" color={colors.text}>
              {notice}
            </Text>
          )}
        </View>
      ) : null}
      {candidate ? (
        <View style={{ gap: 12 }}>
          {!detail || initialManifest ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text selectable>{candidate.manifest.name}</Text>
                {candidateSelected ? (
                  <Text variant="caption" color={colors.primary}>{t`Selected`}</Text>
                ) : null}
              </View>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t`Close preview`}
                testID="theme-close-preview"
                disabled={busy}
                onPress={closePreview}
                style={{ padding: 12 }}>
                <X size={20} color={colors.textMuted} />
              </PressableScale>
            </View>
          ) : null}
          <View
            style={{
              flexDirection: wideDetail ? 'row' : 'column',
              gap: 24,
              alignItems: 'flex-start',
            }}>
            <View
              style={{
                flex: wideDetail ? 1 : undefined,
                width: wideDetail ? undefined : '100%',
                minWidth: 0,
              }}>
              <CustomThemePreview
                manifest={appearance ? effectiveThemeManifest(appearance) : candidate.manifest}
                assets={assets}
                preferencesApplied
              />
            </View>
            <View
              style={{
                flex: wideDetail ? 1 : undefined,
                width: wideDetail ? undefined : '100%',
                minWidth: 0,
              }}>
              {appearance ? (
                <ThemeAppearanceSettings
                  key={appearance.id}
                  installed={appearance}
                  disabled={busy}
                  onTerminalChange={(value) =>
                    !installedCandidate
                      ? setDraftAppearance((current) => ({
                          ...current,
                          terminalBackgroundOpacity: value,
                        }))
                      : void perform(() =>
                          useThemeLibrary
                            .getState()
                            .setTerminalBackgroundOpacity(installedCandidate.id, value)
                        )
                  }
                  onSurfaceChange={(value) =>
                    !installedCandidate
                      ? setDraftAppearance((current) => ({
                          ...current,
                          surfaceBackgroundOpacity: value,
                        }))
                      : void perform(() =>
                          useThemeLibrary
                            .getState()
                            .setSurfaceBackgroundOpacity(installedCandidate.id, value)
                        )
                  }
                  onLogoChange={(value) =>
                    !installedCandidate
                      ? setDraftAppearance((current) => ({ ...current, hideHomeLogo: value }))
                      : void perform(() =>
                          useThemeLibrary.getState().setHideHomeLogo(installedCandidate.id, value)
                        )
                  }
                  onTextChange={(value) =>
                    !installedCandidate
                      ? setDraftAppearance((current) => ({ ...current, hideHomeText: value }))
                      : void perform(() =>
                          useThemeLibrary.getState().setHideHomeText(installedCandidate.id, value)
                        )
                  }
                  onArtworkChange={(value) =>
                    !installedCandidate
                      ? setDraftAppearance((current) => ({
                          ...current,
                          homeArtwork: value === 'theme' ? undefined : value,
                        }))
                      : void perform(() =>
                          useThemeLibrary.getState().setHomeArtwork(installedCandidate.id, value)
                        )
                  }
                  onReset={() =>
                    !installedCandidate
                      ? setDraftAppearance({})
                      : void perform(() =>
                          useThemeLibrary
                            .getState()
                            .resetAppearancePreferences(installedCandidate.id)
                        )
                  }
                />
              ) : null}
            </View>
          </View>
          {contrast.length ? (
            <Text color={colors.danger}>{t`Fix text contrast before applying this theme`}</Text>
          ) : null}
          {missingImages ? (
            <Text
              color={
                colors.textMuted
              }>{t`This theme contains images that must be installed before applying`}</Text>
          ) : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {/*
              A host that draws the primary action itself gets no button here:
              the detail route pins one to the bottom of the screen and it both
              applies and closes, so an inline Apply above it would be the same
              decision offered twice, once halfway up a scroll. The two
              explanations above stay where they are -- they are why that
              bottom button is disabled.

              Where no host takes it over, this is still the confirm: Apply
              while the theme is not the current one, and -- outside a detail
              view, which has its own way out -- Done once it is.
            */}
            {hostDrivesPrimaryAction ? null : !candidateSelected ? (
              <Button
                testID="theme-apply"
                disabled={busy || contrast.length > 0 || missingImages}
                onPress={() => void perform(() => save(true))}>{t`Apply theme`}</Button>
            ) : detail ? null : (
              <Button disabled={busy} onPress={closePreview}>{t`Done`}</Button>
            )}
            {!detail && mode === 'manage' ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t`More actions`}
                accessibilityState={{ expanded: actionsOpen }}
                testID="theme-more-actions"
                disabled={busy}
                onPress={() => setActionsOpen(!actionsOpen)}
                style={{ padding: 12, justifyContent: 'center' }}>
                <MoreHorizontal size={24} color={colors.textMuted} />
              </PressableScale>
            ) : null}
          </View>
          {removing ? (
            <View
              style={{
                gap: 8,
                padding: 12,
                borderRadius: profile.chrome.card,
                backgroundColor: background(colors.surfaceRaised),
              }}>
              <Text>{t`Remove this theme?`}</Text>
              <Text
                variant="bodySmall"
                color={colors.textMuted}>{t`The theme will be removed from this device`}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  disabled={busy}
                  testID="theme-confirm-remove"
                  onPress={confirmRemove}>{t`Remove`}</Button>
                <Button
                  disabled={busy}
                  variant="ghost"
                  onPress={() => setRemoving(false)}>{t`Cancel`}</Button>
              </View>
            </View>
          ) : (actionsOpen || detail) && candidateHasActions ? (
            <View
              style={{
                flexDirection: wideActions ? 'row' : 'column',
                flexWrap: 'wrap',
                gap: 4,
                padding: 8,
                borderRadius: profile.chrome.card,
                backgroundColor: background(colors.surfaceRaised),
              }}>
              {/* Not where a host draws the primary action. On the detail
                  route the button at the bottom already both installs and
                  applies -- `save(true)` writes the theme before it activates
                  it -- so a Save above it offers the same write twice, once
                  under a different word, and puts the reader back in front of
                  the pair of half-synonymous buttons this screen was cleaned
                  up to get rid of. Elsewhere it stays: the picker sheet has no
                  footer of its own, and there "keep this without wearing it"
                  is a real second intent with nowhere else to live. */}
              {!candidate.id && !hostDrivesPrimaryAction ? (
                <Button
                  variant="ghost"
                  disabled={busy || missingImages}
                  onPress={() => void perform(() => save(false))}>{t`Save theme`}</Button>
              ) : null}
              {candidate.id ? (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onPress={() =>
                    void perform(async () => {
                      const installed = useThemeLibrary
                        .getState()
                        .library.themes.find((theme) => theme.id === candidate.id);
                      if (!installed) return;
                      await shareThemeFile(
                        `${installed.manifest.id}.muqun-theme`,
                        exportInstalledTheme(installed),
                        true
                      );
                    })
                  }>{t`Export theme`}</Button>
              ) : null}
              {candidate.id ? (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onPress={() =>
                    void perform(() =>
                      shareThemeColors(useThemeLibrary.getState().exportColors(candidate.id!))
                    )
                  }>{t`Export colours`}</Button>
              ) : null}
              {candidate.id ? (
                <Button
                  variant="ghost"
                  disabled={busy}
                  testID="theme-remove-previewed"
                  onPress={() => setRemoving(true)}>{t`Remove`}</Button>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
      {browsing && tabs ? (
        // One wrapper whose height settles, because going from a 24-tile grid
        // to a three-row list is a large delta and the sheet's scroll position
        // would otherwise land somewhere the reader did not put it.
        <Animated.View layout={listLayout('short')}>
          {/*
            A conditional render with a key, never two panels toggling
            `display`: React has to unmount one and mount the other for
            Reanimated's entering/exiting to fire at all, and the other spelling
            would also keep 24 tiles mounted behind a list.
          */}
          <Animated.View
            key={tab}
            entering={forward ? fadeInRight('short') : fadeInLeft('short')}
            exiting={forward ? fadeOutRight('short') : fadeOutLeft('short')}
            style={{ gap: 16 }}>
            {tab === 'mine' ? (
              <>
                {importPanel}
                {linkPanel}
                {library.themes.length ? (
                  mineList
                ) : (
                  // Under a tab the old "skip the whole block" would be a blank
                  // screen, so it gets one muted line and nothing else.
                  <Text
                    testID="theme-mine-empty"
                    variant="bodySmall"
                    color={
                      colors.textMuted
                    }>{t`No personal themes yet. Import one, or browse the published themes.`}</Text>
                )}
              </>
            ) : (
              children
            )}
          </Animated.View>
        </Animated.View>
      ) : (
        <>
          {browsing && library.themes.length ? mineList : null}
          {browsing ? children : null}
        </>
      )}
    </View>
  );
}

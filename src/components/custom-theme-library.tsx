import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';
import { Button } from '@/components/themed-button';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { Check, ChevronRight, MoreHorizontal, Trash2, X } from 'lucide-react-native';

import { CustomThemePreview } from '@/components/custom-theme-preview';
import { ThemeGallery } from '@/components/theme-gallery';
import { ThemeLinkImport } from '@/components/theme-link-import';
import { ThemeImportProgress } from '@/components/theme-import-progress';
import { ThemeAppearanceSettings } from '@/components/theme-appearance-settings';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { effectiveThemeManifest } from '@/theme/repository';
import { PressableScale } from '@/components/pressable-scale';
import { ThemePaletteStrip } from '@/components/theme-palette-strip';
import { useThemePack } from '@/hooks/use-theme-pack';
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
import type { ThemeManifest } from '@/theme/schema';
import type { ThemeEditorCandidate } from '@/theme/draft-session';

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

export function CustomThemeLibrary({
  initialManifest,
  initialCandidate,
  onOpenCandidate,
  detail = false,
  ownsPreparedAssets = true,
  onClosePreview,
  onPrimaryActionChange,
  children,
}: {
  initialManifest?: ThemeManifest;
  initialCandidate?: ThemeEditorCandidate;
  onOpenCandidate?: (candidate: ThemeEditorCandidate) => void;
  detail?: boolean;
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
  children?: ReactNode;
} = {}) {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const background = useSurfaceBackground();
  const { width } = useWindowDimensions();
  const wideDetail = detail && width >= 840;
  const library = useThemeLibrary((state) => state.library);
  const currentPack = useThemePack();
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [linkImportOpen, setLinkImportOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(detail);
  const [removing, setRemoving] = useState(false);
  const [candidate, setCandidate] = useState<ThemeEditorCandidate | null>(
    initialCandidate ?? (initialManifest ? { manifest: initialManifest } : null)
  );
  const [error, setError] = useState<string | null>(null);
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

  function closePreview() {
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

  async function perform(action: () => void | Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : t`Something went wrong`);
    } finally {
      pending.current = false;
      if (mounted.current) {
        setBusy(false);
        setStep(null);
      }
    }
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
    if (apply) {
      store.apply({ kind: 'custom', id });
      // Applying is a confirmation, exactly as choosing a built-in pack is:
      // write first, then leave. Holding the screen open behind a notice read
      // as the app having ignored the tap.
      closePreview();
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

  return (
    <View testID="custom-theme-library" style={{ gap: 16 }}>
      {browsing ? (
        <View style={{ gap: 16 }}>
          <View
            testID="theme-current-summary"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <Text variant="caption" color={colors.textMuted}>{t`Current theme`}</Text>
              <Text numberOfLines={1}>{currentPack.label}</Text>
            </View>
            <ThemePaletteStrip pack={currentPack} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              variant="secondary"
              disabled={busy}
              testID="theme-browse"
              onPress={() => {
                setGalleryOpen(!galleryOpen);
                setImportOpen(false);
              }}>{t`Browse themes`}</Button>
            <Button
              variant="secondary"
              disabled={busy}
              testID="theme-import"
              onPress={() => {
                setImportOpen(!importOpen);
                setGalleryOpen(false);
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
          {importOpen && !linkImportOpen ? (
            <View
              style={{
                gap: 8,
                padding: 12,
                borderRadius: 16,
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
                    const value = await pickThemeManifest(setReadStage).finally(() =>
                      setReadStage(null)
                    );
                    if (value !== null) {
                      if (!mounted.current) {
                        value.prepared?.dispose();
                        return;
                      }
                      if (onOpenCandidate) onOpenCandidate(value);
                      else setCandidate(value);
                      setImportOpen(false);
                      setActionsOpen(false);
                    }
                  })
                }>{t`Import file`}</Button>
            </View>
          ) : null}
          {galleryOpen ? (
            <ThemeGallery
              onClose={() => setGalleryOpen(false)}
              onReady={(value) => {
                if (onOpenCandidate) onOpenCandidate(value);
                else setCandidate(value);
                setGalleryOpen(false);
                setActionsOpen(false);
              }}
            />
          ) : null}
          {importOpen && linkImportOpen ? (
            <ThemeLinkImport
              onClose={() => setLinkImportOpen(false)}
              onReady={(value) => {
                if (onOpenCandidate) onOpenCandidate(value);
                else setCandidate(value);
                setLinkImportOpen(false);
                setImportOpen(false);
                setActionsOpen(false);
              }}
            />
          ) : null}
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
            borderRadius: 12,
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
                manifest={
                  installedCandidate
                    ? effectiveThemeManifest(installedCandidate)
                    : candidate.manifest
                }
                assets={assets}
              />
            </View>
            <View
              style={{
                flex: wideDetail ? 1 : undefined,
                width: wideDetail ? undefined : '100%',
                minWidth: 0,
              }}>
              {installedCandidate ? (
                <ThemeAppearanceSettings
                  key={installedCandidate.id}
                  installed={installedCandidate}
                  disabled={busy}
                  onTerminalChange={(value) =>
                    void perform(() =>
                      useThemeLibrary
                        .getState()
                        .setTerminalBackgroundOpacity(installedCandidate.id, value)
                    )
                  }
                  onSurfaceChange={(value) =>
                    void perform(() =>
                      useThemeLibrary
                        .getState()
                        .setSurfaceBackgroundOpacity(installedCandidate.id, value)
                    )
                  }
                  onLogoChange={(value) =>
                    void perform(() =>
                      useThemeLibrary.getState().setHideHomeLogo(installedCandidate.id, value)
                    )
                  }
                  onTextChange={(value) =>
                    void perform(() =>
                      useThemeLibrary.getState().setHideHomeText(installedCandidate.id, value)
                    )
                  }
                  onReset={() =>
                    void perform(() =>
                      useThemeLibrary.getState().resetAppearancePreferences(installedCandidate.id)
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
            {!detail ? (
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
                borderRadius: 16,
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
          ) : actionsOpen || detail ? (
            <View
              style={{
                gap: 4,
                padding: 8,
                borderRadius: 16,
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
                  }>{t`Export colors`}</Button>
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
      {browsing && library.themes.length ? (
        <View style={{ gap: 8 }}>
          <Text variant="bodySmall">{t`My themes`}</Text>
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
                  else setCandidate(next);
                  setError(null);
                  setNotice(null);
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
                  borderRadius: 12,
                  backgroundColor: background(colors.surfaceRaised),
                }}>
                <ThemePaletteStrip pack={installed.manifest.variants} />
                <Text variant="bodySmall" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>
                  {installed.manifest.name}
                </Text>
                {library.selection?.kind === 'custom' && library.selection.id === installed.id ? (
                  <Check size={18} color={colors.primary} />
                ) : (
                  <ChevronRight size={18} color={colors.textMuted} />
                )}
              </PressableScale>
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t`Remove ${installed.manifest.name}`}
                testID={`theme-remove-${installed.id}`}
                disabled={busy}
                onPress={() => {
                  setPendingRemoval(installed.id);
                  setError(null);
                  setNotice(null);
                }}
                style={{ padding: 12 }}>
                <Trash2 size={18} color={colors.textMuted} />
              </PressableScale>
            </View>
          ))}
          {pendingRemoval ? (
            <View
              testID="theme-list-remove-confirm"
              style={{
                gap: 8,
                padding: 12,
                borderRadius: 16,
                backgroundColor: background(colors.surfaceRaised),
              }}>
              <Text>{t`Remove this theme?`}</Text>
              <Text
                variant="bodySmall"
                color={colors.textMuted}>{t`The theme will be removed from this device`}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button
                  disabled={busy}
                  testID="theme-list-confirm-remove"
                  onPress={() =>
                    void perform(() => {
                      useThemeLibrary.getState().remove(pendingRemoval);
                      setPendingRemoval(null);
                    })
                  }>{t`Remove`}</Button>
                <Button
                  disabled={busy}
                  variant="ghost"
                  onPress={() => setPendingRemoval(null)}>{t`Cancel`}</Button>
              </View>
            </View>
          ) : null}
        </View>
      ) : null}
      {browsing ? children : null}
    </View>
  );
}

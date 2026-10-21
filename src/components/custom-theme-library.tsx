import { useAppearanceProfile } from '@/components/appearance-profile-provider';
import { useLingui } from '@lingui/react/macro';
import { useThemeMode, useThemeTokens, Button, PressableScale, Text } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { MoreIcon, CloseIcon } from '@/icons';

import { CustomThemePreview } from '@/components/custom-theme-preview';
import { ThemeImportProgress } from '@/components/theme-import-progress';
import { ThemeAppearanceSettings } from '@/components/theme-appearance-settings';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { effectiveThemeManifest, type InstalledTheme } from '@/theme/repository';
import { prepareThemeArtwork } from '@/theme/prepare-artwork';
import { useReskinTransition } from '@/components/reskin-transition';
import { useThemeLibrary } from '@/stores/theme-library';
import { auditThemeContrast } from '@/theme/contrast';
import { shareThemeColors, shareThemeFile } from '@/theme/local-files';
import { exportInstalledTheme } from '@/theme/assets';
import type { ThemeManifest } from '@/theme/schema';
import type { ThemeEditorCandidate } from '@/theme/draft-session';
import { settleAfter } from '@/lib/compiler-safe-control-flow';
import { isRenderableThemeAsset } from '@/theme/renderable-asset';

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
/** What the library has to say while it works, for a host that shows it itself. */
export type ThemeStatus =
  | { kind: 'installing' }
  | { kind: 'error'; text: string }
  | { kind: 'notice'; text: string };
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
  detail = false,
  ownsPreparedAssets = true,
  onClosePreview,
  onPrimaryActionChange,
  onStatusChange,
  mode = 'manage',
  onPreviewAppearanceChange,
}: {
  initialManifest?: ThemeManifest;
  initialCandidate?: ThemeEditorCandidate;
  detail?: boolean;
  mode?: 'preview' | 'manage';
  onPreviewAppearanceChange?: (appearance: InstalledTheme) => void;
  ownsPreparedAssets?: boolean;
  /**
   * The reader closed the preview (Done or the close control). Applying never
   * calls this: a theme is applied in place, and the reader stays on the
   * screen they pressed Apply on to see the result.
   */
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
   * Hand the status line to the host instead of drawing it above the theme.
   *
   * Drawn here, the progress of an apply ("Installing images") and its error
   * or notice appear above the preview and push it and the sliders down the
   * moment Apply is tapped. A host that pins its own button shows them where
   * they take no room; this component then stops drawing them.
   */
  onStatusChange?: (status: ThemeStatus | null) => void;
} = {}) {
  const profile = useAppearanceProfile();
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const reskin = useReskinTransition();
  const { resolvedMode } = useThemeMode();
  const background = useSurfaceBackground();
  const { width } = useWindowDimensions();
  const wideActions = width >= 840;
  const wideDetail = detail && wideActions;
  const library = useThemeLibrary((state) => state.library);
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
  const pending = useRef(false);
  const mounted = useRef(true);
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
    const persist = async () => {
      let installedAssets: Record<string, string> | undefined;
      if (!candidate.id && candidate.prepared) {
        setStep('installing');
        installedAssets = await candidate.prepared.install();
      }
      if (!mounted.current) return undefined;
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
      return id;
    };
    if (apply) {
      let selectedId: string | undefined;
      await reskin.run({
        kind: 'theme',
        accent: colors.primary,
        isCurrent: () => mounted.current,
        prepare: async () => {
          selectedId = await persist();
          const installed = useThemeLibrary
            .getState()
            .library.themes.find((entry) => entry.id === selectedId);
          if (installed)
            return prepareThemeArtwork(installed.manifest, installed.assets, resolvedMode, width);
        },
        // In place: the reader stays on this screen to see the theme land,
        // and the primary action turns into Done once it is the selected one.
        apply: () => {
          if (!selectedId) return;
          useThemeLibrary.getState().apply({ kind: 'custom', id: selectedId });
        },
      });
      return;
    }
    await persist();
    if (mounted.current) setNotice(t`Theme saved`);
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
  useEffect(() => {
    if (!onStatusChange) return;
    onStatusChange(
      error
        ? { kind: 'error', text: error }
        : step
          ? { kind: 'installing' }
          : notice
            ? { kind: 'notice', text: notice }
            : null
    );
  }, [onStatusChange, error, step, notice]);
  useEffect(() => () => onStatusChange?.(null), [onStatusChange]);

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

  return (
    <View testID="custom-theme-library" style={{ gap: 16 }}>
      {step && !onStatusChange ? (
        <ThemeImportProgress testID="theme-install-progress" label={t`Installing images`} />
      ) : null}
      {(error || notice) && !onStatusChange ? (
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
                <CloseIcon size={20} color={colors.textMuted} />
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
              {isRenderableThemeAsset(assets?.[candidate.manifest.preview ?? '']) ? (
                <Image
                  source={{ uri: assets![candidate.manifest.preview!] }}
                  contentFit="contain"
                  cachePolicy="memory"
                  accessible={false}
                  style={{ width: '100%', aspectRatio: 8 / 5, marginBottom: 12 }}
                />
              ) : null}
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
                <MoreIcon size={24} color={colors.textMuted} />
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
    </View>
  );
}

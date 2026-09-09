import { useLingui } from '@lingui/react/macro';
import { Button, Text, Textarea, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { Check, ChevronRight, MoreHorizontal, X } from 'lucide-react-native';

import { CustomThemePreview } from '@/components/custom-theme-preview';
import { PressableScale } from '@/components/pressable-scale';
import { ThemePaletteStrip } from '@/components/theme-palette-strip';
import { useThemePack } from '@/hooks/use-theme-pack';
import { useThemeLibrary } from '@/stores/theme-library';
import { auditThemeContrast } from '@/theme/contrast';
import {
  pickThemeManifest,
  shareThemeColors,
  shareThemeFile,
  type ThemeFilePreview,
} from '@/theme/local-files';
import { exportInstalledTheme } from '@/theme/assets';
import { useAppSettings } from '@/stores/app-settings';
import { parseThemeManifest, THEME_LIMITS, type ThemeManifest } from '@/theme/schema';

export function CustomThemeLibrary({
  initialManifest,
  onClosePreview,
  children,
}: {
  initialManifest?: ThemeManifest;
  onClosePreview?: () => void;
  children?: ReactNode;
} = {}) {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const library = useThemeLibrary((state) => state.library);
  const currentPack = useThemePack();
  const [editing, setEditing] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [text, setText] = useState('');
  const [candidate, setCandidate] = useState<
    (ThemeFilePreview & { id?: string; assets?: Record<string, string> }) | null
  >(initialManifest ? { manifest: initialManifest } : null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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
  useEffect(() => () => candidate?.prepared?.dispose(), [candidate?.prepared]);
  const contrast = candidate ? auditThemeContrast(candidate.manifest) : [];
  const imageCount = Object.keys(candidate?.manifest.assets ?? {}).length;
  const assets = candidate?.assets ?? candidate?.prepared?.assets ?? {};
  const missingImages = Object.keys(assets).length !== imageCount;
  const candidateSelected =
    library.selection?.kind === 'custom' && library.selection.id === candidate?.id;
  const browsing = !initialManifest && !candidate && !editing;

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

  function inspect(value: string) {
    const manifest = parseThemeManifest(value);
    setCandidate({ manifest });
    setText(value);
    setEditing(false);
    setImportOpen(false);
    setActionsOpen(false);
    setError(null);
    setNotice(null);
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
      if (mounted.current) setBusy(false);
    }
  }

  async function save(apply: boolean) {
    if (!candidate) return;
    const installedAssets = candidate.id ? undefined : await candidate.prepared?.install();
    if (!mounted.current) return;
    const store = useThemeLibrary.getState();
    const id = candidate.id ?? store.save(JSON.stringify(candidate.manifest), installedAssets).id;
    // Retain the installed identity even if a subsequent activation write fails.
    setCandidate({ ...candidate, id });
    if (apply) store.apply({ kind: 'custom', id });
    setNotice(apply ? t`Theme applied` : t`Theme saved`);
  }

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
              testID="theme-import"
              onPress={() => setImportOpen(!importOpen)}>{t`Import`}</Button>
            {canUndo ? (
              <Button
                variant="ghost"
                disabled={busy}
                onPress={() =>
                  void perform(() => useThemeLibrary.getState().undo())
                }>{t`Undo`}</Button>
            ) : null}
          </View>
          {importOpen ? (
            <View
              style={{
                gap: 8,
                padding: 12,
                borderRadius: 16,
                backgroundColor: colors.surfaceRaised,
              }}>
              <Button
                variant="secondary"
                disabled={busy}
                testID="theme-import-file"
                onPress={() =>
                  void perform(async () => {
                    const value = await pickThemeManifest();
                    if (value !== null) {
                      if (!mounted.current) {
                        value.prepared?.dispose();
                        return;
                      }
                      setCandidate(value);
                      setEditing(false);
                      setImportOpen(false);
                      setActionsOpen(false);
                      setText('');
                    }
                  })
                }>{t`Import file`}</Button>
              <Button
                variant="secondary"
                disabled={busy}
                testID="theme-paste-json"
                onPress={() => {
                  setEditing(true);
                  setImportOpen(false);
                  setCandidate(null);
                  setError(null);
                }}>{t`Paste JSON`}</Button>
            </View>
          ) : null}
        </View>
      ) : null}
      {editing ? (
        <View style={{ gap: 12 }}>
          <Textarea
            label={t`Theme JSON`}
            accessibilityLabel={t`Theme JSON`}
            testID="theme-json-input"
            value={text}
            onChangeText={setText}
            maxLength={THEME_LIMITS.manifestBytes}
            autoCorrect={false}
            autoCapitalize="none"
            minRows={4}
            maxRows={8}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              disabled={busy || !text.trim()}
              testID="theme-preview-json"
              onPress={() => void perform(() => inspect(text))}>{t`Preview`}</Button>
            <Button
              variant="ghost"
              disabled={busy}
              onPress={() => setEditing(false)}>{t`Cancel`}</Button>
          </View>
        </View>
      ) : null}
      {error ? (
        <Text selectable accessibilityRole="alert" color={colors.danger}>
          {error}
        </Text>
      ) : null}
      {notice ? (
        <Text accessibilityLiveRegion="polite" color={colors.text}>
          {notice}
        </Text>
      ) : null}
      {candidate ? (
        <View style={{ gap: 12 }}>
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
          <CustomThemePreview manifest={candidate.manifest} assets={assets} />
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
            {!candidateSelected ? (
              <Button
                testID="theme-apply"
                disabled={busy || contrast.length > 0 || missingImages}
                onPress={() => void perform(() => save(true))}>{t`Apply theme`}</Button>
            ) : (
              <Button disabled={busy} onPress={closePreview}>{t`Done`}</Button>
            )}
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
          </View>
          {removing ? (
            <View
              style={{
                gap: 8,
                padding: 12,
                borderRadius: 16,
                backgroundColor: colors.surfaceRaised,
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
          ) : actionsOpen ? (
            <View
              style={{
                gap: 4,
                padding: 8,
                borderRadius: 16,
                backgroundColor: colors.surfaceRaised,
              }}>
              {!candidate.id ? (
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
            <PressableScale
              key={installed.id}
              accessibilityRole="button"
              accessibilityLabel={installed.manifest.name}
              disabled={busy}
              onPress={() => {
                setCandidate({
                  manifest: installed.manifest,
                  id: installed.id,
                  assets: installed.assets,
                });
                setError(null);
                setNotice(null);
                setEditing(false);
                setActionsOpen(false);
                setImportOpen(false);
              }}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                padding: 12,
                borderRadius: 12,
                backgroundColor: colors.surfaceRaised,
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
          ))}
        </View>
      ) : null}
      {browsing ? children : null}
    </View>
  );
}

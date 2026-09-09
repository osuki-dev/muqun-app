import { useLingui } from '@lingui/react/macro';
import { Button, Text, Textarea, useThemeTokens } from '@osuki-dev/ui';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { CustomThemePreview } from '@/components/custom-theme-preview';
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
import { parseThemeManifest, THEME_LIMITS } from '@/theme/schema';

export function CustomThemeLibrary() {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const library = useThemeLibrary((state) => state.library);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [candidate, setCandidate] = useState<
    (ThemeFilePreview & { id?: string; assets?: Record<string, string> }) | null
  >(null);
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

  function inspect(value: string) {
    const manifest = parseThemeManifest(value);
    setCandidate({ manifest });
    setText(value);
    setEditing(false);
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

  function save(apply: boolean) {
    if (!candidate) return;
    const store = useThemeLibrary.getState();
    const id =
      candidate.id ??
      store.save(JSON.stringify(candidate.manifest), candidate.prepared?.install()).id;
    // Retain the installed identity even if a subsequent activation write fails.
    setCandidate({ ...candidate, id });
    if (apply) store.apply({ kind: 'custom', id });
    setNotice(apply ? t`Theme applied` : t`Theme saved`);
  }

  return (
    <View testID="custom-theme-library" style={{ gap: 16 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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
            setCandidate(null);
            setError(null);
          }}>{t`Paste JSON`}</Button>
        {canUndo ? (
          <Button
            variant="ghost"
            disabled={busy}
            onPress={() => void perform(() => useThemeLibrary.getState().undo())}>{t`Undo`}</Button>
        ) : null}
      </View>
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
          <Text selectable>{candidate.manifest.name}</Text>
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
            <Button
              testID="theme-apply"
              disabled={busy || contrast.length > 0 || missingImages}
              onPress={() => void perform(() => save(true))}>{t`Apply theme`}</Button>
            <Button
              variant="secondary"
              disabled={busy || missingImages || Boolean(candidate.id)}
              onPress={() => void perform(() => save(false))}>{t`Save theme`}</Button>
            {candidate.id ? (
              <Button
                variant="secondary"
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
                variant="secondary"
                disabled={busy}
                onPress={() =>
                  void perform(() =>
                    shareThemeColors(useThemeLibrary.getState().exportColors(candidate.id!))
                  )
                }>{t`Export colors`}</Button>
            ) : null}
            <Button
              variant="ghost"
              disabled={busy}
              onPress={() => setCandidate(null)}>{t`Close preview`}</Button>
          </View>
        </View>
      ) : null}
      {library.themes.length ? (
        <View style={{ gap: 8 }}>
          <Text variant="bodySmall">{t`My themes`}</Text>
          {library.themes.map((installed) => (
            <View
              key={installed.id}
              style={{
                gap: 8,
                padding: 12,
                borderRadius: 12,
                backgroundColor: colors.surfaceRaised,
              }}>
              <Button
                variant="ghost"
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
                }}>
                {installed.manifest.name}
              </Button>
              {library.selection?.kind === 'custom' && library.selection.id === installed.id ? (
                <Text variant="caption" color={colors.primary}>{t`Selected`}</Text>
              ) : null}
              <Button
                variant="ghost"
                disabled={busy}
                testID={candidate?.id === installed.id ? 'theme-remove-previewed' : undefined}
                onPress={() =>
                  void perform(() => {
                    useThemeLibrary.getState().remove(installed.id);
                    if (candidate?.id === installed.id) setCandidate(null);
                  })
                }>{t`Remove`}</Button>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

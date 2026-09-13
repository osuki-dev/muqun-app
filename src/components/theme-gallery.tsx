import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useLingui } from '@lingui/react/macro';
import { Text, useThemeTokens } from '@osuki-dev/ui';

import { Button } from '@/components/themed-button';
import { ThemeImportProgress } from '@/components/theme-import-progress';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import { throwIfThemeAborted } from '@/theme/abort';
import type { ThemeAssetProgress } from '@/theme/asset-stream';
import { prepareThemeAssetStream, type PreparedThemeAssets } from '@/theme/assets';
import type { ThemeEditorCandidate } from '@/theme/draft-session';
import { loadThemeIndex, themePackageUrl, type ThemeIndexEntry } from '@/theme/gallery';
import { ThemeImportRequest } from '@/theme/import-request';
import { publicThemeTransport } from '@/theme/public-transport';
import { inspectRemoteTheme } from '@/theme/remote-import';

/** Whether this build can reach the catalogue at all -- see `public-transport`. */
export const themeGalleryAvailable = publicThemeTransport !== null;

/**
 * The published themes, as a list, with nothing downloaded until one is chosen.
 *
 * The index is read once when this opens and carries everything a row draws, so
 * the list itself costs one small request no matter how long it grows. A
 * package is a different matter -- the one theme published today is 3.8 MiB and
 * the format allows 25 -- so a row shows its size and downloads nothing until
 * it is pressed. The same rule the site's own gallery follows, for the same
 * reason: this is the device where a list that fetched everything it drew would
 * be unusable.
 *
 * Pressing a row ends in the editor a reader already knows, through the same
 * `onReady` the link and file imports use. Nothing installs or applies here;
 * this screen only turns a catalogue entry into a candidate.
 *
 * Cancellation follows `ThemeLinkImport` exactly, because the hazard is
 * identical: a download that finishes after the screen is gone has staged
 * assets that nothing will ever dispose. One owned request at a time, unmount
 * cancels it, `handoff` is the single ownership boundary, and `finally` disposes
 * whatever did not transfer.
 */
export function ThemeGallery({
  onReady,
  onClose,
}: {
  onReady: (candidate: ThemeEditorCandidate) => void;
  onClose: () => void;
}) {
  const { t } = useLingui();
  const { colors } = useThemeTokens();
  const background = useSurfaceBackground();

  const [entries, setEntries] = useState<ThemeIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Which row is downloading. A row, not a boolean: the progress belongs under
  // the theme it is for, and a second press elsewhere must not look like it did
  // something.
  const [pending, setPending] = useState<string | null>(null);
  const [progress, setProgress] = useState<ThemeAssetProgress | null>(null);

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
    if (!publicThemeTransport) {
      setError(t`This app build cannot reach the theme catalogue`);
      return;
    }
    const request = new ThemeImportRequest();
    void (async () => {
      try {
        const list = await loadThemeIndex(publicThemeTransport, request.signal);
        if (mounted.current && !request.isCanceled) setEntries(list);
      } catch (cause) {
        if (mounted.current && !request.isCanceled)
          setError(cause instanceof Error ? cause.message : t`Something went wrong`);
      }
    })();
    return () => request.cancel();
    // `t` is stable for a locale; re-reading the catalogue on a language change
    // would throw away a list the reader is looking at to get the same list.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function open(entry: ThemeIndexEntry) {
    if (!publicThemeTransport || active.current) return;
    const request = new ThemeImportRequest();
    active.current = request;
    setPending(entry.id);
    setError(null);
    void (async () => {
      const { signal } = request;
      let prepared: PreparedThemeAssets | undefined;
      let transferred = false;
      try {
        // `format: 'package'` because a catalogue entry is always a packed
        // `.muqun-theme`. Its assets come out of the archive rather than off the
        // network, so there are no third-party domains for a reader to review --
        // one download, from the origin they already chose by opening this.
        const inspection = await inspectRemoteTheme(publicThemeTransport, themePackageUrl(entry), {
          signal,
          format: 'package',
        });
        throwIfThemeAborted(signal);
        prepared = await prepareThemeAssetStream(inspection.manifest, inspection.assets(signal), {
          signal,
          onProgress(value) {
            if (mounted.current && !signal.aborted) setProgress(value);
          },
        });
        throwIfThemeAborted(signal);
        if (!mounted.current) return;
        const candidate = { manifest: inspection.manifest, prepared };
        request.handoff(() => onReady(candidate));
        transferred = true;
      } catch (cause) {
        if (mounted.current && active.current === request && !request.isCanceled)
          setError(cause instanceof Error ? cause.message : t`Something went wrong`);
      } finally {
        if (!transferred) prepared?.dispose();
        if (active.current === request) active.current = null;
        if (mounted.current) {
          setPending(null);
          setProgress(null);
        }
      }
    })();
  }

  const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

  return (
    <View testID="theme-gallery" style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="caption" color={colors.textMuted}>
            {t`Themes published at muqun.dev. Nothing downloads until you open one.`}
          </Text>
        </View>
        <Button variant="ghost" disabled={pending !== null} onPress={onClose}>{t`Close`}</Button>
      </View>

      {error ? (
        <Text testID="theme-gallery-error" color={colors.danger}>
          {error}
        </Text>
      ) : null}

      {entries === null && !error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text color={colors.textMuted}>{t`Loading themes…`}</Text>
        </View>
      ) : null}

      {entries !== null && entries.length === 0 ? (
        <Text color={colors.textMuted}>{t`No themes are published yet`}</Text>
      ) : null}

      <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 8 }}>
        {(entries ?? []).map((entry) => (
          <Pressable
            key={entry.id}
            accessibilityRole="button"
            accessibilityLabel={entry.name}
            accessibilityState={{ disabled: pending !== null }}
            testID={`theme-gallery-item:${entry.id}`}
            disabled={pending !== null}
            onPress={() => open(entry)}
            style={{
              gap: 6,
              padding: 12,
              borderRadius: 16,
              backgroundColor: background(colors.surfaceRaised),
              opacity: pending !== null && pending !== entry.id ? 0.5 : 1,
            }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ flex: 1, minWidth: 0 }} numberOfLines={1}>
                {entry.name}
              </Text>
              <Text variant="caption" color={colors.textMuted}>
                {megabytes(entry.bytes)}
              </Text>
            </View>
            {entry.description ? (
              <Text variant="caption" color={colors.textMuted} numberOfLines={2}>
                {entry.description}
              </Text>
            ) : null}
            {entry.author ? (
              <Text variant="caption" color={colors.textSubtle} numberOfLines={1}>
                {entry.author}
              </Text>
            ) : null}
            {pending === entry.id ? (
              <ThemeImportProgress
                testID="theme-gallery-progress"
                label={progress ? t`Preparing images` : t`Downloading theme`}
                completed={progress?.completedAssets}
                total={progress?.totalAssets}
                receivedBytes={progress?.receivedBytes}
              />
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

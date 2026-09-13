/**
 * How much room Muqun's cache is taking, and the one button that gives some of
 * it back.
 *
 * Three rows that only state facts, and a fourth that does something. The three
 * are split the way a reader's question is: pictures, copies the app made to
 * hand a file to something else, and everything else -- which on both platforms
 * is mostly the HTTP engine's own store, held open by the engine and not
 * Muqun's to delete. Saying so in the row is cheaper than fielding "why is
 * there still 40 MB after I cleared it".
 *
 * The clear is an allow-list, decided in `lib/cache-storage.ts` and not here.
 * Nothing on this screen may reach outside `Paths.cache`: the paired gateways,
 * the SSH hosts and keys, the installed theme assets and the update bundle all
 * live somewhere else, and a cache button that could touch any of them would be
 * a data-loss bug wearing a utility's clothes. `planCacheDeletions` re-checks
 * every URI against the cache root before this component deletes anything.
 *
 * The walk runs off the first frame. A Glide cache at its 250 MB ceiling is
 * thousands of files, and `Directory.size` recurses in native code, so the
 * measurement is deferred past the push and yields between top-level entries
 * rather than asking for all of it on one tick.
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Spinner, Text, useThemeTokens } from '@osuki-dev/ui';
import { Image } from 'expo-image';
import { Directory, Paths } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import { ChevronRight, FileClock, HardDrive, Images, Trash2 } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import {
  LADDER,
  SettingsInfoRow,
  SettingsNavRow,
  SettingsSection,
} from '@/components/settings-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import {
  type CacheRootEntry,
  type CacheTotals,
  clearableCacheBytes,
  formatCacheSize,
  measureCache,
  planCacheDeletions,
} from '@/lib/cache-storage';
import { feedback } from '@/lib/feedback';
import { useRenderTally } from '@/lib/render-tally';

/**
 * Hand the frame back before doing the next expensive thing.
 *
 * `requestIdleCallback` rather than a timer, for the reason the settings screen
 * already states about its own deferral: the beat being waited for is "the UI
 * has nothing better to do", not a number of milliseconds. The timeout is the
 * guarantee that a device which never goes idle still finishes the walk.
 */
function whenIdle(timeout: number): Promise<void> {
  return new Promise((resolve) => {
    requestIdleCallback(() => resolve(), { timeout });
  });
}

/**
 * One pass over the top level of the cache directory.
 *
 * Top level only: `size` on a `Directory` already recurses natively, which is
 * one cheap call per entry instead of thousands of round trips through the
 * bridge for a Glide cache. The yield sits between entries, so the longest the
 * UI ever waits on this is one directory's own walk.
 */
async function readCacheRoot(): Promise<{ root: string; entries: CacheRootEntry[] }> {
  const root = Paths.cache;
  const entries: CacheRootEntry[] = [];
  for (const item of root.list()) {
    await whenIdle(100);
    let bytes = 0;
    try {
      // `Directory.size` is `number | null` and `File.size` is `number`; both
      // are readable off the union without narrowing, and both can throw when
      // the OS refuses the read.
      bytes = item.size ?? 0;
    } catch {
      // An unreadable entry is worth nothing to the total rather than worth
      // abandoning the whole measurement for.
    }
    entries.push({ name: item.name, uri: item.uri, bytes });
  }
  return { root: root.uri, entries };
}

export function SettingsStorage({ title }: { title: string }) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  useRenderTally('SettingsStorage');

  const [totals, setTotals] = useState<CacheTotals | null>(null);
  const [armed, setArmed] = useState(false);
  const [clearing, setClearing] = useState(false);
  /** One non-fatal line when a directory would not go. The rest still went. */
  const [incomplete, setIncomplete] = useState(false);
  // The walk outlives a fast back-swipe, and a `setState` after the unmount is
  // a warning about a screen nobody is looking at.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const measure = useCallback(async () => {
    try {
      const { entries } = await readCacheRoot();
      if (mounted.current) setTotals(measureCache(entries));
    } catch {
      // A platform with no readable cache directory -- web, or an OS that has
      // taken the whole thing away under us -- reports an empty cache rather
      // than a permanently spinning row.
      if (mounted.current) setTotals(measureCache([]));
    }
  }, []);

  // On arrival and on every return to this screen, because the numbers move
  // while the reader is elsewhere in the app: opening a session with images in
  // it is what fills the Images bucket.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const handle = requestIdleCallback(
        () => {
          if (!cancelled) void measure();
        },
        { timeout: 500 }
      );
      return () => {
        cancelled = true;
        cancelIdleCallback(handle);
      };
    }, [measure])
  );

  /**
   * Empty the two clearable buckets, and never the third.
   *
   * The images go through `expo-image`'s own API: Glide and SDWebImage keep a
   * journal beside their entries, and a directory deleted out from under either
   * of them is a cache that crashes rather than a cache that is empty. Every
   * other directory is deleted by path, each in its own `try` -- one refusal
   * (a file the OS has open, a permission that changed) must not leave the rest
   * of the cache untouched and the reader with no idea which half went.
   */
  async function clear() {
    if (clearing) return;
    setClearing(true);
    setIncomplete(false);
    let failed = false;

    try {
      await Image.clearDiskCache();
    } catch {
      failed = true;
    }
    try {
      await Image.clearMemoryCache();
    } catch {
      failed = true;
    }

    try {
      const { root, entries } = await readCacheRoot();
      for (const entry of planCacheDeletions(entries, root)) {
        await whenIdle(100);
        try {
          const directory = new Directory(entry.uri);
          if (directory.exists) directory.delete();
        } catch {
          failed = true;
        }
      }
    } catch {
      failed = true;
    }

    if (mounted.current) {
      setTotals(null);
      setIncomplete(failed);
      setArmed(false);
      setClearing(false);
    }
    await feedback(failed ? 'warning' : 'success');
    await measure();
  }

  const calculating = t`Calculating…`;
  const images = totals ? formatCacheSize(totals.images) : calculating;
  const temporary = totals ? formatCacheSize(totals.temporary) : calculating;
  const other = totals
    ? t`${formatCacheSize(totals.other)} · Managed by the system. Clear cache leaves it alone.`
    : calculating;
  const clearable = totals ? formatCacheSize(clearableCacheBytes(totals)) : calculating;
  const clearDetail = incomplete ? t`Some files could not be removed · ${clearable}` : clearable;

  return (
    <SettingsSection title={title}>
      <SettingsInfoRow
        icon={Images}
        label={t`Images`}
        detail={images}
        testID="settings-storage-images-row"
      />
      <SettingsInfoRow
        icon={FileClock}
        label={t`Temporary files`}
        detail={temporary}
        testID="settings-storage-temporary-row"
      />
      <SettingsInfoRow
        icon={HardDrive}
        label={t`Other`}
        detail={other}
        testID="settings-storage-other-row"
      />
      {armed ? (
        // Two taps, never one, and the confirm stays inside the card the way
        // the unpair control does. A system alert here would be the one modal
        // on a screen whose every other decision is made in place.
        <View style={styles.armedRow}>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={clearing ? t`Clearing cache` : t`Confirm clear cache`}
            accessibilityState={{ disabled: clearing, busy: clearing }}
            disabled={clearing}
            feedback="selection"
            testID="settings-clear-cache-confirm"
            onPress={() => void clear()}
            style={[
              styles.action,
              styles.armedButton,
              { backgroundColor: surfaceBackground(theme.colors.danger) },
              clearing && styles.pendingAction,
            ]}>
            {clearing ? (
              <Spinner size="sm" color={theme.colors.onPrimary} />
            ) : (
              <Trash2 size={15} color={theme.colors.onPrimary} strokeWidth={2.2} />
            )}
            <Text variant="caption" color={theme.colors.onPrimary} style={styles.armedText}>
              {clearing ? <Trans>Clearing…</Trans> : <Trans>Clear</Trans>}
            </Text>
          </PressableScale>
          <PressableScale
            accessibilityRole="button"
            accessibilityLabel={t`Keep cached files`}
            accessibilityState={{ disabled: clearing }}
            disabled={clearing}
            testID="settings-clear-cache-cancel"
            onPress={() => {
              if (!clearing) setArmed(false);
            }}
            style={[
              styles.action,
              styles.armedButton,
              { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
              clearing && styles.pendingAction,
            ]}>
            <Text variant="caption" color={theme.colors.textMuted}>
              <Trans>Cancel</Trans>
            </Text>
          </PressableScale>
        </View>
      ) : (
        <SettingsNavRow
          icon={Trash2}
          trailing={ChevronRight}
          label={t`Clear cache`}
          detail={clearDetail}
          disabled={!totals}
          testID="settings-clear-cache-row"
          onPress={() => setArmed(true)}
        />
      )}
    </SettingsSection>
  );
}

const styles = StyleSheet.create({
  // The same measurements the servers section's own two-tap control uses, so
  // the armed pair reads as one control the app has rather than two.
  armedRow: {
    flexDirection: 'row',
    gap: LADDER.gap,
    paddingHorizontal: LADDER.gutter,
    paddingVertical: LADDER.snug,
  },
  action: {
    minHeight: 40,
    paddingHorizontal: LADDER.snug,
    borderRadius: 12,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: LADDER.gap,
  },
  armedButton: { flex: 1 },
  armedText: { fontWeight: '700' },
  pendingAction: { opacity: 0.7 },
});

import {
  clearCache,
  isCacheEntryProtected,
  scheduleAutomaticCacheCleanup,
} from '@/lib/cache-cleanup';
import { useAppearanceProfile } from '@/components/appearance-profile-provider';
/**
 * How much room Muqun's cache is taking, and the two buttons that give some of
 * it back.
 *
 * Only reclaimable categories are shown: images and temporary copies. Engine
 * caches and persistent user data are not presented as a cleaning action.
 *
 * The clear is an allow-list, decided in `lib/cache-storage.ts` and not here.
 * Nothing on this screen may reach outside `Paths.cache`: the paired gateways,
 * the SSH hosts and keys, the installed theme assets and the update bundle all
 * live somewhere else, and a cache button that could touch any of them would be
 * a data-loss bug wearing a utility's clothes. `planCacheDeletions` re-checks
 * every URI against the cache root before the shared action deletes anything.
 *
 * The second action is the one exception to that sentence, and it is an
 * exception only in what it reports. Installed theme images are the one thing
 * outside the cache a reader can accumulate without meaning to -- a photograph
 * apiece, kept for as long as the theme is installed -- so the row states them.
 * It still deletes nothing itself: it removes library entries, which is the
 * only authority it is given, and the repository's own reference collector is
 * what reclaims the files. `lib/theme-storage.ts` decides which themes those
 * are, and `removeUnusedThemes` below states the chain the bytes actually go
 * through.
 *
 * Both walks run off the first frame. A Glide cache at its 250 MB ceiling is
 * thousands of files, and `Directory.size` recurses in native code, so the
 * measurement is deferred past the push and yields between top-level entries
 * rather than asking for all of it on one tick.
 */
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { Spinner, useThemeTokens, Text } from '@osuki-dev/ui';
import { PressableScale } from '@/components/pressable-scale';
import { Directory, Paths } from 'expo-file-system';
import { useFocusEffect } from 'expo-router';
import { NextIcon, FileHistoryIcon, PhotosIcon, AppearanceIcon, DeleteIcon } from '@/icons';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import {
  LADDER,
  SettingsBlock,
  SettingsInfoRow,
  SettingsNavRow,
  SettingsCard,
} from '@/components/settings-chrome';
import { useSurfaceBackground } from '@/hooks/use-surface-background';
import {
  type CacheRootEntry,
  type CacheTotals,
  clearableCacheBytes,
  formatCacheSize,
  measureCache,
} from '@/lib/cache-storage';
import { SettingsSegmented } from '@/components/settings-segmented';
import { useAppSettings } from '@/stores/app-settings';
import { isCacheCleanupIntervalDays } from '@/lib/cache-cleanup-policy';
import { feedback } from '@/lib/feedback';
import { fadeIn, listLayout } from '@/lib/motion';
import { useRenderTally } from '@/lib/render-tally';
import { planUnusedThemes, type ThemeAssetFile } from '@/lib/theme-storage';
import { useThemeLibrary } from '@/stores/theme-library';
import { themeAssetDirectoryUri } from '@/theme/assets';

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

/**
 * One pass over the theme asset directory, which is flat by construction.
 *
 * `theme/assets.native.ts` writes content-addressed files side by side with
 * nothing between them, so every entry here is one `size` on a file -- a stat,
 * not the recursive walk a cache entry costs. That is why the yield sits in
 * front of the listing rather than between its entries: the whole of this walk
 * is cheaper than one step of `readCacheRoot`'s, and a theme library is fifty
 * entries at its ceiling rather than thousands.
 */
async function readThemeAssets(): Promise<ThemeAssetFile[]> {
  const root = themeAssetDirectoryUri();
  if (!root) return [];
  await whenIdle(100);
  const directory = new Directory(root);
  if (!directory.exists) return [];
  const files: ThemeAssetFile[] = [];
  for (const item of directory.list()) {
    let bytes = 0;
    try {
      bytes = item.size ?? 0;
    } catch {
      // As above: an entry the OS will not measure is worth nothing rather than
      // worth abandoning the measurement for.
    }
    files.push({ name: item.name, uri: item.uri, bytes });
  }
  return files;
}

// Only the action slot moves; the capacity rows and sheet ground stay mounted.
const actionFade = fadeIn('short').withInitialValues({ opacity: 0.65 });
const actionLayout = listLayout('short');

function StorageActionTransition({
  mode,
  children,
}: {
  mode: 'confirm' | 'idle';
  children: ReactNode;
}) {
  return (
    <Animated.View layout={actionLayout} collapsable={false}>
      <Animated.View key={mode} entering={actionFade}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}

export function SettingsStorage() {
  const { t } = useLingui();
  const profile = useAppearanceProfile();
  const theme = useThemeTokens();
  const surfaceBackground = useSurfaceBackground();
  useRenderTally('SettingsStorage');

  // The library, not a copy of it taken when this screen was pushed: removing a
  // theme changes it, and so does applying one from the sheet two sections up.
  // Both change what this row is allowed to offer, and the row has to say so
  // without being left and re-entered.
  const cleanupIntervalDays = useAppSettings((state) => state.cacheCleanupIntervalDays);
  const updateSettings = useAppSettings((state) => state.update);

  const themes = useThemeLibrary((state) => state.library.themes);
  const selection = useThemeLibrary((state) => state.library.selection);

  const [totals, setTotals] = useState<CacheTotals | null>(null);
  const [reclaimableBytes, setReclaimableBytes] = useState(0);
  const [themeFiles, setThemeFiles] = useState<ThemeAssetFile[] | null>(null);
  /** Which of the two actions is armed, because never both at once. */
  const [armed, setArmed] = useState<'cache' | 'themes' | null>(null);
  const [clearing, setClearing] = useState(false);
  const [removing, setRemoving] = useState(false);
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
      const { root, entries } = await readCacheRoot();
      if (mounted.current) {
        setTotals(measureCache(entries));
        setReclaimableBytes(clearableCacheBytes(entries, root, isCacheEntryProtected));
      }
    } catch {
      // A platform with no readable cache directory -- web, or an OS that has
      // taken the whole thing away under us -- reports an empty cache rather
      // than a permanently spinning row.
      if (mounted.current) {
        setTotals(measureCache([]));
        setReclaimableBytes(0);
      }
    }
  }, []);

  const measureThemes = useCallback(async () => {
    try {
      if (mounted.current) setThemeFiles(await readThemeAssets());
    } catch {
      // No readable theme directory is an installed library holding no files,
      // which is exactly what a device that has never imported a theme has. The
      // count still comes from the library itself either way.
      if (mounted.current) setThemeFiles([]);
    }
  }, []);

  // The cheap walk last, so the three rows the reader looks at first are not
  // waiting behind it.
  const measureAll = useCallback(async () => {
    await measure();
    await measureThemes();
  }, [measure, measureThemes]);

  // On arrival and on every return to this screen, because the numbers move
  // while the reader is elsewhere in the app: opening a session with images in
  // it is what fills the Images bucket, and importing a theme is what fills the
  // other one.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const cancelAutomaticCleanup = scheduleAutomaticCacheCleanup(() => void measureAll());
      const handle = requestIdleCallback(
        () => {
          if (!cancelled) void measureAll();
        },
        { timeout: 500 }
      );
      return () => {
        cancelled = true;
        cancelAutomaticCleanup();
        cancelIdleCallback(handle);
      };
    }, [measureAll])
  );

  /**
   * Empty the two clearable buckets, and never the third.
   *
   * The images go through `expo-image`'s own API: Glide and SDWebImage keep a
   * journal beside their entries, and a directory deleted out from under either
   * of them is a cache that crashes rather than a cache that is empty. Every
   * reclaimable directory is deleted by path, unless a producer still owns it.
   * Each deletion has its own `try` -- one refusal
   * (a file the OS has open, a permission that changed) must not leave the rest
   * of the cache untouched and the reader with no idea which half went.
   */
  async function clear() {
    if (clearing) return;
    setClearing(true);
    setIncomplete(false);
    const failed = !(await clearCache());

    // Keep the last measured capacities and the busy control until the fresh
    // totals arrive, rather than flashing every row through "Calculating…".
    await measureAll();
    if (mounted.current) {
      setIncomplete(failed);
      setArmed(null);
      setClearing(false);
    }
    await feedback(failed ? 'warning' : 'success');
  }

  /**
   * Drop every theme nobody is looking at, and delete no file at all.
   *
   * The files are not this component's to remove and it does not try. Each
   * `remove` is one durable library write, and the store republishes the
   * library's ownership immediately afterwards: `stores/theme-library.ts:51`
   * hands the remaining themes to `setThemeAssetReferences`, which at
   * `theme/assets.native.ts:44` replaces the live reference set and, when that
   * set changed, runs `collectThemeAssetGarbage` (same file, line 25) to delete
   * every content-addressed file no installed theme names any more. So a file
   * two themes shared survives until the second of them goes -- the same
   * arithmetic `planUnusedThemes` computed the row's size with.
   *
   * One theme at a time, each in its own `try`, with the frame handed back
   * between them: a refused write -- a full disk, a metadata store that will
   * not open -- must not stop the rest of the list from going. There is no
   * "some of them could not be removed" line to go with the cache's, and there
   * does not need to be: a theme that stayed is still in the library, so the
   * count this row states after the recount is the answer.
   *
   * What is removed is re-decided here, against the library as it is on this
   * tick, and never the `unused` the row is displaying. That one was computed
   * when the theme directory was last walked, and the walk only runs on focus:
   * the theme sheet two sections up applies a selection over this screen
   * without it ever losing focus, so between the measurement and this tap the
   * displayed plan can name the theme that is now applied. Removing it would be
   * the single thing this action must never do, so the ids are read fresh. No
   * files are passed, because only the id set is wanted -- the bytes are the
   * row's business and `planUnusedThemes` computes the two independently.
   */
  async function removeUnusedThemes() {
    if (removing) return;
    setRemoving(true);
    let failed = false;
    const { library, remove } = useThemeLibrary.getState();
    const doomed = planUnusedThemes(library.themes, library.selection, []).removable;
    for (const installed of doomed) {
      await whenIdle(100);
      try {
        remove(installed.id);
      } catch {
        failed = true;
      }
    }

    await measureThemes();
    if (mounted.current) {
      setArmed(null);
      setRemoving(false);
    }
    await feedback(failed ? 'warning' : 'success');
  }

  const calculating = t`Calculating…`;
  const images = totals ? formatCacheSize(totals.images) : calculating;
  const temporary = totals ? formatCacheSize(totals.temporary) : calculating;
  const clearable = totals ? formatCacheSize(reclaimableBytes) : calculating;
  const hasRetainedCache = totals !== null && totals.images + totals.temporary > reclaimableBytes;
  const clearDetail = incomplete ? t`Some files could not be removed · ${clearable}` : clearable;
  // The count comes from the library and the bytes from the walk, so this is
  // recomputed rather than held in state: a removal updates the library on the
  // same tick and the row must not keep stating a theme that is gone until the
  // recount catches up.
  const unused = themeFiles ? planUnusedThemes(themes, selection, themeFiles) : null;
  const themesDetail = unused
    ? t`${plural(unused.count, { one: '# theme', other: '# themes' })} · ${formatCacheSize(unused.reclaimableBytes)}`
    : calculating;

  return (
    <SettingsCard flush>
      <SettingsBlock
        label={t`Automatic cache cleanup`}
        caption={
          <Text variant="caption" color={theme.colors.textMuted}>
            <Trans>Clears cache when due after opening Muqun. Saved themes are kept.</Trans>
          </Text>
        }>
        <SettingsSegmented
          testID="settings-cache-cleanup-interval"
          options={[
            { label: t`Off`, value: '0' },
            { label: t`10 days`, value: '10' },
            { label: t`30 days`, value: '30' },
          ]}
          value={String(cleanupIntervalDays)}
          onChange={(value) => {
            const days = Number(value);
            if (!isCacheCleanupIntervalDays(days) || days === cleanupIntervalDays) return;
            void updateSettings({
              cacheCleanupIntervalDays: days,
              cacheCleanupEnabledAt: days > 0 ? Date.now() : 0,
            }).catch(() => void feedback('warning'));
          }}
        />
      </SettingsBlock>
      <SettingsInfoRow
        icon={PhotosIcon}
        label={t`Images`}
        detail={images}
        testID="settings-storage-images-row"
      />
      <SettingsInfoRow
        icon={FileHistoryIcon}
        label={t`Temporary files`}
        detail={temporary}
        testID="settings-storage-temporary-row"
      />
      {hasRetainedCache ? (
        <Text variant="caption" color={theme.colors.textMuted} style={styles.retainedHint}>
          <Trans>Files in use and managed caches are kept.</Trans>
        </Text>
      ) : null}
      <StorageActionTransition mode={armed === 'cache' ? 'confirm' : 'idle'}>
        {armed === 'cache' ? (
          // Two taps, never one, and the confirm stays inside the card the way
          // the unpair control does. A system alert here would be the one modal
          // on a screen whose every other decision is made in place.
          <View style={[styles.armedRow, { paddingVertical: profile.settingsRowPaddingVertical }]}>
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
                { borderRadius: profile.chrome.control },
                styles.armedButton,
                { backgroundColor: surfaceBackground(theme.colors.danger) },
                clearing && styles.pendingAction,
              ]}>
              {clearing ? (
                <Spinner size="sm" color={theme.colors.onPrimary} />
              ) : (
                <DeleteIcon size={15} color={theme.colors.onPrimary} />
              )}
              {/* The weight is the kit's prop, not a `fontWeight: '700'` in the
                stylesheet. `expo-font` registers a reader's interface face under
                Typeface.NORMAL only, so Android rounds 700 and over up to BOLD,
                misses, and falls back to a system lookup that does not know the
                family -- leaving the armed label as the one word on the sheet in
                the platform's own bold. The kit caps the prop at semibold. */}
              <Text variant="caption" weight="semibold" color={theme.colors.onPrimary}>
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
                if (!clearing) setArmed(null);
              }}
              style={[
                styles.action,
                { borderRadius: profile.chrome.control },
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
            icon={DeleteIcon}
            trailing={NextIcon}
            label={t`Clear cache`}
            detail={clearDetail}
            disabled={!totals}
            testID="settings-clear-cache-row"
            onPress={() => setArmed('cache')}
          />
        )}
      </StorageActionTransition>
      <StorageActionTransition mode={armed === 'themes' ? 'confirm' : 'idle'}>
        {armed === 'themes' ? (
          // The same pair, in the same place, for the same reason. An action that
          // takes somebody's import away gets the second tap the cache gets.
          <View style={[styles.armedRow, { paddingVertical: profile.settingsRowPaddingVertical }]}>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={
                removing ? t`Removing unused themes` : t`Confirm remove unused themes`
              }
              accessibilityState={{ disabled: removing, busy: removing }}
              disabled={removing}
              feedback="selection"
              testID="settings-remove-themes-confirm"
              onPress={() => void removeUnusedThemes()}
              style={[
                styles.action,
                { borderRadius: profile.chrome.control },
                styles.armedButton,
                { backgroundColor: surfaceBackground(theme.colors.danger) },
                removing && styles.pendingAction,
              ]}>
              {removing ? (
                <Spinner size="sm" color={theme.colors.onPrimary} />
              ) : (
                <DeleteIcon size={15} color={theme.colors.onPrimary} />
              )}
              {/* Semibold through the prop, for the Android reason spelled out at
                the Clear button above. */}
              <Text variant="caption" weight="semibold" color={theme.colors.onPrimary}>
                {removing ? <Trans>Removing…</Trans> : <Trans>Remove</Trans>}
              </Text>
            </PressableScale>
            <PressableScale
              accessibilityRole="button"
              accessibilityLabel={t`Keep saved themes`}
              accessibilityState={{ disabled: removing }}
              disabled={removing}
              testID="settings-remove-themes-cancel"
              onPress={() => {
                if (!removing) setArmed(null);
              }}
              style={[
                styles.action,
                { borderRadius: profile.chrome.control },
                styles.armedButton,
                { backgroundColor: surfaceBackground(theme.colors.surfaceRaised) },
                removing && styles.pendingAction,
              ]}>
              <Text variant="caption" color={theme.colors.textMuted}>
                <Trans>Cancel</Trans>
              </Text>
            </PressableScale>
          </View>
        ) : (
          // `Palette` is the glyph the theme drop already wears, so the two
          // places in the app that talk about themes carry the same mark.
          <SettingsNavRow
            icon={AppearanceIcon}
            trailing={NextIcon}
            label={t`Remove unused themes`}
            detail={themesDetail}
            disabled={!unused || unused.count === 0}
            testID="settings-remove-themes-row"
            onPress={() => setArmed('themes')}
          />
        )}
      </StorageActionTransition>
    </SettingsCard>
  );
}

const styles = StyleSheet.create({
  retainedHint: {
    paddingHorizontal: LADDER.gutter,
    paddingVertical: LADDER.gap,
  },
  // The same measurements the servers section's own two-tap control uses, so
  // the armed pair reads as one control the app has rather than two.
  armedRow: {
    flexDirection: 'row',
    gap: LADDER.gap,
    paddingHorizontal: LADDER.gutter,
  },
  action: {
    minHeight: 44,
    paddingHorizontal: LADDER.snug,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: LADDER.gap,
  },
  armedButton: { flex: 1 },
  pendingAction: { opacity: 0.7 },
});

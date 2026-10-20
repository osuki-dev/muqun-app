import { useEffect, useMemo, useRef, useState } from 'react';

import { isDemoActive } from '@/lib/demo-gateway';
import { DURATION } from '@/lib/motion';
import { holdFor, remainingVisibleMs } from '@/lib/minimum-visible';
import { recoverWith, settleAfter } from '@/lib/compiler-safe-control-flow';
import { throwIfThemeAborted } from '@/theme/abort';
import { prepareThemeAssetStream, type PreparedThemeAssets } from '@/theme/assets';
import { demoThemeIndex } from '@/theme/demo-gallery';
import type { ThemeEditorCandidate } from '@/theme/draft-session';
import {
  loadThemeIndex,
  themePackageUrl,
  themePreviewUrl,
  type ThemeIndexEntry,
} from '@/theme/gallery';
import { cachedThemeIndex, clearThemeIndex, putThemeIndex } from '@/theme/gallery-cache';
import { ThemeImportRequest } from '@/theme/import-request';
import { assetInstallProgress, type ThemeInstallProgress } from '@/theme/install-progress';
import { publicThemeTransport } from '@/theme/public-transport';
import { inspectRemoteTheme } from '@/theme/remote-import';
import { collectPopularThemeTags, filterThemeEntries } from '@/theme/theme-search';

/**
 * The published themes: the index, the search over it, and the one install that
 * may be running.
 *
 * This was the body of the Browse sheet. The catalogue is a tab of the themes
 * sheet now, so the state lives with the sheet rather than with the tab: a
 * reader who starts an install and glances at Mine does not cancel it, and
 * coming back to Gallery does not read the index a second time.
 *
 * Nothing is read until `enabled` first turns true -- the sheet opening on
 * Mine should not cost a request for a tab nobody looked at. The index is read
 * once, from the process cache when it is fresh, and carries everything a card
 * draws. A package is different: the format allows 25 MiB, so a card shows its
 * size and downloads nothing until it is pressed.
 *
 * Cancellation is unchanged from the sheet it came from: one owned request at
 * a time, unmount cancels it, `handoff` is the single ownership boundary, and
 * `finally` disposes whatever did not transfer.
 */

/** Reveal a bounded page near the end; the catalogue index is already cached. */
const THEME_GALLERY_PAGE = 20;

/**
 * How long the pressed state stays up, however fast the work behind it was.
 *
 * Twice `short`: one for the cross-fade that brings the progress in, one for it
 * to be a thing the reader saw rather than a frame they can only find in a
 * recording.
 */
const MINIMUM_PENDING_VISIBLE_MS = DURATION.short * 2;

export type ThemeGallery = ReturnType<typeof useThemeGallery>;

export function useThemeGallery({
  enabled,
  onReady,
}: {
  enabled: boolean;
  onReady: (candidate: ThemeEditorCandidate) => void;
}) {
  const [demo] = useState(isDemoActive);
  const [entries, setEntries] = useState<ThemeIndexEntry[] | null>(() =>
    demo ? demoThemeIndex() : cachedThemeIndex()
  );
  // Whether the index arrived while the reader was waiting for it, rather than
  // being in hand already: the cards that replace the skeletons rise in, a
  // cached catalogue simply appears with its tab.
  const [arrivedLive, setArrivedLive] = useState(false);
  // Latched: once the reader has looked at the gallery, leaving the tab does
  // not stop a read that is under way.
  const [wanted, setWanted] = useState(enabled);
  if (enabled && !wanted) setWanted(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState('');
  const needle = query.trim().replace(/^#/, '').toLowerCase();

  const tags = useMemo(() => (entries ? collectPopularThemeTags(entries, 12) : []), [entries]);
  const filtered = useMemo(
    () => (entries ? filterThemeEntries(entries, query) : null),
    [entries, query]
  );

  const total = filtered?.length ?? 0;
  const [shown, setShown] = useState(() =>
    Math.min(THEME_GALLERY_PAGE, entries?.length ?? THEME_GALLERY_PAGE)
  );
  // Where the page in view began, so an appended page starts its own arrival
  // sequence at zero rather than continuing from twenty.
  const [pageStart, setPageStart] = useState(0);
  const [appending, setAppending] = useState(false);
  const appendInFlight = useRef(false);

  // A new search starts from its first page.
  useEffect(() => {
    setShown(Math.min(THEME_GALLERY_PAGE, filtered?.length ?? THEME_GALLERY_PAGE));
    setPageStart(0);
    appendInFlight.current = false;
    setAppending(false);
  }, [needle, filtered?.length]);

  // Which entry is downloading. An entry, not a boolean: the progress belongs
  // on the card it is for, and a second press elsewhere must not look like it
  // did something.
  const [pending, setPending] = useState<string | null>(null);
  const [progress, setProgress] = useState<ThemeInstallProgress | null>(null);
  // Covers that were requested and did not paint. A card keeps its placeholder
  // rather than a broken picture.
  const [brokenCovers, setBrokenCovers] = useState<readonly string[]>([]);

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
    if (!wanted || entries !== null || demo) return;
    if (!publicThemeTransport) {
      setFailed(true);
      return;
    }
    // Bound once, narrowed: the read below runs in a callback, where the
    // import's null check above would not carry.
    const transport = publicThemeTransport;
    const read = new ThemeImportRequest();
    void (async () => {
      return recoverWith(
        async () => {
          const list = await loadThemeIndex(transport, read.signal);
          if (!mounted.current || read.isCanceled) return;
          putThemeIndex(list);
          setArrivedLive(true);
          setEntries(list);
          setShown(Math.min(THEME_GALLERY_PAGE, list.length));
        },
        () => {
          // The thrown message is a plain English module string and is in no
          // catalog; the tab says the translated failure instead.
          if (mounted.current && !read.isCanceled) setFailed(true);
        }
      );
    })();
    return () => read.cancel();
    // `attempt` is what Retry bumps; `entries` is the guard that stops a
    // re-read of a catalogue already in hand.
  }, [wanted, attempt, entries, demo]);

  // The appended page is on screen once the commit carrying it has run, which
  // is what ends the footer's spinner.
  useEffect(() => {
    appendInFlight.current = false;
    if (appending) setAppending(false);
    // Only the arrival of a new page ends it.
    // oxlint-disable-next-line react/exhaustive-deps -- `appending` is the flag being cleared, not an input
  }, [shown]);

  function retry() {
    clearThemeIndex();
    setFailed(false);
    setEntries(null);
    setQuery('');
    setShown(THEME_GALLERY_PAGE);
    setPageStart(0);
    setAttempt((value) => value + 1);
  }

  function install(entry: ThemeIndexEntry) {
    if (demo || !publicThemeTransport || active.current) return;
    const transport = publicThemeTransport;
    const owned = new ThemeImportRequest();
    active.current = owned;
    // Synchronously, before anything is awaited, so the render that shows the
    // acknowledgement is already scheduled when this function returns.
    setPending(entry.id);
    setProgress({ phase: 'downloading' });
    setFailed(false);
    const pressedAt = Date.now();
    void (async () => {
      const { signal } = owned;
      let prepared: PreparedThemeAssets | undefined;
      let transferred = false;
      return settleAfter(
        async () => {
          try {
            // `format: 'package'` because a catalogue entry is always a packed
            // `.muqun-theme`: its assets come out of the archive, so there are
            // no third-party domains for a reader to review.
            const inspection = await inspectRemoteTheme(transport, themePackageUrl(entry), {
              signal,
              format: 'package',
              onProgress(value) {
                if (mounted.current && !signal.aborted) setProgress(value);
              },
            });
            throwIfThemeAborted(signal);
            prepared = await prepareThemeAssetStream(
              inspection.manifest,
              inspection.assets(signal),
              {
                signal,
                onProgress(value) {
                  if (mounted.current && !signal.aborted) setProgress(assetInstallProgress(value));
                },
              }
            );
            throwIfThemeAborted(signal);
            // A download that beat its own announcement leaves the announcement
            // up for the rest of its welcome rather than flashing through it.
            await holdFor(remainingVisibleMs(pressedAt, MINIMUM_PENDING_VISIBLE_MS));
            throwIfThemeAborted(signal);
            if (!mounted.current) return;
            const candidate = { manifest: inspection.manifest, prepared };
            owned.handoff(() => onReady(candidate));
            transferred = true;
          } catch {
            if (mounted.current && active.current === owned && !owned.isCanceled) setFailed(true);
          }
        },
        () => {
          if (!transferred) prepared?.dispose();
          if (active.current === owned) active.current = null;
          if (mounted.current) {
            setPending(null);
            setProgress(null);
          }
        }
      );
    })();
  }

  function appendPage() {
    if (!filtered || shown >= total || pending !== null || failed || appendInFlight.current) return;
    appendInFlight.current = true;
    setAppending(true);
    setPageStart(shown);
    setShown(Math.min(shown + THEME_GALLERY_PAGE, total));
  }

  const broken = new Set(brokenCovers);
  function coverOf(entry: ThemeIndexEntry): string | null {
    if (demo || broken.has(entry.id)) return null;
    return themePreviewUrl(entry);
  }

  function markCoverBroken(id: string) {
    setBrokenCovers((value) => (value.includes(id) ? value : [...value, id]));
  }

  return {
    demo,
    entries,
    arrivedLive,
    failed,
    query,
    needle,
    setQuery,
    tags,
    filtered,
    visible: filtered ? filtered.slice(0, shown) : [],
    shown,
    total,
    pageStart,
    appending,
    appendPage,
    pending,
    progress,
    brokenCount: brokenCovers.length,
    coverOf,
    markCoverBroken,
    install,
    retry,
  };
}

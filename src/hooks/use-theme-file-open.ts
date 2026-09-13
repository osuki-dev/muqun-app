import { useEffect, useSyncExternalStore } from 'react';
import * as Linking from 'expo-linking';
import { useLingui } from '@lingui/react/macro';
import { useToast } from '@osuki-dev/ui';

import { useOpenThemeEditor } from '@/hooks/use-open-theme-editor';
import { readThemeFile, type ThemeFileStage } from '@/theme/local-files';

/**
 * Whether a file handed to the app from outside is being read right now.
 *
 * The router cannot match a `file://` or `content://` URL against any route, so
 * `+not-found` is what the reader is looking at for the whole of that read --
 * and on a pack with artwork that is not instant: a 4 MB archive has to be
 * unpacked and every image staged before the editor can open over it. Ten
 * seconds of "This link goes nowhere" in front of a file the app is in the
 * middle of opening successfully is not a slow screen, it is a wrong one.
 *
 * A module-level flag rather than state in a provider, because the screen that
 * needs to read it (`+not-found`) is mounted by the router, not by this hook,
 * and the two never meet in the tree.
 */
let handedFileStage: ThemeFileStage | null = null;
const handedFileListeners = new Set<() => void>();
function setHandedFileStage(value: ThemeFileStage | null) {
  handedFileStage = value;
  for (const listener of handedFileListeners) listener();
}
/** The stage a handed file is at, or `null` when nothing is being read. */
export function useHandedFileStage(): ThemeFileStage | null {
  return useSyncExternalStore(
    (listener) => {
      handedFileListeners.add(listener);
      return () => handedFileListeners.delete(listener);
    },
    () => handedFileStage,
    () => null
  );
}

/**
 * What the app was handed.
 *
 * iOS delivers `file://` with the name in the path. Android delivers
 * `content://`, whose path is an opaque provider id with no filename in it at
 * all -- so a name is checked when there is one and the bytes decide otherwise.
 * `readThemeFile` reads the form from the first bytes for exactly this reason.
 */
const THEME_FILE = /\.muqun-theme(\.json)?$/i;

/**
 * A theme handed to the app from outside it.
 *
 * The app declares `dev.osuki.muqun.theme`, so Mail, AirDrop, Files and every
 * share sheet can hand a pack straight to it. What arrives is a `file://` URL,
 * which the router cannot match against any route -- so it is read here instead
 * and opened in the ordinary preview, where the reader applies it or does not.
 *
 * It never installs anything on its own. A file from a message is exactly as
 * unreviewed as a file from the picker, and it goes through the same
 * `readThemeFile`: the same size ceilings, the same strict validation.
 */
export function useThemeFileOpen(): void {
  const openThemeEditor = useOpenThemeEditor();
  const { showToast } = useToast();
  const { t } = useLingui();
  useEffect(() => {
    let cancelled = false;
    async function accept(url: string | null) {
      if (cancelled || !url) return;
      const handed = url.startsWith('file://') || url.startsWith('content://');
      if (!handed) return;
      // Before the first `await`, so `+not-found` never paints its verdict on a
      // file this is already reading.
      setHandedFileStage({ phase: 'reading' });
      try {
        // Inside the try because this is the first thing done to a string any
        // app on the device can hand over: malformed percent-encoding makes
        // `decodeURIComponent` throw, and out here that was an unhandled
        // rejection triggerable by sending `%zz.muqun-theme`.
        const name = decodeURIComponent(url.split('/').pop() ?? '');
        // A named file must look like a theme; an unnamed one is judged by its
        // bytes. Refusing every `content://` that does not spell out an
        // extension would mean Android could never open a theme at all.
        if (name.includes('.') && !THEME_FILE.test(name)) {
          showToast({ variant: 'danger', message: t`That file is not a Muqun theme` });
          return;
        }
        const preview = await readThemeFile(url, name || undefined, undefined, setHandedFileStage);
        if (cancelled) {
          preview.prepared?.dispose();
          return;
        }
        // Inside the try on purpose: the handoff can refuse when too many
        // previews are already open, and a refusal is not worth a crash on a
        // file the reader opened from another app.
        openThemeEditor(preview, true);
      } catch (failure) {
        // Say so. This used to swallow, on the reasoning that the file came
        // from another app and there was no screen of ours to report it on --
        // but the router cannot match a `file://` or `content://` URL either,
        // so what the reader is actually left looking at is `+not-found`
        // telling them the link points nowhere. It pointed at a file they
        // chose. Every failure here looked exactly like every other one, which
        // is what made the Android hand-off impossible to tell apart from a
        // missing intent filter.
        showToast({
          variant: 'danger',
          message: failure instanceof Error ? failure.message : t`Could not open that theme`,
        });
      } finally {
        // Whatever happened, the wait is over: either the editor is on top of
        // `+not-found` or a toast has said why it is not, and in both cases
        // that screen should go back to being honest about the URL it holds.
        setHandedFileStage(null);
      }
    }
    // The launch case and the running case are the same case.
    void Linking.getInitialURL().then(accept);
    const subscription = Linking.addEventListener('url', (event) => void accept(event.url));
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [openThemeEditor, showToast, t]);
}

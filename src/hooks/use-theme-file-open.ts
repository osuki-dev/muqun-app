import { useEffect } from 'react';
import * as Linking from 'expo-linking';

import { useOpenThemeEditor } from '@/hooks/use-open-theme-editor';
import { readThemeFile } from '@/theme/local-files';

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
  useEffect(() => {
    let cancelled = false;
    async function accept(url: string | null) {
      if (cancelled || !url) return;
      const handed = url.startsWith('file://') || url.startsWith('content://');
      if (!handed) return;
      try {
        // Inside the try because this is the first thing done to a string any
        // app on the device can hand over: malformed percent-encoding makes
        // `decodeURIComponent` throw, and out here that was an unhandled
        // rejection triggerable by sending `%zz.muqun-theme`.
        const name = decodeURIComponent(url.split('/').pop() ?? '');
        // A named file must look like a theme; an unnamed one is judged by its
        // bytes. Refusing every `content://` that does not spell out an
        // extension would mean Android could never open a theme at all.
        if (name.includes('.') && !THEME_FILE.test(name)) return;
        const preview = await readThemeFile(url, name || undefined);
        if (cancelled) {
          preview.prepared?.dispose();
          return;
        }
        // Inside the try on purpose: the handoff can refuse when too many
        // previews are already open, and a refusal is not worth a crash on a
        // file the reader opened from another app.
        openThemeEditor(preview);
      } catch {
        // A file that is not a theme, or one that fails its limits, is simply
        // not opened. The reader picked it from somewhere else entirely, so
        // there is no screen of ours to report it on.
      }
    }
    // The launch case and the running case are the same case.
    void Linking.getInitialURL().then(accept);
    const subscription = Linking.addEventListener('url', (event) => void accept(event.url));
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [openThemeEditor]);
}

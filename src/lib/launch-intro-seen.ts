import { createMMKV } from 'react-native-mmkv';

/**
 * Whether the launch intro -- the three pages that explain the app on its
 * first run -- has been seen on this install.
 *
 * Read synchronously and at module scope by the launch overlay, on purpose:
 * the overlay is the first React frame, and the decision "intro or brand
 * animation" has to be there for that frame. MMKV is a synchronous read, the
 * same reason the theme library hydrates at module scope in `_layout.tsx`.
 *
 * Versioned rather than boolean. A future intro that says something new can
 * bump {@link LAUNCH_INTRO_VERSION} and be shown again to everyone; a reader
 * who saw version 1 has not seen version 2.
 *
 * MMKV is a native module, and an over-the-air update can reach a binary built
 * before it was added, so creating the store there throws. The in-memory
 * fallback is `theme-tab-preference.ts`'s, for the same reason: the intro
 * simply shows again until the native binary catches up, which is a feature
 * degrading rather than a crash.
 */
type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const STORE_ID = 'muqun.launch';
const STORAGE_KEY = 'muqun.launch-intro.seen';

/** Bump when the intro's content changes enough that returning readers should see it. */
export const LAUNCH_INTRO_VERSION = 2;

function openStore(): KeyValueStore {
  try {
    return createMMKV({ id: STORE_ID });
  } catch {
    const memory = new Map<string, string>();
    return {
      getString: (key) => memory.get(key),
      set: (key, value) => {
        memory.set(key, value);
      },
    };
  }
}

let storageInstance: KeyValueStore | null = null;
function store(): KeyValueStore {
  if (!storageInstance) storageInstance = openStore();
  return storageInstance;
}

/** Pure, so the rule can be tested without a store: seen means seen at this version or later. */
export function launchIntroSeenAt(
  stored: string | undefined,
  version = LAUNCH_INTRO_VERSION
): boolean {
  const seen = Number(stored);
  return Number.isFinite(seen) && seen >= version;
}

export function hasSeenLaunchIntro(): boolean {
  try {
    return launchIntroSeenAt(store().getString(STORAGE_KEY));
  } catch {
    return false;
  }
}

/** Swallows its own failure: an intro shown twice is not worth an error. */
export function markLaunchIntroSeen(): void {
  try {
    store().set(STORAGE_KEY, String(LAUNCH_INTRO_VERSION));
  } catch {
    // See above.
  }
}

/** Test seam: forget the process-wide store. */
export function resetLaunchIntroStoreForTesting(): void {
  storageInstance = null;
}

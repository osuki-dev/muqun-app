import { createMMKV } from 'react-native-mmkv';

/**
 * Which half of the theme sheet a reader was last looking at.
 *
 * The sheet asks two questions -- "which of the packs that ship with the app?"
 * and "which of the themes I installed?" -- and a reader who has installed
 * themes is almost always coming back for the second one. Remembering the
 * answer is the difference between opening the sheet and opening the sheet and
 * then finding your way back to where you were.
 *
 * MMKV is a native module, and an over-the-air update can reach a binary built
 * before it was added, so creating the store there throws. The in-memory
 * fallback is `shortcut-usage.ts`'s, for the same reason: a remembered tab
 * simply stops surviving a launch until the native binary catches up, which is
 * a feature degrading rather than a crash.
 */
type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const STORE_ID = 'muqun.theme-ui';
const STORAGE_KEY = 'muqun.theme-tab.v1';

export type ThemeTab = 'mine' | 'builtin';

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

/**
 * `null` when nothing is stored, and also when what is stored is not a tab this
 * build has: a future third tab that is later removed must not strand a reader
 * on a screen that no longer exists.
 */
export function loadThemeTab(): ThemeTab | null {
  try {
    const value = store().getString(STORAGE_KEY);
    return value === 'mine' || value === 'builtin' ? value : null;
  } catch {
    return null;
  }
}

/** Swallows its own failure. A remembered tab is not worth an error. */
export function saveThemeTab(tab: ThemeTab): void {
  try {
    store().set(STORAGE_KEY, tab);
  } catch {
    // See above.
  }
}

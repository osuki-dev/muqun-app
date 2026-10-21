import { createMMKV } from 'react-native-mmkv';

/**
 * Whether the Stage's first-visit hints ("Tap · start a new task", "Tap ·
 * open") have been seen on this install. A first-run flag kept the way
 * `launch-intro-seen.ts` keeps its own: MMKV, read synchronously, with an
 * in-memory fallback for an over-the-air update on a binary without MMKV
 * (the hints then show once per launch, which is a feature degrading, not a
 * crash).
 */
type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

const STORE_ID = 'muqun.launch';
const STORAGE_KEY = 'muqun.home-stage.hints.seen';

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

export function hasSeenStageHints(): boolean {
  try {
    return store().getString(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Swallows its own failure: a hint shown twice is not worth an error. */
export function markStageHintsSeen(): void {
  try {
    store().set(STORAGE_KEY, '1');
  } catch {
    // See above.
  }
}

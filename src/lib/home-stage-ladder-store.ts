import { createMMKV } from 'react-native-mmkv';

import type { SavedStageLadder } from '@/lib/home-stage-motion';

/**
 * The Stage's quality rung and strikes (`StageLadder`), kept across launches
 * so a launch tries one rung up from where the last session settled instead
 * of starting over at `full`. An over-the-air update can reach a binary
 * without MMKV: then nothing is kept and every launch starts at `full`.
 */
const STORE_ID = 'muqun.home-stage';
const STORAGE_KEY = 'muqun.home-stage.ladder';

type KeyValueStore = {
  getString: (key: string) => string | undefined;
  set: (key: string, value: string) => void;
};

let storageInstance: KeyValueStore | null | undefined;
function store(): KeyValueStore | null {
  if (storageInstance !== undefined) return storageInstance;
  try {
    storageInstance = createMMKV({ id: STORE_ID });
  } catch {
    storageInstance = null;
  }
  return storageInstance;
}

/** The saved ladder, unparsed: `startStageLadder` validates it. */
export function loadStageLadder(): unknown {
  try {
    const raw = store()?.getString(STORAGE_KEY);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

export function saveStageLadder({ settled, strikes, lastDropAt }: SavedStageLadder): void {
  try {
    store()?.set(STORAGE_KEY, JSON.stringify({ settled, strikes, lastDropAt }));
  } catch {
    // Kept for this session only.
  }
}

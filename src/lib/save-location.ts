import { Directory } from 'expo-file-system';
import { createMMKV } from 'react-native-mmkv';

/**
 * The folder Android saves files into, picked once and then reused.
 *
 * Android 11+ refuses the Download folder itself and the storage root in the
 * folder picker, so the reader picks (or creates) a folder such as
 * Download/muqun once. The picker takes a persistable grant on that tree, so
 * the same URI keeps working across launches until the folder is deleted or
 * the grant is revoked; a failed write forgets it and asks again.
 */
const KEY = 'android-save-directory';
const store = createMMKV({ id: 'muqun.save-location' });
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function savedDirectoryUri(): string | undefined {
  return store.getString(KEY);
}

export function forgetSaveDirectory() {
  store.remove(KEY);
  emit();
}

/** Open the system folder picker, starting at the current folder, and remember the pick. */
export async function pickSaveDirectory(): Promise<Directory> {
  const picked = await Directory.pickDirectoryAsync(savedDirectoryUri());
  store.set(KEY, picked.uri);
  emit();
  return picked;
}

export function subscribeSaveDirectory(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** "muqun" for content://…/tree/primary%3ADownload%2Fmuqun. */
export function saveDirectoryName(uri: string): string {
  const tree = decodeURIComponent(uri.split('/tree/').pop() ?? uri);
  return tree.split(/[:/]/).filter(Boolean).pop() ?? tree;
}

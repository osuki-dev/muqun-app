import { Directory, File, Paths } from 'expo-file-system';
import appStorage from '../../modules/app-storage/src/MuqunAppStorageModule';
import { LAUNCH_PURGE_DIRECTORIES, LAUNCH_PURGE_MARKER, TRASH_PREFIX } from './cache-storage';

/**
 * Library caches that keep an open journal cannot be deleted while the app
 * runs, but the Markdown renderer's opens lazily, on the first remote image.
 * So Clear cache leaves a marker, and the next process moves those caches
 * aside here, before any screen renders. The move is one rename; the files
 * are deleted later, off the launch path, as ordinary temporary entries.
 *
 * Only the first JavaScript context of a process does this: after a reload in
 * the same process the libraries may already hold their caches open. Builds
 * without the native module never purge, and keep the marker for one that can.
 */
function purgeLibraryCachesAtLaunch(): void {
  try {
    if (!appStorage?.claimProcessLaunch()) return;
    const marker = new File(Paths.cache, LAUNCH_PURGE_MARKER);
    if (!marker.exists) return;
    for (const name of LAUNCH_PURGE_DIRECTORIES) {
      const directory = new Directory(Paths.cache, name);
      if (directory.exists) directory.rename(`${TRASH_PREFIX}${Date.now()}-${name}`);
    }
    marker.delete();
  } catch {
    // A cache that could not be moved is tried again next launch.
  }
}

/** Ask the next launch to purge the caches only it can safely remove. */
export function requestLaunchCachePurge(): void {
  try {
    const marker = new File(Paths.cache, LAUNCH_PURGE_MARKER);
    if (!marker.exists) marker.create();
  } catch {
    // Without the marker the library cache simply stays until the next Clear.
  }
}

purgeLibraryCachesAtLaunch();

import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import QuickCrypto from 'react-native-quick-crypto';

import { parseThemeManifest, THEME_LIMITS, type ThemeManifest } from '@/theme/schema';
import { unpackTheme } from '@/theme/package';
import { prepareThemeAssets, type PreparedThemeAssets } from '@/theme/assets';
import { createThemeFileSharer } from '@/theme/file-sharing';

const shareFile = createThemeFileSharer({
  available: Sharing.isAvailableAsync,
  create(name, data) {
    const directory = new Directory(
      Paths.cache,
      `theme-export-${QuickCrypto.randomBytes(12).toString('hex')}`
    );
    directory.create();
    try {
      const file = new File(directory, name);
      file.create();
      file.write(data);
      return { uri: file.uri, dispose: () => directory.delete() };
    } catch (error) {
      try {
        directory.delete();
      } catch {
        // Do not replace the useful write failure with cache-cleanup failure.
      }
      throw error;
    }
  },
  share: (uri, packaged) =>
    Sharing.shareAsync(uri, {
      mimeType: packaged ? 'application/vnd.muqun.theme' : 'application/json',
      // The app declares `dev.osuki.muqun.theme` and owns the extension, so a
      // shared pack says what it is rather than making every ordinary ZIP a
      // candidate for Muqun on the receiving device.
      UTI: packaged ? 'dev.osuki.muqun.theme' : 'public.json',
    }),
});

export type ThemeFilePreview = { manifest: ThemeManifest; prepared?: PreparedThemeAssets };

/** Where a local read has got to. `staging` is the only countable phase. */
export type ThemeFileStage =
  | { phase: 'reading' }
  | { phase: 'unpacking' }
  | { phase: 'staging'; completed: number; total: number };

/** Explicit user selection only; no clipboard inspection or network requests. */
export async function pickThemeManifest(
  onStage?: (stage: ThemeFileStage) => void
): Promise<ThemeFilePreview | null> {
  const result = await DocumentPicker.getDocumentAsync({
    // Providers do not consistently classify our custom extension. Let the user
    // select it, then enforce byte limits and strict JSON/ZIP validation below.
    type: '*/*',
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  return readThemeFile(asset.uri, asset.name, asset.size, onStage);
}

/** Enough of the head to recognise a signature, and not one byte more. */
async function firstBytes(file: File, count: number): Promise<Uint8Array> {
  const reader = file.readableStream().getReader();
  try {
    const head = new Uint8Array(count);
    let filled = 0;
    while (filled < count) {
      const { value, done } = await reader.read();
      if (done) break;
      const take = Math.min(count - filled, value.length);
      head.set(value.subarray(0, take), filled);
      filled += take;
    }
    return head.subarray(0, filled);
  } finally {
    await reader.cancel();
  }
}

/** The local file header every ZIP begins with, and a packaged theme is a ZIP. */
function isZipArchive(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/**
 * A theme file the reader has chosen, wherever they chose it.
 *
 * The picker is one way in; a file handed to the app from Mail, AirDrop or the
 * Files app is another, and both must apply the same limits and the same strict
 * validation. Lifting this out of the picker is what keeps the second route
 * from quietly becoming a laxer one.
 */
export async function readThemeFile(
  uri: string,
  /** The picker knows it; an Android `content://` hand-off often does not. */
  name?: string,
  reportedSize?: number,
  /**
   * What the wait is doing, for a caller that has somewhere to say it.
   *
   * This read is the slowest thing in any import and it used to be the only
   * one with nothing to show: a 4 MB pack is a read, a validated unpack, and
   * ten images decoded and written, which is about ten seconds on a phone with
   * an empty screen in front of it. `reading` and `unpacking` are single
   * opaque waits and say only their name; `staging` is countable and carries
   * the asset counter the stream already keeps.
   */
  onStage?: (stage: ThemeFileStage) => void
): Promise<ThemeFilePreview> {
  const file = new File(uri);
  try {
    // A name is a hint and the bytes are the fact. Android hands over a
    // `content://` URI whose path carries no filename at all, so deciding the
    // form by extension alone would work on one platform and quietly fail on
    // the other. Read the first bytes and ask them instead.
    //
    // Only the signature is read first, and the form it names decides the
    // ceiling for reading the rest. Reading everything and rejecting afterwards
    // would let anything that can hand this app a file pull 25 MiB into memory
    // before being told no -- and since the document type went live, that is
    // any app on the device, not just the picker.
    onStage?.({ phase: 'reading' });
    if (reportedSize !== undefined && reportedSize > THEME_LIMITS.packageBytes)
      throw new Error('Theme file exceeds the import size limit');
    if (!file.exists || file.size > THEME_LIMITS.packageBytes)
      throw new Error('Theme file is unavailable or exceeds the import size limit');
    const packaged = isZipArchive(await firstBytes(file, 4));
    if (file.size > (packaged ? THEME_LIMITS.packageBytes : THEME_LIMITS.manifestBytes))
      throw new Error('Theme file exceeds the import size limit');
    const bytes = await file.bytes();
    if (packaged) {
      onStage?.({ phase: 'unpacking' });
      const theme = unpackTheme(bytes);
      const prepared = await prepareThemeAssets(theme, {
        onProgress: ({ completedAssets, totalAssets }) =>
          onStage?.({ phase: 'staging', completed: completedAssets, total: totalAssets }),
      });
      return { manifest: theme.manifest, prepared };
    }
    return {
      manifest: parseThemeManifest(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    };
  } finally {
    // Expo owns this freshly made copy. Never delete the original selected file.
    const pickerCache = new Directory(Paths.cache, 'DocumentPicker').uri + '/';
    if (file.uri.startsWith(pickerCache)) {
      try {
        if (file.exists) file.delete();
      } catch {
        /* OS cache eviction remains available. */
      }
    }
  }
}

/** Export only theme data. The platform share sheet controls its destination. */
export async function shareThemeColors(text: string): Promise<void> {
  const manifest = parseThemeManifest(text);
  await shareThemeFile(`${manifest.id}.muqun-theme.json`, JSON.stringify(manifest, null, 2), false);
}

export async function shareThemeFile(
  name: string,
  data: string | Uint8Array,
  packaged: boolean
): Promise<void> {
  if (!/^[a-z][a-z0-9-]*\.muqun-theme(?:\.json)?$/.test(name))
    throw new Error('Invalid theme export filename');
  const size = typeof data === 'string' ? new TextEncoder().encode(data).length : data.length;
  if (size > (packaged ? THEME_LIMITS.packageBytes : THEME_LIMITS.manifestBytes))
    throw new Error('Theme export exceeds the size limit');
  await shareFile({ name, data, packaged });
}

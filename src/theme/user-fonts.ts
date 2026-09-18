/**
 * Reader-supplied fonts: acquiring one, checking it, keeping it, registering it.
 *
 * The whole feature in one sentence: the app ships no fonts and offers no list,
 * a reader pastes a URL or picks a file, the bytes are copied *once* into the
 * documents directory, and every launch from then on registers the face from
 * that local file. Nothing is re-fetched. A reader who changes the URL or
 * removes the font is the only thing that makes this module touch the network
 * or the disk again.
 *
 * Why the documents directory and not the cache: `Paths.cache` is a place the
 * system is entitled to empty when the phone is short of space, and a font that
 * disappears on a Tuesday takes the whole app's typography with it. This is
 * also why `Font.loadAsync({ uri: 'https://...' })` is not used directly --
 * expo-asset lands a remote source in the cache directory
 * (`AssetModule.kt:90-93`), which is exactly the eviction this avoids. The URL
 * is downloaded here, deliberately, to a place that survives.
 *
 * Why every write goes through a `.part` file: Android streams a download
 * straight into the destination and can leave a partial file behind when the
 * connection drops mid-transfer (iOS moves a completed temporary file into
 * place and cannot). A half-written font that passed no check is the worst
 * possible thing to have at the path the launch registration reads, so the
 * bytes land under a name nothing looks for, are checked there, and are moved
 * into place only once they have passed. The move is a rename inside one
 * directory, which both platforms do atomically.
 *
 * The pure half of all this -- the signature sniff, the size cap, the label,
 * the path rules, the advance arithmetic -- is in `user-font-file.ts` so it can
 * be tested without a device, and is re-exported here so a caller has one
 * import.
 */
import { Skia } from '@shopify/react-native-skia';
import { Directory, File, Paths } from 'expo-file-system';
import * as Font from 'expo-font';
import QuickCrypto from 'react-native-quick-crypto';

import {
  checkFontSize,
  downloadStatusFrom,
  fontAdvanceProfile,
  isUserFontRelativePath,
  joinDocumentUri,
  isSupportedFontFormat,
  MONO_PROBE_CHARACTERS,
  sniffFontFormat,
  USER_FONT_ALIAS,
  USER_FONT_DIRECTORY,
  USER_FONT_SNIFF_BYTES,
  UserFontError,
  userFontLabel,
  userFontRelativePath,
  type FontAdvanceProfile,
  type FontSlot,
  type FontSlotId,
  type UserFontProblem,
} from '@/theme/user-font-file';

export * from '@/theme/user-font-file';

/** A slot that has a file behind it, which is the only kind this module makes. */
export type InstalledFontSlot = Extract<FontSlot, { kind: 'file' }>;

/**
 * The size the advance probe measures at.
 *
 * Large, and it costs nothing -- the face is loaded either way and this is one
 * `getGlyphWidths` call on four glyphs. A big em means the ratio is read off
 * four numbers in the hundreds rather than four in the single digits, so the
 * monospace verdict is not decided by the last bit of a float.
 */
const PROBE_FONT_SIZE = 100;

/** How much of a download has arrived, as a fraction, or `null` when unknown. */
export type FontDownloadProgress = { fraction: number | null; bytesWritten: number };

/** The fonts directory, created if this is the first font the reader has added. */
function fontsDirectory(): Directory {
  const directory = new Directory(Paths.document, USER_FONT_DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

/** A name nothing reads, for bytes that have not been checked yet. */
function stagingFile(slot: FontSlotId): File {
  return new File(fontsDirectory(), `${slot}-${randomToken()}.part`);
}

function randomToken(): string {
  return QuickCrypto.randomBytes(6).toString('hex');
}

/**
 * Enough of the head to recognise a signature, and not one byte more.
 *
 * A stream rather than `file.bytes()`, because `bytes()` reads the whole file
 * into memory and a 20 MB CJK face has no business being resident to answer a
 * four-byte question. The same shape `theme/local-files.ts` uses to recognise a
 * theme package.
 */
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
    await reader.cancel().catch(() => {
      // The read is over either way; a cancel that fails changes nothing.
    });
  }
}

/** Removes a staging file, and never turns a useful failure into a cleanup one. */
function discard(file: File): void {
  try {
    if (file.exists) file.delete();
  } catch {
    // The original rejection is what the reader needs to see.
  }
}

/**
 * Whether Skia can build a face out of these bytes, and what it advances.
 *
 * The signature sniff says the file *claims* to be an sfnt; this says whether it
 * really is one. A truncated download, a face with broken tables and an HTML
 * page that happens to start with the right four bytes all get through the
 * sniff and all fail here -- which matters more than usual, because the terminal
 * draws with the Skia typeface directly and a null face there is a blank
 * terminal rather than a caught error.
 *
 * The measurement comes off the same face for the same reason: opening a 20 MB
 * font twice to ask it two questions is a second 20 MB read for nothing.
 */
async function probeFont(uri: string): Promise<FontAdvanceProfile | null> {
  const data = await Skia.Data.fromURI(uri);
  const typeface = Skia.Typeface.MakeFreeTypeFaceFromData(data);
  if (!typeface) throw new UserFontError({ kind: 'unreadable' });
  const font = Skia.Font(typeface, PROBE_FONT_SIZE);
  // The same rule the terminal measures its cell under. An SkFont reports
  // advances hinted to a whole point unless this is on, and a ratio measured
  // hinted here would disagree with the cell width measured linear there --
  // which is the PTY opening one column wide of the grid it is drawn on.
  font.setLinearMetrics(true);
  const ids = font.getGlyphIDs(MONO_PROBE_CHARACTERS);
  // A face with no glyph for one of the four has not failed; it simply cannot
  // be measured this way, and an unmeasured slot falls back to the bundled
  // font's ratio rather than to a number made up from three characters.
  if (ids.length !== MONO_PROBE_CHARACTERS.length || ids.some((id) => id === 0)) return null;
  return fontAdvanceProfile(font.getGlyphWidths(ids), PROBE_FONT_SIZE);
}

/**
 * Check the staged bytes, move them into place, and describe the result.
 *
 * The one path every acquisition ends in, so a URL and a picked file cannot
 * drift apart in what they accept. The order is deliberate: the cheapest check
 * that can reject first (size, then four bytes, then the full parse), so a
 * reader who pasted a link to a video does not wait for Skia to read 200 MB
 * before being told it is not a font.
 */
async function acceptStagedFont(
  staged: File,
  slot: FontSlotId,
  source: string,
  previous: FontSlot | undefined
): Promise<InstalledFontSlot> {
  try {
    const sizeProblem = checkFontSize(staged.size);
    if (sizeProblem) throw new UserFontError(sizeProblem);

    const format = sniffFontFormat(await firstBytes(staged, USER_FONT_SNIFF_BYTES));
    if (!isSupportedFontFormat(format)) throw new UserFontError({ kind: 'format', format });

    // Measured for both slots, stored for both: the interface slot has no use
    // for the ratio today, and a face that Skia cannot open is no more welcome
    // there than in the terminal.
    const profile = await probeFont(staged.uri);

    const relative = userFontRelativePath(slot, randomToken(), format);
    const destination = new File(Paths.document, relative);
    // The rename. Inside one directory on one volume, so it is atomic on both
    // platforms: at no instant is there a file at the registered path that is
    // anything other than the whole, checked font.
    staged.move(destination);

    // Only now, with the new face in place, does the old one go. A slot is
    // never briefly empty, and a failure above leaves the reader with the font
    // they already had rather than with nothing.
    removeUserFontFile(previous);

    return {
      kind: 'file',
      source,
      file: relative,
      label: userFontLabel(source) ?? slot,
      ...(profile ? { advanceRatio: profile.advanceRatio, isMonospace: profile.isMonospace } : {}),
    };
  } catch (error) {
    discard(staged);
    throw error;
  }
}

/**
 * Download a font from a URL and install it into a slot.
 *
 * `signal` is the reader leaving the sheet or pressing the row again; the
 * native download is cancelled, the staging file is removed, and the slot is
 * untouched. `onProgress` is what the row draws while it waits -- a fraction
 * where the server sent a `Content-Length` and `null` where it did not, which
 * is the difference between a bar and a spinner and is not something the row
 * should have to work out from `-1`.
 */
export async function downloadUserFont({
  slot,
  url,
  previous,
  signal,
  onProgress,
}: {
  slot: FontSlotId;
  url: string;
  previous?: FontSlot;
  signal?: AbortSignal;
  onProgress?: (progress: FontDownloadProgress) => void;
}): Promise<InstalledFontSlot> {
  const staged = stagingFile(slot);
  let downloaded: File;
  try {
    downloaded = await File.downloadFileAsync(url.trim(), staged, {
      // The staging name carries a fresh token every time, so there is nothing
      // to overwrite -- but a retry after a crash could find one, and failing
      // the download over a stale temporary file would be the app blaming the
      // reader for its own leftovers.
      idempotent: true,
      signal,
      onProgress: onProgress
        ? ({ bytesWritten, totalBytes }) =>
            onProgress({
              fraction: totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : null,
              bytesWritten,
            })
        : undefined,
    });
  } catch (error) {
    discard(staged);
    if (signal?.aborted) throw new UserFontError({ kind: 'cancelled' });
    throw downloadError(error);
  }
  return acceptStagedFont(downloaded, slot, url.trim(), previous);
}

/**
 * The download failure, as something the row can put in a sentence.
 *
 * `File.downloadFileAsync` rejects a non-2xx response with an `UnableToDownload`
 * error whose message carries the status, worded differently on each platform.
 * "Could not download: 404" is a sentence a reader can act on; the native text
 * is not, so the number is pulled out and the rest is dropped.
 */
function downloadError(error: unknown): UserFontError {
  if (error instanceof UserFontError) return error;
  const message = error instanceof Error ? error.message : '';
  if (/abort/iu.test(message)) return new UserFontError({ kind: 'cancelled' });
  const status = downloadStatusFrom(message);
  return new UserFontError({ kind: 'download', ...(status === undefined ? {} : { status }) });
}

/**
 * Pick a font from the device and install it into a slot.
 *
 * Resolves `null` when the reader closed the picker, which is not a failure and
 * must not be shown as one.
 *
 * The copy is immediate and is the first thing that happens, because on iOS the
 * picker hands back a *temporary* copy inside the app's inbox and the system is
 * free to reclaim it: reading it later, or storing a path to it, is reading a
 * path to nothing. `copy` into the staging file, then the ordinary checks.
 *
 * `mimeTypes` filters the picker where the platform honours it, and is not
 * trusted afterwards. Providers classify font files inconsistently -- a `.ttf`
 * arrives as `font/ttf`, `application/x-font-ttf` or `application/octet-stream`
 * depending on where it came from -- so the octet-stream catch-all is there to
 * stop the picker greying out the reader's own file, and the four bytes decide.
 */
export async function importUserFont({
  slot,
  previous,
}: {
  slot: FontSlotId;
  previous?: FontSlot;
}): Promise<InstalledFontSlot | null> {
  const picked = await File.pickFileAsync({
    mimeTypes: ['font/ttf', 'font/otf', 'application/x-font-ttf', 'application/octet-stream'],
  });
  if (picked.canceled) return null;
  const source = picked.result;
  const staged = stagingFile(slot);
  try {
    await source.copy(staged);
  } catch (error) {
    discard(staged);
    throw error instanceof UserFontError ? error : new UserFontError({ kind: 'storage' });
  }
  return acceptStagedFont(staged, slot, source.name, previous);
}

/**
 * The absolute URI a slot's stored relative path names right now.
 *
 * "Right now" is the point. `Paths.document` is not the same string across an
 * iOS update -- the container is re-created under a new UUID and every absolute
 * path stored before it is a path to nothing -- so what is persisted is the
 * relative half and the join happens on each launch.
 */
export function userFontUri(slot: FontSlot): string | null {
  if (slot.kind !== 'file' || !isUserFontRelativePath(slot.file)) return null;
  return joinDocumentUri(Paths.document.uri, slot.file);
}

/**
 * Register every file-backed slot under its alias.
 *
 * Called once at launch, before the first frame. What comes back is a problem
 * per slot that could not be registered and nothing for the ones that could, so
 * the caller can degrade exactly the slot that failed.
 *
 * A missing file is reported rather than repaired. The font is gone -- the app
 * was reinstalled, the reader cleared its data, a backup restored the settings
 * without the documents directory -- and the honest answer is a row that says
 * so and a slot drawing in the system font. Re-downloading a URL the reader
 * pasted three months ago, silently, on a launch, is not something an app
 * should do to somebody's data plan.
 *
 * The setting is kept either way. A reader whose font is temporarily
 * unreadable has not asked to stop using it.
 */
export async function registerUserFonts(
  slots: Readonly<Record<FontSlotId, FontSlot>>
): Promise<Partial<Record<FontSlotId, UserFontProblem>>> {
  const problems: Partial<Record<FontSlotId, UserFontProblem>> = {};
  await Promise.all(
    (Object.keys(USER_FONT_ALIAS) as FontSlotId[]).map(async (id) => {
      const slot = slots[id];
      if (slot.kind !== 'file') return;
      const alias = USER_FONT_ALIAS[id];
      // Already registered by an earlier call in this process. `isLoaded` is
      // synchronous, and re-registering is not free on either platform.
      if (Font.isLoaded(alias)) return;
      const uri = userFontUri(slot);
      if (!uri || !new File(uri).exists) {
        problems[id] = { kind: 'storage' };
        return;
      }
      try {
        await Font.loadAsync({ [alias]: { uri } });
      } catch {
        problems[id] = { kind: 'unreadable' };
      }
    })
  );
  return problems;
}

/**
 * Throw a slot's file away.
 *
 * Only the file. The registration cannot be undone -- neither platform has a
 * usable unregister, and `Font.unloadAsync` is documented as a testing hook --
 * so the alias stays bound to the outgoing face for the rest of the process and
 * the app stops *referring* to it instead. Which is why every consumer reads
 * `slotFontFamily(slot, id)` rather than the alias constant: the moment the
 * slot says `system`, nothing names the alias and the face is unreachable
 * whether or not it is still resident.
 *
 * Safe to call with a system slot, an undefined one, or a file that is already
 * gone.
 */
export function removeUserFontFile(slot: FontSlot | undefined): void {
  if (!slot || slot.kind !== 'file') return;
  try {
    const uri = userFontUri(slot);
    if (!uri) return;
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // A font file that will not delete is a stale file, not a failure the
    // reader can do anything about: the slot is already back on the system
    // font by the time this runs.
  }
}

/**
 * What a reader-supplied font file is, and everything about one that can be
 * decided without asking the device.
 *
 * The app ships no fonts and offers no list. A reader who wants a different
 * face pastes a URL or picks a file, and the app keeps that one file. So the
 * questions this module answers are the ones that decide whether a pile of
 * bytes is a font at all -- its signature, its size, the name to show it under,
 * where it is kept -- and none of them needs Skia, expo-font or a filesystem.
 *
 * Split from `user-fonts.ts` for that reason and no other: the moment a module
 * imports `expo-file-system`, `bun test` cannot load it (react-native's own
 * entry point is Flow, not TypeScript), and a validator that cannot be tested
 * is a validator nobody checked. `user-fonts.ts` re-exports all of this, so a
 * caller still has one import to reach for.
 *
 * Nothing here decides *taste*. A reader with a custom need will pick a font
 * that suits them; the app's job is to refuse a file that would crash it and to
 * say plainly when a face in the monospace slot is not monospace. Not to police
 * the choice.
 */

/**
 * The two names every consumer references, and the file's own internal name is
 * never one of them.
 *
 * `Font.loadAsync(name, { uri })` registers a face under whatever name it is
 * given -- `ReactFontManager.setTypeface(name, ...)` on Android,
 * `FontFamilyAliasManager.setAlias` on iOS -- so the app picks the name and the
 * font does not get a say. That is what makes a swap a swap: the markdown
 * style, the kit theme and the terminal all name the same constant, and the
 * only thing that changes when a reader installs a different file is which
 * bytes are behind it. Using the face's own family name instead would mean
 * every style in the app had to be rewritten on every change, and two faces
 * that both call themselves `Regular` would collide.
 */
export const USER_FONT_ALIAS = {
  interface: 'MuqunUserInterface',
  mono: 'MuqunUserMono',
} as const;

/** Which of the two slots a font is installed into. */
export type FontSlotId = keyof typeof USER_FONT_ALIAS;

/** Both, in the order the settings sheet lists them. */
export const FONT_SLOT_IDS: readonly FontSlotId[] = ['interface', 'mono'];

/**
 * Where a slot's choice stands.
 *
 * `system` is the default and the absence of a choice, not a third font. A
 * `file` slot names a file *relative* to the documents directory, never an
 * absolute one: iOS moves an app's container across updates and reinstalls, so
 * an absolute path stored today is a path to nothing after the next release.
 * `source` is what the reader gave us -- the URL, or the name of the file they
 * picked -- and is kept so the row can say where the font came from and so a
 * re-paste of the *same* URL can be recognised as nothing to do.
 *
 * `advanceRatio` is the measured advance of `M` over the size it was measured
 * at, and it is on the slot rather than in the terminal because the terminal
 * needs it *before* it has loaded the font: it is what sizes the PTY on the
 * first frame. `isMonospace` is the same measurement's other answer, kept so
 * the settings row can warn without re-opening the file.
 */
export type FontSlot =
  | { kind: 'system' }
  | {
      kind: 'file';
      /** The URL pasted, or the name of the file imported. */
      source: string;
      /** Relative to the documents directory: `fonts/mono-a1b2c3d4.ttf`. */
      file: string;
      /** What the row calls it. */
      label: string;
      /** The advance of `M` as a fraction of the em, when it was measured. */
      advanceRatio?: number;
      /** Whether `i M W 0` all advanced the same. Only measured for the mono slot. */
      isMonospace?: boolean;
    };

/** Nothing chosen. A frozen constant, so identity is stable across renders. */
export const SYSTEM_FONT_SLOT: FontSlot = Object.freeze({ kind: 'system' });

/** The directory inside the documents directory that holds every installed face. */
export const USER_FONT_DIRECTORY = 'fonts';

/**
 * The largest file the app will take, in bytes.
 *
 * A full CJK face is 10-20 MB and there is no subsetting on a phone, so the cap
 * has to sit well above that or the readers who most need a custom font are the
 * ones it refuses. 48 MB is roughly twice the largest face anyone ships and
 * still small enough that a mistake -- a disk image, a video, an HTML error
 * page that happens to be enormous -- is caught before it is written.
 */
export const USER_FONT_MAX_BYTES = 48 * 1024 * 1024;

/** Enough of the head to recognise an sfnt signature, and not one byte more. */
export const USER_FONT_SNIFF_BYTES = 4;

/** What the first four bytes said the file was. */
export type SniffedFontFormat =
  /** `00 01 00 00` or `true`: glyf outlines. `.ttf`. */
  | 'truetype'
  /** `OTTO`: CFF outlines in an sfnt wrapper. `.otf`. */
  | 'opentype'
  /** `ttcf`: a collection. expo-font takes one, Skia's FreeType face does not. */
  | 'collection'
  /** `wOFF`: web-only compression. */
  | 'woff'
  /** `wOF2`: web-only compression. */
  | 'woff2'
  /** Anything else, including a file too short to have a signature. */
  | 'unknown'
  | 'webpage';

/** The two formats both expo-font and Skia's FreeType reader can open. */
const ACCEPTED_FORMATS: readonly SniffedFontFormat[] = ['truetype', 'opentype'];

function tag(head: Uint8Array): string {
  let text = '';
  for (let index = 0; index < 4; index += 1) text += String.fromCharCode(head[index] ?? 0);
  return text;
}

/**
 * What a file is, from its first four bytes.
 *
 * The extension is not asked and is not trusted. A URL ending in `.ttf` that
 * serves a WOFF2, or a 404 page, is the ordinary case rather than the exotic
 * one -- and a reader who renamed a file to get past a picker has told us
 * nothing about what is inside it.
 *
 * WOFF and WOFF2 are refused rather than unwrapped. They are a web transport
 * format: neither Android's `Typeface.createFromFile`, nor iOS's
 * `CTFontManagerRegisterFontsForURL`, nor Skia's FreeType reader opens one, and
 * a decompressor is not something this app should be carrying. A collection is
 * refused for a narrower reason: expo-font would take it, but the terminal's
 * Skia probe cannot, so accepting one would mean a face that works in markdown
 * and silently does not work in the terminal.
 */
export function sniffFontFormat(head: Uint8Array): SniffedFontFormat {
  if (head.length < USER_FONT_SNIFF_BYTES) return 'unknown';
  if (head[0] === 0x00 && head[1] === 0x01 && head[2] === 0x00 && head[3] === 0x00) {
    return 'truetype';
  }
  switch (tag(head)) {
    case 'true':
      return 'truetype';
    case 'OTTO':
      return 'opentype';
    case 'ttcf':
      return 'collection';
    case 'wOFF':
      return 'woff';
    case 'wOF2':
      return 'woff2';
    default:
      return looksLikeMarkup(head) ? 'webpage' : 'unknown';
  }
}

/**
 * Whether the bytes open like a web page.
 *
 * The commonest wrong link is not a wrong file but a page ABOUT the file: a
 * repository's file view, a download landing page, a 404. They all start with
 * markup, after optional whitespace or a byte-order mark.
 */
function looksLikeMarkup(head: Uint8Array): boolean {
  let text = '';
  for (let index = 0; index < Math.min(head.length, 16); index += 1) {
    text += String.fromCharCode(head[index] ?? 0);
  }
  const trimmed = text
    .replace(/^\uFEFF/, '')
    .replace(/^[\xEF\xBB\xBF]+/, '')
    .trimStart()
    .toLowerCase();
  return trimmed.startsWith('<!do') || trimmed.startsWith('<htm') || trimmed.startsWith('<?xm');
}

/** Whether a sniffed format is one the app can register and draw with. */
export function isSupportedFontFormat(format: SniffedFontFormat): boolean {
  return ACCEPTED_FORMATS.includes(format);
}

/** The extension a sniffed format is stored under, never the source's own. */
export function fontFileExtension(format: SniffedFontFormat): '.ttf' | '.otf' {
  return format === 'opentype' ? '.otf' : '.ttf';
}

/**
 * Why a file was not installed.
 *
 * A code rather than a sentence, because the sentence is the settings sheet's
 * and has to be translated. Everything the sentence needs travels with the
 * code: the format that was found, the size that was over, the status that came
 * back.
 */
export type UserFontProblem =
  | { kind: 'format'; format: SniffedFontFormat }
  | { kind: 'too-large'; bytes: number }
  | { kind: 'empty' }
  /** Skia opened the file and got nothing: an sfnt header over broken tables. */
  | { kind: 'unreadable' }
  | { kind: 'download'; status?: number }
  | { kind: 'cancelled' }
  | { kind: 'storage' };

/** Thrown by every acquisition path, so one `catch` can answer all of them. */
export class UserFontError extends Error {
  readonly problem: UserFontProblem;

  constructor(problem: UserFontProblem, message?: string) {
    super(message ?? `user font rejected: ${problem.kind}`);
    this.name = 'UserFontError';
    this.problem = problem;
  }
}

/**
 * The size check, as its own answer rather than a boolean.
 *
 * `0` is its own problem: a server that answers 200 with nothing, or a picker
 * that hands back a placeholder, is not a font that is too small -- it is not a
 * font, and "this file is empty" is a more useful thing to read than "this file
 * is not a TrueType or OpenType font".
 */
export function checkFontSize(bytes: number): UserFontProblem | null {
  if (!Number.isFinite(bytes) || bytes <= 0) return { kind: 'empty' };
  if (bytes > USER_FONT_MAX_BYTES) return { kind: 'too-large', bytes };
  return null;
}

/**
 * The HTTP status inside a download failure, where the platform put one there.
 *
 * `File.downloadFileAsync` rejects a non-2xx response with an `UnableToDownload`
 * error whose message carries the code, and the two platforms word it
 * differently. The number is what the row shows -- "Could not download: 404" is
 * a sentence a reader can act on, and the native message is not -- so it is
 * pulled out here rather than displayed raw.
 */
export function downloadStatusFrom(message: string): number | undefined {
  const match = /\b([1-5][0-9]{2})\b/.exec(message);
  if (!match) return undefined;
  const status = Number(match[1]);
  return status >= 100 && status <= 599 ? status : undefined;
}

/**
 * The name the reader reads when the font will not say its own.
 *
 * This used to be the only answer, on the argument that a face's internal
 * family name is not available -- Skia's `SkTypeface` exposes `getGlyphIDs`
 * and nothing else (`skia/types/Typeface/Typeface.ts`), and expo-font has no
 * opinion about a file's contents at all. Both halves of that are still true
 * and the conclusion was still wrong, because the name is not in the typeface
 * API, it is in the file: see `fontFamilyNameFromNameTable` below.
 *
 * What is left for this function is the fallback, and it is a real one. A
 * stripped or subset face can have no usable `name` table, and a reader can
 * pick a file the platform will not name either -- on Android
 * `File.pickFileAsync` hands back a `File` whose only name is
 * `Paths.basename(uri)` (`expo-file-system/src/File.ts:172`), and for a
 * Storage Access Framework document that URI ends in the provider's own
 * document id. Which is how a reader who installed a font found the Font row
 * calling it `msf:13397`.
 *
 * Query strings and fragments come off first, because a CDN URL carries a cache
 * key that is not part of anything's name. Separators become spaces, the
 * extension goes, and the result is capped: a row is one line.
 */
export function userFontLabel(source: string): string | null {
  const withoutQuery = source.split(/[?#]/u)[0] ?? '';
  const base = withoutQuery.split('/').pop() ?? '';
  const withoutExtension = base.replace(/\.[A-Za-z0-9]{1,8}$/u, '');
  const spaced = decodeURIComponentSafe(withoutExtension)
    .replace(/[_+]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!spaced) return null;
  return spaced.length > 48 ? `${spaced.slice(0, 47)}…` : spaced;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A stray `%` in a file name is not an error worth surfacing; the
    // undecoded name is still the name the reader picked.
    return value;
  }
}

/**
 * Where the font came from, in the few words a caption has room for.
 *
 * The row says two things: what the face calls itself, and where the reader
 * got it. The second is this. A URL is reduced to its host, because the path
 * is a hash and a version and four directories that say nothing about
 * provenance and push the host off the end of the line; a picked file is its
 * own name, decoded, which is the only thing about a local file a reader
 * recognises.
 *
 * `null` when there is nothing worth saying -- an opaque content URI is not a
 * place, and a caption reading `msf:13397` is worse than no caption.
 */
export function userFontSource(source: string): string | null {
  const trimmed = source.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.host || null;
  } catch {
    // Not a URL. Fall through: it is a file name, or something shaped like one.
  }
  const name = decodeURIComponentSafe(trimmed.split('/').pop() ?? '');
  // The document-id case. A provider's opaque handle has a scheme-like colon
  // in it and no extension, and naming it tells the reader nothing at all.
  if (!name || /^[a-z]+:[0-9]+$/iu.test(name)) return null;
  return name.length > 48 ? `${name.slice(0, 47)}\u2026` : name;
}

/**
 * Reading a font's own name out of the file, which is the only place it is.
 *
 * Every sfnt font carries a `name` table: a small, fixed, well-specified
 * structure holding the strings the font calls itself by, one record per
 * (platform, encoding, language, nameID). It is the table every font tool and
 * every operating system reads to build a font menu, and it is a couple of
 * dozen lines to walk. The app avoided it for a while on the grounds that
 * hand-parsing a binary table to put one word on a row was not a trade worth
 * making -- but the alternative turned out to be a row that calls the reader's
 * font `msf:13397`, so it plainly was.
 *
 * The functions below are deliberately split at the point where bytes have to
 * be fetched. `sfntTableCount` and `findSfntTable` work on the head of the
 * file; `fontFamilyNameFromNameTable` works on one table. That split is what
 * lets the caller read two small ranges out of a 20 MB CJK face instead of the
 * whole thing, and it is what lets every one of them be tested against real
 * fonts with no device and no filesystem.
 */

/** The sfnt header: a version tag, a table count, and three search hints. */
export const SFNT_HEADER_BYTES = 12;

/** One table directory entry: a four-byte tag, a checksum, an offset, a length. */
export const SFNT_DIRECTORY_ENTRY_BYTES = 16;

/**
 * The most of a `name` table this will read, in bytes.
 *
 * A real one is one to twenty kilobytes: a few dozen records of a few dozen
 * characters each, times the platforms and languages the foundry shipped. A
 * quarter of a megabyte is far above any of them and is here so that a
 * hand-edited header claiming a 2 GB `name` table cannot make the app allocate
 * it. A face whose names genuinely will not fit falls back to the file name,
 * which is the same place a face with no `name` table lands.
 */
export const FONT_NAME_TABLE_MAX_BYTES = 256 * 1024;

function uint16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function uint32(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] ?? 0) * 0x1000000 +
    (((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0))
  );
}

/**
 * How many tables the directory holds, or `null` if this is not an sfnt at all.
 *
 * Reads the count and nothing else, so a caller knows exactly how many more
 * bytes the directory needs before asking for them.
 */
export function sfntTableCount(head: Uint8Array): number | null {
  if (head.length < SFNT_HEADER_BYTES) return null;
  if (!isSupportedFontFormat(sniffFontFormat(head))) return null;
  const count = uint16(head, 4);
  // A real face has between ten and thirty tables. The cap is the field's own
  // ceiling and exists only so a nonsense count cannot size an allocation.
  return count > 0 && count <= 512 ? count : null;
}

/** How many bytes the header and a directory of `count` entries occupy. */
export function sfntDirectoryBytes(count: number): number {
  return SFNT_HEADER_BYTES + count * SFNT_DIRECTORY_ENTRY_BYTES;
}

/**
 * Where a named table lives in the file, from the header and directory.
 *
 * `directory` is the head of the file, at least `sfntDirectoryBytes(count)`
 * long. Anything short, absent or implausible is `null` rather than a throw:
 * this runs on a file a stranger's server sent us, and the caller's answer to
 * every failure here is the same -- fall back to the file name.
 */
export function findSfntTable(
  directory: Uint8Array,
  tag: string
): { offset: number; length: number } | null {
  const count = sfntTableCount(directory);
  if (count === null) return null;
  if (directory.length < sfntDirectoryBytes(count)) return null;
  for (let index = 0; index < count; index += 1) {
    const at = SFNT_HEADER_BYTES + index * SFNT_DIRECTORY_ENTRY_BYTES;
    let found = '';
    for (let byte = 0; byte < 4; byte += 1) found += String.fromCharCode(directory[at + byte] ?? 0);
    if (found !== tag) continue;
    const offset = uint32(directory, at + 8);
    const length = uint32(directory, at + 12);
    if (length <= 0 || length > FONT_NAME_TABLE_MAX_BYTES) return null;
    return { offset, length };
  }
  return null;
}

/**
 * The `name` table's name IDs this cares about, best first.
 *
 * 16 is the typographic family: the name a foundry wants a font *menu* to
 * show, and the one that says `Iosevka` where ID 1 is forced to say
 * `Iosevka Term SemiBold Extended` because the old model could only carry four
 * styles per family. 1 is the ordinary family name and is what almost every
 * font has. 4 is the full name -- family plus style -- and is the last resort,
 * because a face with neither of the other two is usually a subset or a
 * conversion, and a long name is better than no name.
 */
const FAMILY_NAME_IDS = [16, 1, 4] as const;

/**
 * Mac Roman's upper half, which is the only part of it that is not ASCII.
 *
 * Platform 1 encoding 0 records are Mac Roman, and a foundry that shipped one
 * in the 1990s is still shipping it now. Most such names are plain ASCII and
 * would survive a naive decode; the ones that are not are exactly the names
 * worth getting right, because a face called `Futura Condensed Extra Bold` is
 * fine either way and one called `Helvetica Neue LT Std 87 Heavy Condensed
 * Oblique` is not the interesting case -- an accented foundry name is.
 */
const MAC_ROMAN_HIGH =
  '\u00C4\u00C5\u00C7\u00C9\u00D1\u00D6\u00DC\u00E1\u00E0\u00E2\u00E4\u00E3\u00E5\u00E7\u00E9\u00E8' +
  '\u00EA\u00EB\u00ED\u00EC\u00EE\u00EF\u00F1\u00F3\u00F2\u00F4\u00F6\u00F5\u00FA\u00F9\u00FB\u00FC' +
  '\u2020\u00B0\u00A2\u00A3\u00A7\u2022\u00B6\u00DF\u00AE\u00A9\u2122\u00B4\u00A8\u2260\u00C6\u00D8' +
  '\u221E\u00B1\u2264\u2265\u00A5\u00B5\u2202\u2211\u220F\u03C0\u222B\u00AA\u00BA\u03A9\u00E6\u00F8' +
  '\u00BF\u00A1\u00AC\u221A\u0192\u2248\u2206\u00AB\u00BB\u2026\u00A0\u00C0\u00C3\u00D5\u0152\u0153' +
  '\u2013\u2014\u201C\u201D\u2018\u2019\u00F7\u25CA\u00FF\u0178\u2044\u20AC\u2039\u203A\uFB01\uFB02' +
  '\u2021\u00B7\u201A\u201E\u2030\u00C2\u00CA\u00C1\u00CB\u00C8\u00CD\u00CE\u00CF\u00CC\u00D3\u00D4' +
  '\uF8FF\u00D2\u00DA\u00DB\u00D9\u0131\u02C6\u02DC\u00AF\u02D8\u02D9\u02DA\u00B8\u02DD\u02DB\u02C7';

function decodeMacRoman(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) {
    text += byte < 0x80 ? String.fromCharCode(byte) : (MAC_ROMAN_HIGH[byte - 0x80] ?? '\uFFFD');
  }
  return text;
}

function decodeUtf16Be(bytes: Uint8Array): string {
  // An odd length is a malformed record rather than a half character; the last
  // stray byte is dropped and whatever decoded before it is still a name.
  let text = '';
  for (let at = 0; at + 1 < bytes.length; at += 2) text += String.fromCharCode(uint16(bytes, at));
  return text;
}

/**
 * How good a record is, as one number, so the best of them can be picked in a
 * single pass.
 *
 * `null` means unreadable rather than merely worse: an encoding this cannot
 * decode is not a name at a lower rank, it is bytes. The three terms are
 * ranked in the order they matter -- which name is being asked for, then
 * whether it can be decoded well, then whether it is in English -- and are
 * spaced so that no amount of the later ones outranks the earlier.
 */
function nameRecordScore(
  platform: number,
  encoding: number,
  language: number,
  nameId: number
): number | null {
  const idRank = FAMILY_NAME_IDS.indexOf(nameId as (typeof FAMILY_NAME_IDS)[number]);
  if (idRank < 0) return null;

  let platformRank: number;
  if (platform === 3 && (encoding === 1 || encoding === 10)) {
    // Windows, UTF-16BE. What every font shipped this century carries, and the
    // record a font menu on any platform reads first.
    platformRank = 2;
  } else if (platform === 0) {
    // Unicode. Always UTF-16BE whatever the encoding id says.
    platformRank = 1;
  } else if (platform === 1 && encoding === 0) {
    platformRank = 0;
  } else {
    // Platform 1 with a non-Roman script, or platform 2 (deprecated ISO), or
    // something a specification does not describe. Not guessed at.
    return null;
  }

  // English, in each platform's own way of saying it: 0x0409 is en-US in
  // Windows' language ids, 0 is English in Macintosh's. A font with names in
  // six languages and no English is read in whichever one sorts first here,
  // which is still its own name.
  const english = (platform === 3 && language === 0x0409) || (platform === 1 && language === 0);

  return (FAMILY_NAME_IDS.length - idRank) * 100 + platformRank * 10 + (english ? 1 : 0);
}

/**
 * The family name inside a `name` table, or `null` if it does not hold one.
 *
 * Format 0 and format 1 tables have the same header and the same record array;
 * format 1's extra language-tag array sits after the records and is not needed
 * to read a Windows or Macintosh record, so both are handled by reading the
 * header and walking `count` records.
 *
 * Every bound is checked against the table's own length. A `name` table is
 * three levels of offset -- table to string area, string area to record, record
 * to its length -- and a file that lies about any of them is a file that would
 * otherwise read whatever happened to be next in memory.
 */
export function fontFamilyNameFromNameTable(table: Uint8Array): string | null {
  if (table.length < 6) return null;
  const count = uint16(table, 2);
  const stringOffset = uint16(table, 4);
  const recordsEnd = 6 + count * 12;
  if (count === 0 || recordsEnd > table.length) return null;

  let best: { score: number; text: string } | null = null;
  for (let index = 0; index < count; index += 1) {
    const at = 6 + index * 12;
    const score = nameRecordScore(
      uint16(table, at),
      uint16(table, at + 2),
      uint16(table, at + 4),
      uint16(table, at + 6)
    );
    if (score === null || (best && score <= best.score)) continue;

    const length = uint16(table, at + 8);
    const start = stringOffset + uint16(table, at + 10);
    if (length === 0 || start + length > table.length) continue;

    const bytes = table.subarray(start, start + length);
    const platform = uint16(table, at);
    const text = platform === 1 ? decodeMacRoman(bytes) : decodeUtf16Be(bytes);
    const cleaned = cleanFamilyName(text);
    if (cleaned) best = { score, text: cleaned };
  }
  return best?.text ?? null;
}

/**
 * The name, tidied just enough to put on a row and no further.
 *
 * A `name` string can carry a trailing NUL, a byte-order mark from a converter
 * that wrote UTF-16 the long way, or line breaks from a foundry that used the
 * field as a notes column. None of those is part of the name. What is *not*
 * done here is any attempt to improve the name -- no case fixing, no splitting
 * a style off the end, no dropping a foundry prefix. It is what the font calls
 * itself, and the reader chose this file.
 */
function cleanFamilyName(value: string): string | null {
  const cleaned = value
    .replace(/^\uFEFF/u, '')
    // eslint-disable-next-line no-control-regex -- the exact bytes being stripped
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  if (!cleaned) return null;
  // A name that decoded to replacement characters is a record this could not
  // read rather than a font that is called that.
  if (/^\uFFFD+$/u.test(cleaned)) return null;
  return cleaned.length > 48 ? `${cleaned.slice(0, 47)}\u2026` : cleaned;
}

/**
 * The family name of a whole font held in memory.
 *
 * The convenience form, for a caller that already has the bytes -- a test, or
 * a file small enough that reading it twice would cost more than reading it
 * once. The install path does not use it: it reads the header, then the
 * directory, then the one table, which on a 20 MB face is three reads of a few
 * kilobytes instead of twenty megabytes of allocation.
 */
export function fontFamilyName(bytes: Uint8Array): string | null {
  const table = findSfntTable(bytes, 'name');
  if (!table) return null;
  if (table.offset + table.length > bytes.length) return null;
  return fontFamilyNameFromNameTable(bytes.subarray(table.offset, table.offset + table.length));
}

/**
 * Whether a pasted string is something worth trying to download.
 *
 * Deliberately shallow. The app is not in a position to know what a reader's
 * font server looks like, so this refuses only what cannot be a download at all
 * -- anything that is not http(s). Everything else is decided by the server's
 * answer, which is a better judge than a regular expression.
 */
/**
 * The address the font's bytes are at, for an address a reader is likely to paste.
 *
 * A reader copies the link from the page they are looking at, and on a code
 * host that page is a viewer around the file, not the file. The three hosts
 * below each have a fixed, documented raw form, so the rewrite is mechanical
 * and the reader never has to learn the word "raw":
 *
 *   github.com/o/r/blob/<ref>/<path>   -> raw.githubusercontent.com/o/r/<ref>/<path>
 *   gitlab.com/.../-/blob/<ref>/<path> -> .../-/raw/<ref>/<path>
 *   <gitea>/o/r/src/branch/...         -> <gitea>/o/r/raw/branch/...
 *
 * The path is decoded and re-encoded per segment: GitHub's share links escape
 * the slashes inside the path (`Serif%2FSubsetOTF%2F...`), and the raw host
 * wants real ones. Anything unrecognised is returned as it came.
 */
export function directFontUrl(value: string): string {
  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return trimmed;
  }
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .flatMap((segment) => safeDecode(segment).split('/'))
    .filter(Boolean);
  const encode = (parts: readonly string[]) => parts.map(encodeURIComponent).join('/');

  if (url.hostname === 'github.com' && segments.length >= 5) {
    const [owner, repo, view, ...rest] = segments;
    if (view === 'blob' || view === 'raw') {
      return `https://raw.githubusercontent.com/${encode([owner ?? '', repo ?? '', ...rest])}`;
    }
  }
  const dash = segments.indexOf('-');
  if (dash >= 0 && segments[dash + 1] === 'blob') {
    const next = [...segments];
    next[dash + 1] = 'raw';
    return `${url.origin}/${encode(next)}`;
  }
  if (
    segments.length >= 5 &&
    segments[2] === 'src' &&
    ['branch', 'commit', 'tag'].includes(segments[3] ?? '')
  ) {
    const next = [...segments];
    next[2] = 'raw';
    return `${url.origin}/${encode(next)}`;
  }
  return trimmed;
}

function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function isDownloadableFontUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Where a slot's file is kept, relative to the documents directory. */
export function userFontRelativePath(
  slot: FontSlotId,
  token: string,
  format: SniffedFontFormat
): string {
  return `${USER_FONT_DIRECTORY}/${slot}-${token}${fontFileExtension(format)}`;
}

/**
 * Whether a stored path is one this app wrote.
 *
 * The hydration guard, and it is a guard rather than a formality: the settings
 * blob is JSON in the keychain, and a value that reached `new File(...)` without
 * being checked would be a path traversal with a font file on the end of it. A
 * path has to be inside the fonts directory, have no `..` in it and be relative.
 */
export function isUserFontRelativePath(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!value.startsWith(`${USER_FONT_DIRECTORY}/`)) return false;
  if (value.includes('..') || value.includes('\\')) return false;
  if (value.includes('://')) return false;
  const name = value.slice(USER_FONT_DIRECTORY.length + 1);
  return /^[A-Za-z0-9._-]+$/u.test(name) && name !== '.' && name !== '..';
}

/**
 * The absolute URI a relative path names, given today's documents directory.
 *
 * The rejoin half of storing paths relative. The directory's URI already ends
 * in a slash on both platforms, but it is not worth depending on that.
 */
export function joinDocumentUri(documentUri: string, relative: string): string {
  return documentUri.endsWith('/') ? `${documentUri}${relative}` : `${documentUri}/${relative}`;
}

/**
 * What a stored slot is, or `undefined` if it is not anything.
 *
 * Every field is checked, and a slot that fails any of them reads as no slot
 * rather than as a partially trusted one -- the app falls back to the system
 * font, which is the state it can always be in. An unknown `kind`, a hand-edited
 * file, a build that stored a shape this one no longer understands: all the
 * same answer.
 */
export function parseFontSlot(value: unknown): FontSlot | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const slot = value as Record<keyof Extract<FontSlot, { kind: 'file' }>, unknown>;
  if (slot.kind === 'system') return SYSTEM_FONT_SLOT;
  if (slot.kind !== 'file') return undefined;
  if (typeof slot.source !== 'string' || !slot.source) return undefined;
  if (typeof slot.label !== 'string' || !slot.label) return undefined;
  if (!isUserFontRelativePath(slot.file)) return undefined;
  const advanceRatio =
    typeof slot.advanceRatio === 'number' &&
    Number.isFinite(slot.advanceRatio) &&
    slot.advanceRatio > 0 &&
    slot.advanceRatio <= 4
      ? slot.advanceRatio
      : undefined;
  return {
    kind: 'file',
    source: slot.source,
    file: slot.file,
    label: slot.label,
    ...(advanceRatio === undefined ? {} : { advanceRatio }),
    ...(typeof slot.isMonospace === 'boolean' ? { isMonospace: slot.isMonospace } : {}),
  };
}

/**
 * How far apart four advances may be and still be called monospace.
 *
 * A twentieth of an em. Real monospace faces report the same advance to the
 * unit for every glyph, so anything this measures as uneven is uneven by design
 * -- and the tolerance exists only so that a face whose `i` is a rounding unit
 * off its `M` is not called proportional over a thousandth of a point.
 */
export const MONO_ADVANCE_TOLERANCE = 0.05;

/**
 * The four characters the monospace check is made on, and why these four.
 *
 * The narrowest lower-case letter, the two widest capitals, and a digit. In any
 * proportional face `i` is roughly a third of `W`; in any monospace face all
 * four are the same number. Measuring more characters would not change an
 * answer this stark, and measuring fewer would miss a face that is monospace
 * across its letters and not across its digits.
 */
export const MONO_PROBE_CHARACTERS = 'iMW0';

/** The advance measurement, as a fraction of the em, and its verdict. */
export interface FontAdvanceProfile {
  /** The advance of `M` over the size it was measured at. */
  advanceRatio: number;
  /** Whether all four probe characters advanced the same. */
  isMonospace: boolean;
}

/**
 * The advance profile from four measured widths.
 *
 * Pure so it can be tested against numbers rather than against a device.
 * `advances` is in the order of `MONO_PROBE_CHARACTERS`, at `fontSize` points;
 * the ratio taken is `M`'s, because `M` is what the terminal's own
 * `measureCellWidth` measures, and a cell estimate that disagreed with the cell
 * would put the first frame's PTY at the wrong width.
 *
 * A face that reports a zero or negative advance for any of the four is not
 * monospace as far as this is concerned: it is a face that is not answering,
 * and the terminal's own fallback is the safer number to carry.
 */
export function fontAdvanceProfile(
  advances: readonly number[],
  fontSize: number
): FontAdvanceProfile | null {
  if (!Number.isFinite(fontSize) || fontSize <= 0) return null;
  if (advances.length !== MONO_PROBE_CHARACTERS.length) return null;
  if (advances.some((advance) => !Number.isFinite(advance) || advance <= 0)) return null;
  const ratios = advances.map((advance) => advance / fontSize);
  // Index 1 is `M` in `MONO_PROBE_CHARACTERS`.
  const advanceRatio = ratios[1];
  const spread = Math.max(...ratios) - Math.min(...ratios);
  return { advanceRatio, isMonospace: spread <= MONO_ADVANCE_TOLERANCE };
}

/**
 * The advance ratio the terminal should size its first frame with.
 *
 * The measured one where there is one, and `fallback` -- the bundled JetBrains
 * Mono's own 0.6 -- everywhere else. A slot with no measurement is either the
 * system font or a face installed by a build that did not measure, and in both
 * cases the bundled font's ratio is what the canvas will actually draw with.
 */
export function slotAdvanceRatio(slot: FontSlot, fallback: number): number {
  if (slot.kind !== 'file') return fallback;
  return slot.advanceRatio ?? fallback;
}

/**
 * The family name a slot resolves to, or `null` for the system font.
 *
 * One function so that no consumer writes `slot.kind === 'file' ? ALIAS.x :
 * undefined` for itself and gets the branch subtly wrong -- the markdown style,
 * the kit theme and the terminal all ask here.
 */
export function slotFontFamily(slot: FontSlot, id: FontSlotId): string | null {
  if (slot.kind !== 'file') return null;
  return `${USER_FONT_ALIAS[id]}_${fontFileToken(slot.file)}`;
}

/**
 * The part of a stored font's name that is its own: `fonts/mono-1a2b3c.ttf` ->
 * `1a2b3c`.
 *
 * The family a file is registered under carries it, so every installed file
 * has a family name no other file ever had. One fixed alias per slot looked
 * simpler and was the reason a newly installed font "needed a restart": both
 * platforms and the markdown renderer cache a resolved typeface BY FAMILY
 * NAME (React Native's font manager per weight, enriched-markdown per family
 * with no invalidation at all), so rebinding the same name to new bytes left
 * every one of those caches answering with the old face until the process
 * died. A new name has no cache entry to be stale.
 */
export function fontFileToken(file: string): string {
  const name = file.slice(file.lastIndexOf('/') + 1);
  const stem = name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name;
  const token = stem.includes('-') ? stem.slice(stem.indexOf('-') + 1) : stem;
  return token.replace(/[^A-Za-z0-9]/g, '') || 'font';
}

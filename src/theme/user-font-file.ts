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
 * The name the reader reads, derived from where the font came from.
 *
 * A face's internal family name would be the better answer and is not available:
 * neither expo-font nor the Skia typeface exposes it, and parsing an sfnt `name`
 * table by hand to put one word on a row is not a trade worth making. So the
 * label comes from the file name, which is what a reader recognises anyway --
 * they are the one who chose the file.
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
  return slot.kind === 'file' ? USER_FONT_ALIAS[id] : null;
}

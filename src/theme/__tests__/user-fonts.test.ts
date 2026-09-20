import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import {
  checkFontSize,
  downloadStatusFrom,
  fontAdvanceProfile,
  fontFileExtension,
  isDownloadableFontUrl,
  isSupportedFontFormat,
  isUserFontRelativePath,
  joinDocumentUri,
  MONO_PROBE_CHARACTERS,
  parseFontSlot,
  slotAdvanceRatio,
  slotFontFamily,
  sniffFontFormat,
  SYSTEM_FONT_SLOT,
  USER_FONT_ALIAS,
  USER_FONT_MAX_BYTES,
  USER_FONT_SNIFF_BYTES,
  userFontLabel,
  userFontRelativePath,
  type FontSlot,
} from '@/theme/user-font-file';

/**
 * A real font, not a hand-built header.
 *
 * `react-native-enriched-markdown` vendors the KaTeX faces for its maths
 * rendering, so a genuine TrueType file is already in the dependency tree and
 * the sniff can be asked about bytes somebody else wrote. A fabricated
 * `00 01 00 00` would pass a test of the code that fabricated it.
 */
const REAL_TTF =
  'node_modules/react-native-enriched-markdown/ios/vendor/Fonts/KaTeX_Main-Regular.ttf';

function head(bytes: number[]): Uint8Array {
  return new Uint8Array(bytes);
}

function ascii(text: string): Uint8Array {
  return new Uint8Array([...text].map((character) => character.charCodeAt(0)));
}

test('a real TrueType file off disk sniffs as TrueType and is accepted', () => {
  const file = readFileSync(REAL_TTF);
  const format = sniffFontFormat(new Uint8Array(file.subarray(0, USER_FONT_SNIFF_BYTES)));
  expect(format).toBe('truetype');
  expect(isSupportedFontFormat(format)).toBe(true);
  expect(fontFileExtension(format)).toBe('.ttf');
  // And it is a plausible font rather than a stub, so the fixture cannot rot
  // into an empty file that happens to satisfy the assertion above.
  expect(file.byteLength).toBeGreaterThan(1000);
  expect(checkFontSize(file.byteLength)).toBeNull();
});

test('the four sfnt signatures are told apart', () => {
  // `00 01 00 00` -- glyf outlines, the ordinary `.ttf`.
  expect(sniffFontFormat(head([0x00, 0x01, 0x00, 0x00, 0x00, 0x0c]))).toBe('truetype');
  // `true` -- the older Apple spelling of the same thing.
  expect(sniffFontFormat(ascii('true'))).toBe('truetype');
  // `OTTO` -- CFF outlines in an sfnt wrapper, stored as `.otf`.
  expect(sniffFontFormat(ascii('OTTO'))).toBe('opentype');
  expect(fontFileExtension(sniffFontFormat(ascii('OTTO')))).toBe('.otf');
});

test('WOFF, WOFF2 and collections are refused, and say which they were', () => {
  // A WOFF2 header, as a browser would be handed it: the signature, then the
  // wrapped flavour and the length. The point of carrying the format out of
  // the sniff is that the sheet can say "this is a web font" rather than "this
  // is not a font", which is the difference between a reader re-exporting the
  // file and a reader giving up.
  const woff2 = new Uint8Array(12);
  woff2.set(ascii('wOF2'), 0);
  woff2.set(ascii('OTTO'), 4);
  expect(sniffFontFormat(woff2)).toBe('woff2');
  expect(isSupportedFontFormat(sniffFontFormat(woff2))).toBe(false);

  expect(sniffFontFormat(ascii('wOFF'))).toBe('woff');
  expect(isSupportedFontFormat(sniffFontFormat(ascii('wOFF')))).toBe(false);

  // A collection. expo-font would register one; Skia's FreeType face factory
  // would not, so accepting it would mean markdown in the reader's font and a
  // terminal that silently is not.
  expect(sniffFontFormat(ascii('ttcf'))).toBe('collection');
  expect(isSupportedFontFormat(sniffFontFormat(ascii('ttcf')))).toBe(false);
});

test('junk and a file too short to have a signature are unknown; a page is a page', () => {
  expect(sniffFontFormat(head([0xde, 0xad, 0xbe, 0xef]))).toBe('unknown');
  // The common case behind a pasted URL that does not point at a font: an
  // error page, a login redirect, a repository's file view. It is named, so
  // the sheet can say what happened instead of "not a font".
  expect(sniffFontFormat(ascii('<!DOCTYPE html>'))).toBe('webpage');
  // A ZIP, which is what a downloaded font archive actually is.
  expect(sniffFontFormat(head([0x50, 0x4b, 0x03, 0x04]))).toBe('unknown');
  expect(sniffFontFormat(head([0x00, 0x01]))).toBe('unknown');
  expect(sniffFontFormat(new Uint8Array())).toBe('unknown');
});

test('the size cap admits a full CJK face and refuses a video', () => {
  // The case the cap exists for: a complete Han face with no subsetting, which
  // is 10-20 MB and is exactly what the readers this feature is for will pick.
  expect(checkFontSize(18 * 1024 * 1024)).toBeNull();
  expect(checkFontSize(USER_FONT_MAX_BYTES)).toBeNull();
  expect(checkFontSize(USER_FONT_MAX_BYTES + 1)).toEqual({
    kind: 'too-large',
    bytes: USER_FONT_MAX_BYTES + 1,
  });
  // Empty is its own answer: a server that returned 200 and nothing has not
  // sent a font that is too small.
  expect(checkFontSize(0)).toEqual({ kind: 'empty' });
  expect(checkFontSize(Number.NaN)).toEqual({ kind: 'empty' });
});

test('a download failure carries its status out of the native message', () => {
  expect(downloadStatusFrom('Unable to download file: 404')).toBe(404);
  expect(downloadStatusFrom('UnableToDownload: the server responded with status 503')).toBe(503);
  expect(downloadStatusFrom('Network request failed')).toBeUndefined();
});

test('only an http(s) URL is worth trying to download', () => {
  expect(isDownloadableFontUrl('https://fonts.example/Inter.ttf')).toBe(true);
  expect(isDownloadableFontUrl('  http://10.0.2.2:8000/mono.ttf  ')).toBe(true);
  // Refused because they cannot be downloaded at all, not because of what they
  // might contain: a local file has its own way in, and the rest is not a URL.
  expect(isDownloadableFontUrl('file:///sdcard/Inter.ttf')).toBe(false);
  expect(isDownloadableFontUrl('fonts.example/Inter.ttf')).toBe(false);
  expect(isDownloadableFontUrl('')).toBe(false);
  expect(isDownloadableFontUrl('   ')).toBe(false);
});

test('the label is the name the reader would recognise, not the URL', () => {
  expect(userFontLabel('https://fonts.example/download/Iosevka_Term-Regular.ttf?v=31.4')).toBe(
    'Iosevka Term-Regular'
  );
  expect(userFontLabel('LXGW WenKai Mono.ttf')).toBe('LXGW WenKai Mono');
  expect(userFontLabel('https://cdn.example/f/%E6%80%9D%E6%BA%90%E9%BB%91%E4%BD%93.otf')).toBe(
    '思源黑体'
  );
  // A URL with nothing name-shaped on the end of it has no label to offer, and
  // the caller supplies one rather than showing `?download=1`.
  expect(userFontLabel('https://fonts.example/')).toBeNull();
  // Capped: a row is one line.
  expect((userFontLabel(`${'A'.repeat(90)}.ttf`) ?? '').length).toBeLessThanOrEqual(48);
});

test('a stored path is inside the fonts directory or it is not used', () => {
  expect(isUserFontRelativePath('fonts/mono-a1b2c3d4e5f6.ttf')).toBe(true);
  expect(isUserFontRelativePath('fonts/interface-0011.otf')).toBe(true);
  // The reason this is a guard and not a formality: the settings blob is JSON
  // in the keychain, and an unchecked value reaching `new File(...)` is a path
  // traversal with a font file on the end of it.
  expect(isUserFontRelativePath('fonts/../../../etc/passwd')).toBe(false);
  expect(isUserFontRelativePath('/var/mobile/fonts/mono.ttf')).toBe(false);
  expect(isUserFontRelativePath('file:///data/fonts/mono.ttf')).toBe(false);
  expect(isUserFontRelativePath('themes/mono.ttf')).toBe(false);
  expect(isUserFontRelativePath('fonts/sub/dir.ttf')).toBe(false);
  expect(isUserFontRelativePath(42)).toBe(false);
  expect(isUserFontRelativePath(undefined)).toBe(false);
});

test('a path is built inside the fonts directory with the sniffed extension', () => {
  expect(userFontRelativePath('mono', 'a1b2c3', 'truetype')).toBe('fonts/mono-a1b2c3.ttf');
  // The extension comes from the bytes, never from the URL: a `.ttf` link that
  // serves CFF outlines is stored as what it is.
  expect(userFontRelativePath('interface', 'ff00', 'opentype')).toBe('fonts/interface-ff00.otf');
  expect(isUserFontRelativePath(userFontRelativePath('mono', 'a1b2c3', 'truetype'))).toBe(true);
});

test('the document URI is rejoined whether or not it ends in a slash', () => {
  expect(joinDocumentUri('file:///var/mobile/Documents/', 'fonts/mono-1.ttf')).toBe(
    'file:///var/mobile/Documents/fonts/mono-1.ttf'
  );
  expect(joinDocumentUri('file:///data/user/0/dev.osuki.muqun/files', 'fonts/mono-1.ttf')).toBe(
    'file:///data/user/0/dev.osuki.muqun/files/fonts/mono-1.ttf'
  );
});

test('a slot round-trips, and anything malformed reads as no slot at all', () => {
  const installed: FontSlot = {
    kind: 'file',
    source: 'https://fonts.example/Iosevka.ttf',
    file: 'fonts/mono-a1b2c3.ttf',
    label: 'Iosevka',
    advanceRatio: 0.5,
    isMonospace: true,
  };
  expect(parseFontSlot(JSON.parse(JSON.stringify(installed)))).toEqual(installed);
  expect(parseFontSlot({ kind: 'system' })).toEqual(SYSTEM_FONT_SLOT);

  // Every one of these is a slot the app must not act on, and every one of them
  // falls back to the system font rather than to a partially trusted file.
  expect(parseFontSlot(undefined)).toBeUndefined();
  expect(parseFontSlot(null)).toBeUndefined();
  expect(parseFontSlot('fonts/mono.ttf')).toBeUndefined();
  expect(parseFontSlot({ kind: 'url', source: 'https://x/y.ttf' })).toBeUndefined();
  expect(parseFontSlot({ ...installed, file: '../../etc/passwd' })).toBeUndefined();
  expect(parseFontSlot({ ...installed, label: '' })).toBeUndefined();
  expect(parseFontSlot({ ...installed, source: 42 })).toBeUndefined();

  // A nonsense ratio is dropped without dropping the font: the slot is still
  // usable, and the terminal falls back to the bundled face's own advance.
  expect(parseFontSlot({ ...installed, advanceRatio: 0 })).toEqual({
    kind: 'file',
    source: installed.source,
    file: 'fonts/mono-a1b2c3.ttf',
    label: 'Iosevka',
    isMonospace: true,
  });
});

test('four advances decide monospace, and give the terminal its cell estimate', () => {
  expect(MONO_PROBE_CHARACTERS).toBe('iMW0');

  // JetBrains Mono: every glyph advances 0.6em, which is the number
  // `TERMINAL_ADVANCE_RATIO` states for the bundled font.
  const mono = fontAdvanceProfile([60, 60, 60, 60], 100);
  expect(mono).toEqual({ advanceRatio: 0.6, isMonospace: true });

  // A proportional face: `i` is a third of `W`. The terminal will still draw
  // it -- the reader asked for it -- but the row says it will look uneven.
  const proportional = fontAdvanceProfile([27.8, 83.3, 94.4, 55.6], 100);
  expect(proportional?.isMonospace).toBe(false);
  // And the ratio is `M`'s, because `M` is what `measureCellWidth` measures:
  // an estimate taken from a different character would size the first frame's
  // PTY to a grid the canvas does not draw.
  expect(proportional?.advanceRatio).toBeCloseTo(0.833, 3);

  // A face a rounding unit off itself is still monospace.
  expect(fontAdvanceProfile([59.98, 60, 60.01, 59.99], 100)?.isMonospace).toBe(true);

  // A face that reports nothing is not measured, rather than measured as zero.
  expect(fontAdvanceProfile([0, 60, 60, 60], 100)).toBeNull();
  expect(fontAdvanceProfile([60, 60, 60], 100)).toBeNull();
  expect(fontAdvanceProfile([60, 60, 60, 60], 0)).toBeNull();
});

test('a slot resolves to an alias and a ratio, and the system slot to neither', () => {
  const mono: FontSlot = {
    kind: 'file',
    source: 'Iosevka.ttf',
    file: 'fonts/mono-1.ttf',
    label: 'Iosevka',
    advanceRatio: 0.5,
  };
  // The slot's alias plus the FILE's own token, never the face's internal
  // family name: every consumer still asks one function, and a newly installed
  // file gets a name no cache has ever resolved -- which is what makes it show
  // without a restart.
  expect(slotFontFamily(mono, 'mono')).toBe(`${USER_FONT_ALIAS.mono}_1`);
  expect(slotFontFamily({ ...mono, file: 'fonts/mono-c7e5d9a28de9.ttf' }, 'mono')).toBe(
    'MuqunUserMono_c7e5d9a28de9'
  );
  expect(slotFontFamily({ ...mono, file: 'fonts/mono-aaaa.ttf' }, 'mono')).not.toBe(
    slotFontFamily({ ...mono, file: 'fonts/mono-bbbb.ttf' }, 'mono')
  );
  expect(slotFontFamily(SYSTEM_FONT_SLOT, 'mono')).toBeNull();
  expect(slotFontFamily(SYSTEM_FONT_SLOT, 'interface')).toBeNull();
  expect(USER_FONT_ALIAS.interface).toBe('MuqunUserInterface');
  expect(USER_FONT_ALIAS.mono).toBe('MuqunUserMono');

  expect(slotAdvanceRatio(mono, 0.6)).toBe(0.5);
  expect(slotAdvanceRatio(SYSTEM_FONT_SLOT, 0.6)).toBe(0.6);
  // A font installed by a build that did not measure falls back to the bundled
  // font's ratio rather than to a guess.
  expect(slotAdvanceRatio({ ...mono, advanceRatio: undefined }, 0.6)).toBe(0.6);
});

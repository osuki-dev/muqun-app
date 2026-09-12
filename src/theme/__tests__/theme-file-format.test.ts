import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

// The rules this file guards are source-level ones about `readThemeFile`, which
// reaches the filesystem through `expo-file-system` and so cannot be exercised
// here without a process-wide module mock that would leak into every other
// suite. What is checked instead is the *order* of the steps, because order is
// the whole security property: the form has to be known before the bytes are
// pulled, and the ceiling has to be applied before the read rather than after.
const source = readFileSync('src/theme/local-files.ts', 'utf8');
const reader = source.match(/export async function readThemeFile[\s\S]*?\n}/)?.[0] ?? '';

test('the ZIP signature is what marks a packaged theme', () => {
  const guard = source.match(/function isZipArchive[\s\S]*?\n}/)?.[0];
  expect(guard).toBeDefined();
  // PK\x03\x04 -- the local file header every ZIP begins with.
  for (const byte of ['0x50', '0x4b', '0x03', '0x04']) expect(guard).toContain(byte);
});

test('the reader decides the form from bytes, not from the filename', () => {
  // Android hands the app a `content://` URI whose path carries no filename, so
  // a name-based decision works on iOS and fails silently on Android -- exactly
  // the kind of split that only shows up on a device nobody tested.
  expect(reader).toContain('isZipArchive(');
  expect(/name.*endsWith|muqun-theme\|zip/.test(reader)).toBe(false);
});

test('the name is optional, because one platform does not supply it', () => {
  expect(source).toContain('name?: string');
});

test('only the signature is read before the form is known', () => {
  // `firstBytes` exists so the signature costs four bytes rather than the whole
  // file. If it ever read to the end, the ceiling below would be decided only
  // after the thing it is meant to bound had already been pulled into memory.
  const head = source.match(/async function firstBytes[\s\S]*?\n}/)?.[0] ?? '';
  expect(head).toContain('readableStream()');
  expect(head).toContain('filled < count');
  expect(head).toContain('reader.cancel()');
});

test('a manifest is held to the manifest limit before the whole file is read', () => {
  // Since the document type went live, any app on the device can hand this one
  // a file. Reading 25 MiB and rejecting it afterwards would make that a way to
  // spend the app's memory at will, so the smaller ceiling has to land first.
  expect(reader).toContain('THEME_LIMITS.manifestBytes');
  const ceiling = reader.indexOf('THEME_LIMITS.manifestBytes');
  const read = reader.indexOf('file.bytes()');
  expect(ceiling).toBeGreaterThan(-1);
  expect(read).toBeGreaterThan(-1);
  expect(ceiling).toBeLessThan(read);
});

test('the form is settled before the whole file is read', () => {
  expect(reader.indexOf('isZipArchive(')).toBeLessThan(reader.indexOf('file.bytes()'));
});

test('both hand-off schemes reach the reader', () => {
  const hook = readFileSync('src/hooks/use-theme-file-open.ts', 'utf8');
  expect(hook).toContain("startsWith('file://')");
  expect(hook).toContain("startsWith('content://')");
});

test('nothing is done to the handed-over string outside the catch', () => {
  // `decodeURIComponent` throws on malformed percent-encoding, and the string
  // comes from whichever app invoked the share sheet. Out here that was an
  // unhandled rejection anyone could trigger by sending `%zz.muqun-theme`.
  const hook = readFileSync('src/hooks/use-theme-file-open.ts', 'utf8');
  const body = hook.match(/try \{[\s\S]*?\n {6}\} catch/)?.[0] ?? '';
  expect(body).toContain('decodeURIComponent(');
  expect(body).toContain('readThemeFile(');
});

test('a file from outside the app is previewed, never applied', () => {
  // The one property that matters for a file arriving from a message: it is as
  // unreviewed as one picked by hand, so it stops at the preview.
  const hook = readFileSync('src/hooks/use-theme-file-open.ts', 'utf8');
  expect(hook).toContain('openThemeEditor(preview)');
  expect(hook).not.toContain('apply(');
  expect(hook).not.toContain('save(');
});

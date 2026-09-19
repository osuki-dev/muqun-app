import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

import {
  findSfntTable,
  fontFamilyName,
  fontFamilyNameFromNameTable,
  sfntDirectoryBytes,
  sfntTableCount,
  userFontLabel,
  userFontSource,
  FONT_NAME_TABLE_MAX_BYTES,
  SFNT_DIRECTORY_ENTRY_BYTES,
  SFNT_HEADER_BYTES,
} from '@/theme/user-font-file';

/**
 * The `name` table reader, against real fonts and against tables built by hand.
 *
 * Both halves are needed and neither is sufficient. A real font proves the
 * parser agrees with what foundries actually ship -- which is the only
 * definition of correct that matters, since the app never sees a font it
 * wrote. A hand-built table is the only way to reach the cases a tidy font
 * never produces: a Macintosh record with an accent in it, a nameID 16 that
 * disagrees with nameID 1, an offset that points past the end of the file.
 *
 * The one fixture that must always be here is the app's own bundled terminal
 * face, because it is in the repository. The system fonts below are read when
 * the machine has them and skipped when it does not, so this passes on a CI
 * runner with no fonts installed while still being checked against five
 * different foundries' idea of a `name` table on a developer's machine.
 */
const BUNDLED = 'assets/fonts/JetBrainsMonoNerdFontMono-Regular.ttf';

function bytes(path: string): Uint8Array {
  return new Uint8Array(readFileSync(path));
}

test('reads the family name out of the font the app ships', () => {
  expect(fontFamilyName(bytes(BUNDLED))).toBe('JetBrainsMono Nerd Font Mono');
});

test('reads the family name out of whichever system faces are installed', () => {
  // Five foundries, four of them italic, and one CFF/`OTTO` face rather than a
  // `glyf` one -- the table directory is the same in both and this is what
  // says so out loud.
  const expected: Record<string, string> = {
    '/usr/share/fonts/noto/NotoSans-Italic.ttf': 'Noto Sans',
    '/usr/share/fonts/gsfonts/NimbusSans-Italic.otf': 'Nimbus Sans',
    '/usr/share/fonts/ttf-ia-writer/iAWriterDuoS-Italic.ttf': 'iA Writer Duo S',
    '/usr/share/fonts/Adwaita/AdwaitaSans-Italic.ttf': 'Adwaita Sans',
  };
  const present = Object.keys(expected).filter((path) => existsSync(path));
  for (const path of present) {
    expect(`${path}: ${fontFamilyName(bytes(path))}`).toBe(`${path}: ${expected[path]}`);
  }
});

test('an italic file still reports the family, not the style', () => {
  // The point of preferring nameID 16 and then 1 over 4: a reader who installs
  // `NotoSans-Italic.ttf` wants the row to say Noto Sans, not Noto Sans Italic
  // and certainly not NotoSans-Italic.
  const path = '/usr/share/fonts/noto/NotoSans-Italic.ttf';
  if (!existsSync(path)) return;
  const name = fontFamilyName(bytes(path)) ?? '';
  expect(name.toLowerCase()).not.toContain('italic');
});

test('the header says how big the directory is', () => {
  const head = bytes(BUNDLED);
  const count = sfntTableCount(head);
  expect(count).not.toBeNull();
  expect(count).toBeGreaterThan(5);
  expect(sfntDirectoryBytes(count ?? 0)).toBe(
    SFNT_HEADER_BYTES + (count ?? 0) * SFNT_DIRECTORY_ENTRY_BYTES
  );
  const table = findSfntTable(head, 'name');
  expect(table).not.toBeNull();
  expect(table?.length).toBeGreaterThan(0);
  expect(table?.length).toBeLessThanOrEqual(FONT_NAME_TABLE_MAX_BYTES);
});

test('anything that is not a truetype or opentype file has no table count', () => {
  // The install path already refuses these, and this is the second line: a
  // WOFF's header has a table count in the same place and means something
  // else by it.
  expect(
    sfntTableCount(new Uint8Array([0x77, 0x4f, 0x46, 0x46, 0, 10, 0, 0, 0, 0, 0, 0]))
  ).toBeNull();
  expect(
    sfntTableCount(new Uint8Array([0x74, 0x74, 0x63, 0x66, 0, 10, 0, 0, 0, 0, 0, 0]))
  ).toBeNull();
  expect(sfntTableCount(new Uint8Array([0, 1, 0, 0]))).toBeNull();
  // An sfnt header claiming no tables at all, and one claiming more than any
  // font has: both are a file lying about its own shape.
  expect(sfntTableCount(new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  expect(sfntTableCount(new Uint8Array([0, 1, 0, 0, 0xff, 0xff, 0, 0, 0, 0, 0, 0]))).toBeNull();
});

/** A `name` table, built record by record, so the awkward cases can be reached. */
function nameTable(
  records: { platform: number; encoding: number; language: number; id: number; text: string }[]
): Uint8Array {
  const encoded = records.map((record) => {
    if (record.platform === 1) {
      // Mac Roman: one byte per character, and the high half is the table the
      // parser carries. Only Latin-1 code points that happen to line up are
      // written here; the accented case below writes its byte directly.
      return Uint8Array.from([...record.text].map((character) => character.charCodeAt(0) & 0xff));
    }
    const out = new Uint8Array(record.text.length * 2);
    [...record.text].forEach((character, index) => {
      const code = character.charCodeAt(0);
      out[index * 2] = code >> 8;
      out[index * 2 + 1] = code & 0xff;
    });
    return out;
  });

  const stringOffset = 6 + records.length * 12;
  const strings = encoded.reduce((total, one) => total + one.length, 0);
  const table = new Uint8Array(stringOffset + strings);
  const view = new DataView(table.buffer);
  view.setUint16(0, 0); // format 0
  view.setUint16(2, records.length);
  view.setUint16(4, stringOffset);

  let cursor = 0;
  records.forEach((record, index) => {
    const at = 6 + index * 12;
    const body = encoded[index] ?? new Uint8Array();
    view.setUint16(at, record.platform);
    view.setUint16(at + 2, record.encoding);
    view.setUint16(at + 4, record.language);
    view.setUint16(at + 6, record.id);
    view.setUint16(at + 8, body.length);
    view.setUint16(at + 10, cursor);
    table.set(body, stringOffset + cursor);
    cursor += body.length;
  });
  return table;
}

test('the typographic family beats the four-style family name', () => {
  // The case nameID 16 exists for. The old model could carry four styles per
  // family, so a foundry shipping nine weights had to put the weight in the
  // nameID 1 family to keep the menus working, and stated the real family in
  // nameID 16. A row that says `Iosevka` is the one the reader meant.
  const table = nameTable([
    { platform: 3, encoding: 1, language: 0x0409, id: 1, text: 'Iosevka Term SemiBold Extended' },
    { platform: 3, encoding: 1, language: 0x0409, id: 16, text: 'Iosevka Term' },
    { platform: 3, encoding: 1, language: 0x0409, id: 4, text: 'Iosevka Term SemiBold Extended' },
  ]);
  expect(fontFamilyNameFromNameTable(table)).toBe('Iosevka Term');
});

test('the full name is taken only when there is no family name', () => {
  const table = nameTable([
    { platform: 3, encoding: 1, language: 0x0409, id: 4, text: 'Subset Face Regular' },
    // Not a name this asks for, and not a name it may fall back to either.
    { platform: 3, encoding: 1, language: 0x0409, id: 5, text: 'Version 1.004' },
  ]);
  expect(fontFamilyNameFromNameTable(table)).toBe('Subset Face Regular');
});

test('a Windows record is preferred over a Macintosh one for the same name', () => {
  const table = nameTable([
    { platform: 1, encoding: 0, language: 0, id: 1, text: 'Mac Spelling' },
    { platform: 3, encoding: 1, language: 0x0409, id: 1, text: 'Windows Spelling' },
  ]);
  expect(fontFamilyNameFromNameTable(table)).toBe('Windows Spelling');
});

test('an English record is preferred over the same name in another language', () => {
  const table = nameTable([
    { platform: 3, encoding: 1, language: 0x0411, id: 1, text: '源ノ角ゴ' },
    { platform: 3, encoding: 1, language: 0x0409, id: 1, text: 'Source Han Sans' },
  ]);
  expect(fontFamilyNameFromNameTable(table)).toBe('Source Han Sans');
});

test('a font with no English record is still read in its own language', () => {
  const table = nameTable([
    { platform: 3, encoding: 1, language: 0x0804, id: 1, text: '思源黑体' },
  ]);
  expect(fontFamilyNameFromNameTable(table)).toBe('思源黑体');
});

test('a Macintosh record decodes through the Mac Roman table, not as Latin-1', () => {
  // 0x8E is Mac Roman's e-acute. In Latin-1 the same byte is a capital Z with
  // caron, and reading a Macintosh record that way is how a font called
  // `Crème` turns up in a menu as `CrŽme`. The whole 128-entry upper half is
  // checked against Python's own `mac_roman` codec, entry for entry.
  const body = Uint8Array.from([0x43, 0x72, 0x8e, 0x6d, 0x65]);
  const full = new Uint8Array(6 + 12 + body.length);
  const view = new DataView(full.buffer);
  view.setUint16(0, 0);
  view.setUint16(2, 1);
  view.setUint16(4, 18);
  view.setUint16(6, 1); // Macintosh
  view.setUint16(8, 0); // Roman
  view.setUint16(10, 0); // English
  view.setUint16(12, 1); // family
  view.setUint16(14, body.length);
  view.setUint16(16, 0);
  full.set(body, 18);
  expect(fontFamilyNameFromNameTable(full)).toBe('Créme');
});

test('a record whose string runs past the end of the table is skipped', () => {
  const table = nameTable([
    { platform: 3, encoding: 1, language: 0x0409, id: 1, text: 'Honest Name' },
  ]);
  // Claim the string is far longer than the table. The parser must not read
  // whatever is next in memory, and must not throw: this is a file a
  // stranger's server sent us.
  new DataView(table.buffer).setUint16(6 + 8, 0xffff);
  expect(fontFamilyNameFromNameTable(table)).toBeNull();
});

test('a truncated or empty table is no name rather than a crash', () => {
  expect(fontFamilyNameFromNameTable(new Uint8Array())).toBeNull();
  expect(fontFamilyNameFromNameTable(new Uint8Array([0, 0, 0, 3]))).toBeNull();
  // A count that does not fit in the bytes provided.
  const short = new Uint8Array([0, 0, 0, 40, 0, 6]);
  expect(fontFamilyNameFromNameTable(short)).toBeNull();
});

test('control characters and byte-order marks are not part of a name', () => {
  const table = nameTable([
    { platform: 3, encoding: 1, language: 0x0409, id: 1, text: '﻿Tidy  Face ' },
  ]);
  expect(fontFamilyNameFromNameTable(table)).toBe('Tidy Face');
});

test('a name longer than a row is cut to a row', () => {
  const table = nameTable([
    { platform: 3, encoding: 1, language: 0x0409, id: 1, text: 'A'.repeat(90) },
  ]);
  expect((fontFamilyNameFromNameTable(table) ?? '').length).toBeLessThanOrEqual(48);
});

test('the source caption is a host, a file name, or nothing', () => {
  expect(userFontSource('https://fonts.example/v2/a1b2/Iosevka.ttf?cache=31')).toBe(
    'fonts.example'
  );
  expect(userFontSource('LXGW WenKai Mono.ttf')).toBe('LXGW WenKai Mono.ttf');
  expect(userFontSource('https://cdn.example/f/%E6%80%9D%E6%BA%90.otf')).toBe('cdn.example');
  // The Android document id that put `msf:13397` on the Font row. It is not a
  // place, so it is not a caption.
  expect(userFontSource('msf%3A13397')).toBeNull();
  expect(userFontSource('msf:13397')).toBeNull();
  expect(userFontSource('   ')).toBeNull();
});

test('the file-name label is still the fallback it always was', () => {
  // Unchanged behaviour, pinned because it is now reached only when the font
  // will not name itself -- which is rarer and therefore easier to break
  // without noticing.
  expect(userFontLabel('https://fonts.example/download/Iosevka_Term-Regular.ttf?v=31.4')).toBe(
    'Iosevka Term-Regular'
  );
  expect(userFontLabel('LXGW WenKai Mono.ttf')).toBe('LXGW WenKai Mono');
});

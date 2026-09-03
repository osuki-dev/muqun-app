/**
 * Fill the empty `msgstr` entries of one catalog from a JSON map.
 *
 * Editing a `.po` by hand at the scale of a fifty-message extract is how a
 * catalog picks up a stray quote or a translation attached to the wrong id, and
 * neither shows up until the screen renders. This does the mechanical half:
 *
 *     bun scripts/fill-po.ts <locale> <map.json>
 *
 * where `map.json` is `{ "<msgid>": "<translation>" }`. Only entries whose
 * `msgstr` is currently empty are touched, so re-running is safe and an existing
 * translation is never overwritten. Anything in the map that does not match an
 * empty entry is reported rather than silently dropped -- a typo in a msgid is
 * otherwise indistinguishable from a message that was already done.
 */
/// <reference types="node" />
import { readFileSync, writeFileSync } from 'node:fs';

/** PO escaping: backslash and double quote, plus the newline that ends a line. */
function escapePo(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function main(): void {
  const [locale, mapPath] = process.argv.slice(2);
  if (!locale || !mapPath) {
    console.error('usage: bun scripts/fill-po.ts <locale> <map.json>');
    process.exit(2);
  }

  const poPath = `src/i18n/locales/${locale}/messages.po`;
  const po = readFileSync(poPath, 'utf8');
  const map = JSON.parse(readFileSync(mapPath, 'utf8')) as Record<string, string>;

  const used = new Set<string>();
  let filled = 0;

  // Only `msgid "..."` immediately followed by an empty `msgstr ""` that ends
  // the entry. A multi-line body is written as `msgstr ""` plus continuation
  // lines, so requiring a blank line or end-of-file after it leaves those alone.
  const next = po.replace(/^msgid "(.+)"\nmsgstr ""$/gm, (whole, rawId: string) => {
    // The id as it appears in the file is escaped; the map is written in plain
    // text, so unescape before looking it up.
    const id = rawId.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    const translation = map[id];
    if (translation === undefined) return whole;
    used.add(id);
    filled += 1;
    return `msgid "${rawId}"\nmsgstr "${escapePo(translation)}"`;
  });

  writeFileSync(poPath, next);

  const unused = Object.keys(map).filter((id) => !used.has(id));
  console.log(`${locale}: filled ${filled}`);
  if (unused.length > 0) {
    console.log(`  ${unused.length} map entries matched nothing:`);
    for (const id of unused) console.log(`    ${JSON.stringify(id)}`);
  }
}

main();

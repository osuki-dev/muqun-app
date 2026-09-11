import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Remove a closing full stop, not an ellipsis or punctuation inside a message. */
export function withoutClosingFullStop(value: string): string {
  return value.replace(/(?<!\.)[.。．](\s*)$/u, '$1');
}

export function normalizeCatalog(source: string): string {
  return source.replace(/^msgstr(?:\[\d+\])? (".*")(?:\n".*")*/gm, (block) => {
    const lines = block.split('\n');
    const prefix = lines[0].slice(0, lines[0].indexOf('"'));
    const value = lines
      .map((line, index) => JSON.parse(index === 0 ? line.slice(prefix.length) : line) as string)
      .join('');
    const normalized = withoutClosingFullStop(value);
    return normalized === value ? block : `${prefix}${JSON.stringify(normalized)}`;
  });
}

if (import.meta.main) {
  const root = new URL('../src/i18n/locales/', import.meta.url).pathname;
  let changed = 0;
  for (const locale of await readdir(root, { withFileTypes: true })) {
    if (!locale.isDirectory()) continue;
    const path = join(root, locale.name, 'messages.po');
    const source = await readFile(path, 'utf8');
    const normalized = normalizeCatalog(source);
    if (normalized !== source) {
      await writeFile(path, normalized);
      changed += 1;
    }
  }
  console.log(`Normalized closing full stops in ${changed} catalogs`);
}

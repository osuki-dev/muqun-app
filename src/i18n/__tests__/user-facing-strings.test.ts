// Every key and command needs a descriptor; the wording belongs to the catalogs.
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EDITOR_ACTIONS,
  keyboardCombinationKeys,
  terminalKeysForPane,
  withEditorActions,
  type TerminalKey,
} from '@/lib/terminal-keys';

const I18N = dirname(fileURLToPath(import.meta.url));
const SRC = join(I18N, '..', '..');

const labelsSource = readFileSync(join(I18N, '..', 'labels.ts'), 'utf8');

function descriptorKeys(table: string): Set<string> {
  const block = labelsSource.match(new RegExp(`export const ${table}[^{]*\\{([\\s\\S]*?)\\n\\};`));
  if (!block) throw new Error(`no table called ${table} in labels.ts`);
  const keys = [...block[1].matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*)):\s*msg`/gm)].map(
    (match) => match[1] ?? match[2]
  );
  return new Set(keys);
}

describe('every key the terminal row can show says what it does', () => {
  const editorActions = descriptorKeys('editorActionDescription');
  const keyDescriptions = descriptorKeys('terminalKeyDescription');

  const everyKey: TerminalKey[] = [
    ...terminalKeysForPane(null, null),
    ...terminalKeysForPane('claude'),
    ...terminalKeysForPane('codex'),
    ...terminalKeysForPane('qodercli'),
    ...terminalKeysForPane(null, 'nvim'),
    ...withEditorActions([]),
    ...EDITOR_ACTIONS,
    ...keyboardCombinationKeys(withEditorActions(terminalKeysForPane(null, 'nvim'))),
  ];

  test('each key resolves to a translated accessibility descriptor', () => {
    expect(everyKey.length).toBeGreaterThan(0);
    expect(keyDescriptions.size).toBeGreaterThan(0);
    const undescribed = everyKey
      .filter((key) => !editorActions.has(key.key) && !keyDescriptions.has(key.accessibilityLabel))
      .map((key) => `${key.key}: ${key.accessibilityLabel}`);
    expect([...new Set(undescribed)]).toEqual([]);
  });
});

describe('every built-in quick command has a translated name', () => {
  const source = readFileSync(join(SRC, 'lib', 'quick-commands.ts'), 'utf8');
  const names = descriptorKeys('quickCommandName');

  const defaultIds = [...source.matchAll(/id:\s*'([^']+)',\s*\n?\s*label:\s*'/g)].map(
    (match) => match[1]
  );

  test('each id has an entry, so no row falls back to its English label', () => {
    expect(defaultIds.length).toBeGreaterThan(0);
    const englishIds = new Set(
      [...source.matchAll(/\{[^{}]*id:\s*'([^']+)'[^{}]*labelLanguage:\s*'en'[^{}]*\}/g)].map(
        (match) => match[1]
      )
    );
    const missing = defaultIds.filter((id) => !names.has(id) && !englishIds.has(id));
    expect(missing).toEqual([]);
  });
});

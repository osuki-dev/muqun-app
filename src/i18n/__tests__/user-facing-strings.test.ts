// Descriptor coverage remains a Bun test; message extraction and validation use the Lingui CLI.
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

/**
 * The label tables are read as text, not imported.
 *
 * `labels.ts` is nothing but `msg` macros, and Bun does not expand them -- an
 * import here would either throw or hand back something that is not the table.
 * `catalogs.test.ts` reads the same file the same way and for the same reason.
 */
const labelsSource = readFileSync(join(I18N, '..', 'labels.ts'), 'utf8');

/** The keys of one exported `Record<string, MessageDescriptor>` in `labels.ts`. */
function descriptorKeys(table: string): Set<string> {
  const block = labelsSource.match(new RegExp(`export const ${table}[^{]*\\{([\\s\\S]*?)\\n\\};`));
  if (!block) throw new Error(`no table called ${table} in labels.ts`);
  const keys = [...block[1].matchAll(/^\s*(?:'([^']+)'|([A-Za-z_$][\w$]*)):\s*msg`/gm)].map(
    (match) => match[1] ?? match[2]
  );
  return new Set(keys);
}

// The key row is the surface this check was written for.
//
// Until it existed, `editorActionDescription` covered the fifteen `nvim:`
// actions and nothing else, and every other key on the row -- `esc`, `⌃C`, the
// arrows, the whole shell editing set, everything each agent advertises -- was
// spoken to a screen reader in English, in all eight languages, because
// `terminal-keys.ts` is pure and its `accessibilityLabel` had nowhere to be
// translated. That is roughly fifty strings, and none of them was a type error.
describe('every key the terminal row can show says what it does', () => {
  const editorActions = descriptorKeys('editorActionDescription');
  const keyDescriptions = descriptorKeys('terminalKeyDescription');

  /**
   * Every key the row can ever draw.
   *
   * Built by asking the module rather than by listing them here: the tables
   * inside it are private, and a second list maintained by hand is a list that
   * drifts and then passes.
   */
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

  test('the sweep found the real tables, not an empty list', () => {
    expect(everyKey.length).toBeGreaterThan(40);
    expect(keyDescriptions.size).toBeGreaterThan(20);
  });

  test('each one resolves to a descriptor rather than to its English label', () => {
    // The same order the screen resolves them in: the action identity first,
    // because `nvim:w` has a real sentence behind it, then the English label,
    // which is the only thing telling the three different `ctrl+r` rows apart.
    const undescribed = everyKey
      .filter((key) => !editorActions.has(key.key) && !keyDescriptions.has(key.accessibilityLabel))
      .map((key) => `${key.key}: ${key.accessibilityLabel}`);
    expect([...new Set(undescribed)]).toEqual([]);
  });
});

// The quick-command sheet, held to the same bar for the same reason:
// `quick-commands.ts` persists to SecureStore, so it is read as text rather than
// imported. The `value` of each command -- `git status --short`, and the
// sentences addressed to an agent -- stays English on purpose: it is input for a
// shell or a model, not copy about one.
describe('every built-in quick command has a translated name', () => {
  const source = readFileSync(join(SRC, 'lib', 'quick-commands.ts'), 'utf8');
  const names = descriptorKeys('quickCommandName');

  /** `{ id: 'terminal-status', label: 'Git status'` -> `terminal-status`. */
  const defaultIds = [...source.matchAll(/id:\s*'([^']+)',\s*\n?\s*label:\s*'/g)].map(
    (match) => match[1]
  );

  test('the defaults were actually found', () => {
    expect(defaultIds.length).toBeGreaterThanOrEqual(15);
  });

  test('each id has an entry, so no row falls back to its English label', () => {
    // Bundled authoring skills may explicitly keep their command label English.
    // This is metadata on that command, not a blanket exemption for shortcuts.
    const englishIds = new Set(
      [...source.matchAll(/\{[^{}]*id:\s*'([^']+)'[^{}]*labelLanguage:\s*'en'[^{}]*\}/g)].map(
        (match) => match[1]
      )
    );
    const missing = defaultIds.filter((id) => !names.has(id) && !englishIds.has(id));
    expect(missing).toEqual([]);
  });
});

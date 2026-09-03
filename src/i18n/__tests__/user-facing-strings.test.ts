// The other half of "is this screen translated", and the half a compiler cannot
// see.
//
// `macro-expansion.test.ts` beside this one catches a string that was *offered*
// to Lingui and did not arrive: a `` t`...` `` whose macro never expanded. This
// catches the string that was never offered at all -- a literal written straight
// into `title=`, `accessibilityLabel=`, an `Alert`, or between two tags. Nothing
// about that is a type error, nothing throws, and it reads perfectly in review;
// it is only visible on a phone set to a language the app claims to speak, which
// is where it was found.
//
// Two kinds of assertion here, because there are two ways a surface stays
// English:
//
//  1. **A raw literal in a user-facing prop.** `scripts/i18n-audit.ts` walks the
//     real TypeScript AST for these. Run it by hand for a readable report:
//     `bun scripts/i18n-audit.ts`.
//  2. **A descriptor table with a hole in it.** The pure modules -- the ones
//     `bun test` imports, and which therefore cannot contain a macro -- keep
//     their copy as English source data and are translated through a table in
//     `@/i18n/labels`. A key with no entry in that table falls through to the
//     English, silently. The scanner is deliberately quiet about those modules
//     (`DESCRIPTOR_BACKED`), so the coverage checks below are the only thing
//     standing behind them.
//
// Both directions matter. Either one alone passes while the app renders English.
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EDITOR_ACTIONS,
  terminalKeysForPane,
  withEditorActions,
  type TerminalKey,
} from '@/lib/terminal-keys';

import { auditUserFacingStrings, auditedFileCount } from '../../../scripts/i18n-audit';

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

describe('no user-facing string is written as a raw literal', () => {
  test('the scan reaches the whole tree, or it is not proving anything', () => {
    // A walk that silently stopped finding files would report zero findings and
    // look like success. This is what tells the two apart.
    expect(auditedFileCount()).toBeGreaterThan(150);
  });

  test('every literal reaching a user-facing prop goes through a macro', () => {
    const findings = auditUserFacingStrings();
    // Reported as `file:line  prop = "text"` so a failure names the screen
    // rather than handing back an object graph to squint at.
    const readable = findings.map(
      (finding) =>
        `${finding.file}:${finding.line}  ${finding.sink} = ${JSON.stringify(finding.text)}`
    );
    // A hit is a string that will render in English on all eight languages.
    // Fix it with a hook-bound `t`/`<Trans>`, or -- if the module is pure and
    // cannot hold a macro -- with a descriptor in `@/i18n/labels` plus a
    // coverage assertion below. If it is genuinely not copy, it goes in the
    // scanner's `ALLOWED` list with the reason written out.
    expect(readable).toEqual([]);
  });
});

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
    const missing = defaultIds.filter((id) => !names.has(id));
    expect(missing).toEqual([]);
  });
});

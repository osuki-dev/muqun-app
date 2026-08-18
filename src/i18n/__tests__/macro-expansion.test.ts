// The failure mode this file exists for is silent, and it shipped once.
//
// `@lingui/babel-plugin-lingui-macro` rewrites ``t`Message` `` only where it can
// walk the identifier back to the very `const { t } = useLingui()` it came from.
// A `t` that arrives some other way -- most easily as a function parameter, the
// obvious way to share a translated helper between a component and a module
// function -- is a different binding, and the plugin leaves the tagged template
// completely alone. Nothing errors. The extractor never sees the string, so it
// is absent from the catalog; at run time Lingui's `_` is called with a raw
// template-strings array, finds no id on it, and answers with an empty string.
//
// The visible result is a control with no words in it. That is what emptied the
// four kind-filter chips in the Files sheet, and what would have shipped three
// blank rename labels and five blank lock-screen errors with them.
//
// So: every plain ``t`...` `` literal in the source has to be in the English
// catalog. If it is not, the macro did not run on it, and the screen it belongs
// to renders a blank.
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { messages as enMessages } from '../locales/en/messages';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Only literals with no `${}` in them.
 *
 * An interpolated message is stored in the catalog as a token array rather than
 * a string, and matching those back to source text means reimplementing the
 * extractor. The simple literals are the overwhelming majority and they catch
 * the bug just as well: a helper that lost the macro loses all of its strings,
 * not the plain ones only.
 */
const PLAIN_T_LITERAL = /(?<![\w$.])t`([^`$\\]*)`/g;

/**
 * The same shape for `` msg`...` ``, which has the same failure and a worse one.
 *
 * `msg` is how every descriptor table in `labels.ts` is written, and how a
 * module-scope options array has to be written -- a `t` at module scope
 * evaluates once, at import, in whatever locale was active then, which is
 * English. So the descriptors are the mechanism the pure modules and the
 * module-scope tables both rest on, and a `msg` the macro did not expand fails
 * exactly as a `t` does: no catalog entry, and `_()` answering with an empty
 * string.
 *
 * Worse, because a descriptor is inert. A broken `` t`...` `` is at least
 * translated where it is written; a broken `` msg`...` `` is passed around as
 * data and turns into a blank at a call site nowhere near the mistake.
 */
const PLAIN_MSG_LITERAL = /(?<![\w$.])msg`([^`$\\]*)`/g;

/**
 * Comments come out first, and that is not tidiness.
 *
 * This codebase explains itself in prose, and the prose about Lingui is full of
 * `` `t` `` in backticks -- which is the very shape being searched for. Left in,
 * every one of those paragraphs reads as an unextracted message and the test
 * reports thirty failures that are all sentences.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Whitespace inside a template is collapsed by the extractor; match that. */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Every English source string the compiled catalog knows, normalized. */
const catalogStrings = new Set(
  Object.values(enMessages as Record<string, unknown>)
    .map((value) => {
      if (typeof value === 'string') return value;
      // The compiled form of a message with no placeholders: a one-element
      // array holding the string.
      if (Array.isArray(value) && value.length === 1 && typeof value[0] === 'string') {
        return value[0];
      }
      return null;
    })
    .filter((value): value is string => value !== null)
    .map(normalize)
);

/** Every `.ts`/`.tsx` under `src/`, minus the tests and the catalogs. */
function sourceFiles(directory = SRC): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'locales') continue;
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(path);
    }
  }
  return found;
}

describe('the Lingui macro actually ran', () => {
  test('the scan finds something, or it is not proving anything', () => {
    const files = sourceFiles();
    expect(files.length).toBeGreaterThan(20);

    const literals = files.flatMap((path) => [
      ...stripComments(readFileSync(path, 'utf8')).matchAll(PLAIN_T_LITERAL),
    ]);
    expect(literals.length).toBeGreaterThan(50);
  });

  test('every plain t`...` literal reached the English catalog', () => {
    const missing: string[] = [];

    for (const path of sourceFiles()) {
      const source = stripComments(readFileSync(path, 'utf8'));
      for (const match of source.matchAll(PLAIN_T_LITERAL)) {
        const message = normalize(match[1]);
        if (!message) continue;
        if (!catalogStrings.has(message)) {
          missing.push(`${path.slice(SRC.length + 1)}: ${message}`);
        }
      }
    }

    // A miss here is one of exactly two things, and both are bugs: the macro
    // did not expand (a `t` that is not the hook's own binding), or an extract
    // was never re-run after the string was written.
    expect(missing).toEqual([]);
  });

  test('the msg scan finds something too', () => {
    const literals = sourceFiles().flatMap((path) => [
      ...stripComments(readFileSync(path, 'utf8')).matchAll(PLAIN_MSG_LITERAL),
    ]);
    // The label tables alone are well past this; a number near zero means the
    // pattern stopped matching, not that the descriptors went away.
    expect(literals.length).toBeGreaterThan(40);
  });

  test('every plain msg`...` literal reached the English catalog', () => {
    const missing: string[] = [];

    for (const path of sourceFiles()) {
      const source = stripComments(readFileSync(path, 'utf8'));
      for (const match of source.matchAll(PLAIN_MSG_LITERAL)) {
        const message = normalize(match[1]);
        if (!message) continue;
        if (!catalogStrings.has(message)) {
          missing.push(`${path.slice(SRC.length + 1)}: ${message}`);
        }
      }
    }

    // Same two causes as above, and one more that only `msg` has: a descriptor
    // written in a module the extractor is not configured to read is a table
    // that compiles, type-checks, and hands every call site a blank.
    expect(missing).toEqual([]);
  });
});

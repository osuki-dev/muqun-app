// The rule this file exists to keep: no reanimated hook in `src/` is handed a
// dependency list.
//
// reanimated 4.6 ignores the list -- the hook re-registers from the closures of
// its worklets plus their hashes, which is a superset of anything the list could
// say -- and warns, on native, per render, that it did. That warning is not
// quiet: it arrives several hundred times in a session, and LogBox answers it
// with a notification pinned across the bottom of the screen. On the SSH shell
// the notification lands exactly on `ssh-composer-input`, so the first tap on
// the composer goes to the notification and dismisses it and only the second
// reaches the field.
//
// `src/app/_layout.tsx` silences the warning by its exact text, because the
// remaining sources are libraries (keyboard-controller, gesture-handler) and
// there is nothing this repo can do about those until they release. That mute
// is why this test is here: it would hide a call site of *ours* just as
// happily, and a hand scan is what missed the one in
// `ssh-terminal-workspace.tsx` when the arrays were removed from the terminal
// during the September 2026 upgrade.
//
// The scan walks the real TypeScript AST rather than the text, so a dependency
// list written in a comment or inside a string is not a finding and one written
// across four lines is.
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The reanimated hooks whose last argument is a dependency list.
 *
 * `useFrameCallback` is deliberately absent: its second argument is
 * `autostart`, a boolean, and it is the one two-argument reanimated call in the
 * tree that is written correctly.
 */
const HOOKS_WITH_DEPENDENCIES = new Set([
  'useAnimatedGestureHandler',
  'useAnimatedKeyboardHandler',
  'useAnimatedProps',
  'useAnimatedReaction',
  'useAnimatedScrollHandler',
  'useAnimatedStyle',
  'useDerivedValue',
  'useHandler',
]);

interface Finding {
  file: string;
  line: number;
  hook: string;
}

function sourceFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(path);
  }
  return found;
}

function findDependencyLists(): { findings: Finding[]; fileCount: number } {
  const files = sourceFiles(SRC);
  const findings: Finding[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    // Cheap first pass: most of the tree never mentions one of these names, and
    // parsing every file to learn that costs seconds.
    if (![...HOOKS_WITH_DEPENDENCIES].some((hook) => text.includes(hook))) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const hook = node.expression.text;
        const last = node.arguments.at(-1);
        if (HOOKS_WITH_DEPENDENCIES.has(hook) && last && ts.isArrayLiteralExpression(last)) {
          findings.push({
            file: relative(SRC, file),
            line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
            hook,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { findings, fileCount: files.length };
}

describe('no reanimated hook is passed a dependency list', () => {
  const { findings, fileCount } = findDependencyLists();

  test('the scan reaches the whole tree, or it is not proving anything', () => {
    // A walk that silently stopped finding files would report zero findings and
    // look like success. This is what tells the two apart.
    expect(fileCount).toBeGreaterThan(150);
  });

  test('every call site re-registers from its closures instead', () => {
    expect(findings.map(({ file, line, hook }) => `${file}:${line} ${hook}`)).toEqual([]);
  });
});

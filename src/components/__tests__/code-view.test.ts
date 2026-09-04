// The rule this file exists to keep: opening a file never builds a tree the
// size of the file.
//
// Card #661 was a phone locking up for seconds on a 200 KB artifact. It was not
// the download, not the AES-GCM unseal and not the tokenizer -- it was
// `CodeView` mounting a `<Text>` per line, ten thousand of them, on the frame
// the sheet opened. The fix is that only the rows on screen exist, and that the
// tokenizer runs after the first paint rather than before it.
//
// Neither half can be checked by types, lint or a render test (this repo has no
// renderer), and both are the kind of thing a later refactor undoes without
// noticing: `<LegendList>` back to `<ScrollView>` reads like a simplification,
// and a `useMemo` around `highlightFile` reads like an optimization. So the
// scan reads the real TypeScript AST, scopes itself to `CodeView` by name, and
// fails loudly if it is gone -- a rename is a finding here, not a silent pass.
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const VIEW = join(dirname(fileURLToPath(import.meta.url)), '..', 'code-view.tsx');
const TEXT = readFileSync(VIEW, 'utf8');

/** The source of one function in the file, by name. */
function functionSource(name: string): string {
  const source = ts.createSourceFile(VIEW, TEXT, ts.ScriptTarget.Latest, true);
  let found: string | undefined;
  const visit = (node: ts.Node) => {
    if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) &&
      node.name?.text === name
    ) {
      found = node.getText(source);
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (found === undefined) {
    throw new Error(`${name} is not a function of code-view.tsx any more`);
  }
  return found;
}

describe('a file is drawn a screenful at a time', () => {
  const view = functionSource('CodeView');

  test('the lines go through a virtualized list', () => {
    expect(TEXT).toContain("from '@legendapp/list/react-native'");
    expect(view).toContain('<LegendList');
    expect(view).toContain('estimatedItemSize={LINE_HEIGHT}');
  });

  test('a row is exactly one line tall, so the estimate is never wrong', () => {
    // A row that can wrap to two lines makes every offset the list has already
    // computed wrong, and a virtualized list with wrong offsets scrolls to the
    // wrong place and then jumps when it finds out.
    const row = functionSource('CodeRow');
    expect(row).toContain('numberOfLines={1}');
    expect(TEXT).toContain('height: LINE_HEIGHT,');
  });

  test('the scrollable width is decided once, not by whichever rows are mounted', () => {
    // A virtualized list only knows the rows it has, so letting the content
    // size itself makes the horizontal extent move as the reader scrolls.
    expect(view).toContain('longestLineOf(plain.lines)');
    expect(view).toContain('const contentWidth = Math.max(');
  });
});

describe('the tokenizer runs after the first paint', () => {
  const view = functionSource('CodeView');

  test('the first frame is the plain split', () => {
    expect(view).toContain('plainFile(content)');
    expect(view).toContain('const result = coloured ?? plain;');
  });

  test('highlighting is scheduled, never called while rendering', () => {
    // One call site, and it is inside the callback. `highlightFile` on 64 KiB
    // is tens of uninterruptible milliseconds on a phone; run from the render
    // body it is tens of milliseconds the sheet spends unable to be closed.
    const calls = TEXT.split('highlightFile(').length - 1;
    expect(calls).toBe(1);
    const scheduled = view.indexOf('InteractionManager.runAfterInteractions(');
    expect(scheduled).toBeGreaterThan(-1);
    expect(view.indexOf('highlightFile(')).toBeGreaterThan(scheduled);
  });
});

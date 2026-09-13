// One rule, and it is invisible to every other gate in the repo.
//
// A pane window is filed in the cache under a `shape` string and handed back
// only to a recall that asks for the identical string (`recallPaneWindow`
// refuses on any mismatch -- see `lib/pane-cache`). Nothing checks that the two
// sides spell it the same way. Types cannot: both sides are `string`. Lint
// cannot. The test suite cannot even import the screen -- `react-native`'s
// entry point is Flow, so a runtime test of this module is not available.
//
// It went wrong exactly the way a duplicated string goes wrong. The neighbour
// prefetch filed its windows under `` `${PANE_OUTPUT_FORMAT}:${outputSource}` ``
// -- two components -- while every recall asked for the three-component
// `outputShape`. Not one window it fetched was ever handed back: the warm-up
// spent a round trip per neighbour, the switch it was meant to make instant
// blanked anyway, and nothing anywhere reported a problem, because a cache miss
// is not an error. A silent, permanent waste that looked from the outside
// exactly like the feature working.
//
// So: the shape is built in one place, `paneReading`, and everywhere else reads
// it. This scan fails if a second speller appears.
/// <reference types="node" />
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const SCREEN = join(dirname(fileURLToPath(import.meta.url)), '..', 'server-terminal-workspace.tsx');

const text = readFileSync(SCREEN, 'utf8');
const source = ts.createSourceFile(SCREEN, text, ts.ScriptTarget.Latest, true);

/**
 * Every template literal in the file that interpolates `PANE_OUTPUT_FORMAT`.
 *
 * The format constant is the first component of a shape, so a template that
 * mentions it is a shape being spelled out -- whoever wrote it and whatever
 * they called the variable it lands in.
 */
function shapeTemplates(): ts.TemplateExpression[] {
  const found: ts.TemplateExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isTemplateExpression(node) && node.getText(source).includes('PANE_OUTPUT_FORMAT'))
      found.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test('the pane window shape is built in exactly one place', () => {
  const templates = shapeTemplates();
  // If this fails at 0, `paneReading` no longer builds the shape and the whole
  // premise of the scan is gone -- fix the scan, do not delete it.
  expect(templates).toHaveLength(1);
  expect(templates[0]?.getText(source)).toBe(
    "`${PANE_OUTPUT_FORMAT}:${source}:${ownsScreen ? 'alt' : 'main'}`"
  );
});

test('the one shape has all three components', () => {
  // The bug was a shape one component short, so the count is worth pinning in
  // its own right: a window filed under a prefix of the name it is asked for is
  // refused just as flatly as an unrelated one. Counted off the AST rather than
  // by splitting the text, because the third component is a ternary and carries
  // a colon of its own.
  const [shape] = shapeTemplates();
  expect(shape?.templateSpans).toHaveLength(3);
});

test('the neighbour prefetch files under the shape a recall asks for', () => {
  // Both sides by name rather than by string, which is the whole point: they
  // cannot disagree if there is only one string and everyone reads it.
  const prefetch = text.slice(text.indexOf('const targets = panePrefetchTargets('));
  expect(prefetch).toContain('shape: outputShape,');
});

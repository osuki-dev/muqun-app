import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

/**
 * A change is seen before it is approved.
 *
 * An `edit`, a `write` or a `patch` sends the diff on the permission ask
 * itself -- `metadata.files` as `FileDiff.Info[]`, or the flat `{filepath,
 * diff}` a patch adds -- and the card read none of it, so every one of them
 * was approved on the strength of a file name. The rows come from the same
 * flattener the tool card's diff uses, so approving a patch here and reading
 * it in the timeline afterwards cannot show two different pictures.
 *
 * Source rather than a render: this card pulls in Reanimated, Expo and the
 * native diff view, none of which parse outside Metro. What is checked is that
 * the card reads the ask's own metadata, draws it through the shared rows, and
 * keeps the answer below the patch rather than inside it.
 */
const CARD = readFileSync('src/components/agent-permission-card.tsx', 'utf8');

test('the ask is read for a diff, through the one shared reading of metadata', () => {
  expect(CARD).toContain("import { diffFilesFromMetadata } from '@/lib/agent-tool-output';");
  expect(CARD).toContain('diffFilesFromMetadata(request.metadata)');
  // Every file open: a patch behind a closed file row is a patch nobody read
  // before answering.
  expect(CARD).toContain(
    'diffRowsFromPatches(diffFiles, new Set(diffFiles.map((file) => file.path)))'
  );
});

test('the rows are the shared ones, bounded by their own default', () => {
  expect(CARD).toContain("import { InlineDiffRows } from '@/components/diff-rows';");
  expect(CARD).toContain('<InlineDiffRows');
  // No `limit` of its own: `INLINE_DIFF_MAX_ROWS` is 60 rows and a step, and a
  // permission card is not the place to invent a second bound.
  expect(CARD).not.toContain('limit={');
});

test('the answer is below the patch, never inside it', () => {
  const diffAt = CARD.indexOf('<InlineDiffRows');
  const actionsAt = CARD.indexOf('<View style={styles.actions}>');
  const bodyAt = CARD.indexOf('<View style={[styles.body,');
  expect(diffAt).toBeGreaterThan(-1);
  // After the body box, so the diff is not a third frame inside a tinted box
  // inside a bordered card; before the buttons, so a horizontal drag through
  // the patch cannot land on Allow.
  expect(diffAt).toBeGreaterThan(bodyAt);
  expect(actionsAt).toBeGreaterThan(diffAt);
});

test('an ask with no diff draws no empty frame', () => {
  expect(CARD).toContain('diffRows.length > 0 ?');
});

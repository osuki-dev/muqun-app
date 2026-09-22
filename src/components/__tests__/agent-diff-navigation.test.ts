import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const rows = readFileSync(new URL('../diff-rows.tsx', import.meta.url), 'utf8');
const workbench = readFileSync(new URL('../agent-workbench.tsx', import.meta.url), 'utf8');
const route = readFileSync(new URL('../../app/agent-vcs-diff.tsx', import.meta.url), 'utf8');
const sheet = readFileSync(new URL('../agent-vcs-diff-sheet.tsx', import.meta.url), 'utf8');

test('Open in changes carries the inline file through to the working-tree viewer', () => {
  expect(rows).toContain('onPress={() => onOpenFullDiff(targetPath)}');
  expect(workbench).toContain('...(path ? { path } : {})');
  expect(route).toContain('targetPath={params.path}');
  expect(sheet).toContain("const requestedPath = mode === 'working'");
  expect(sheet).toContain('file.path === requestedPath');
  expect(sheet).toContain('listRef.current?.scrollToIndex({ index, animated: false })');
});

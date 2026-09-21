import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const SHEET = readFileSync('src/components/agent-context-sheet.tsx', 'utf8');

test('the model row trusts a normalized model name and formats its session fallback once', () => {
  expect(SHEET).toContain("import { formatModelName } from '@/lib/agent-protocol';");
  expect(SHEET).toContain(
    "const displayModelName = modelName || formatModelName(session?.model, '');"
  );
  expect(SHEET).toContain('{displayModelName || t`Not set`}');
  expect(SHEET).not.toContain('session?.model?.variant]');
});

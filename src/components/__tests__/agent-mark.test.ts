import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { agentMarkKind } from '@/lib/agent-mark-kind';

const MARK = readFileSync('src/components/agent-mark.tsx', 'utf8');

test('each shipped kind resolves to itself and is rendered by its own component', () => {
  expect(agentMarkKind('opencode')).toBe('opencode');
  expect(agentMarkKind('deepseek')).toBe('deepseek');
  expect(agentMarkKind('t3')).toBe('t3');
  expect(MARK).toContain("case 'opencode':\n      return <OpenCodeIcon");
  expect(MARK).toContain("case 'deepseek':\n      return <DeepSeekIcon");
  expect(MARK).toContain("case 't3':\n      return <T3Icon");
});

test('unknown kinds have no mark and fall back to the generic Bot glyph', () => {
  expect(agentMarkKind('mystery')).toBeNull();
  expect(agentMarkKind('')).toBeNull();
  expect(agentMarkKind('toString')).toBeNull();
  expect(MARK).toContain('default:\n      return <Bot');
});

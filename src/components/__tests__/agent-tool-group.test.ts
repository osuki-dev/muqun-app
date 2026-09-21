import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/agent-message-block.tsx', 'utf8');
const start = source.indexOf('const AgentToolGroup = memo');
const end = source.indexOf("/**\n * One message's thinking", start);
const group = source.slice(start, end);

test('completed routine calls use one accessible disclosure row', () => {
  expect(source).toContain('groupRoutineToolEntries(entries)');
  expect(group).toContain('accessibilityRole="button"');
  expect(group).toContain('accessibilityState={{ expanded }}');
  expect(group).toContain("one: '# operation', other: '# operations'");
});

test('expanding reuses the original tool card and actions', () => {
  expect(group).toContain('expanded ?');
  expect(group).toContain('<ToolPartCard');
  expect(group).toContain('actions={actions}');
  expect(group).toContain('readOnly={readOnly}');
});

test('the disclosure key follows the first stable tool id', () => {
  expect(group).toContain('agent-tool-group-${entries[0].item.id}');
  expect(group).not.toContain('Date.now');
  expect(group).not.toContain('Math.random');
});

import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { productionSource, transpile, walk } from '@/test-support/production-source';

test('child caption keeps identity and status without repeating level or parent', () => {
  const source = productionSource('src/components/agent-session-tree-sheet.tsx');
  let calculation = '';
  walk(source.program, (node) => {
    if (node.type !== 'FunctionDeclaration' || node.id?.name !== 'SessionTreeRow' || !node.body)
      return;
    const start = node.body.body.find(
      (statement) =>
        statement.type === 'VariableDeclaration' &&
        statement.declarations.some(
          (item) => item.id.type === 'Identifier' && item.id.name === 'nativeStatus'
        )
    );
    const end = node.body.body.find((statement) => statement.type === 'ReturnStatement');
    if (start && end) calculation = source.text.slice(start.start, end.start);
  });
  // Execute the production caption calculation, not the native row or its interactions.
  const caption = runInNewContext(transpile(`${calculation}; caption`), {
    session: { agent_name: 'Reviewer', agent_role: 'Security', mode: 'build', status: 'busy' },
    depth: 2,
    parentTitle: 'Parent task',
    t: (parts: TemplateStringsArray, ...values: unknown[]) =>
      parts.reduce((text, part, i) => text + part + (values[i] ?? ''), ''),
  });
  expect(caption).toBe('Reviewer · Security · Running');
});

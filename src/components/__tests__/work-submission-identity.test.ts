import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (value && typeof value === 'object' && 'props' in value)
    return text((value as Node).props.children);
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

test('actual result rows retain immutable labels and review identity when earlier UUIDs arrive on refresh', () => {
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const imports: Record<string, unknown> = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { View: 'View' },
    '@lingui/react/macro': {
      useLingui: () => ({ t: (parts: TemplateStringsArray) => parts.join('') }),
    },
    '@osuki-dev/ui': { Text: 'Text' },
    '@/components/work-task-scroll': { WorkTaskSection: 'Section' },
    '@/hooks/use-work-task-focus': { useWorkTaskFocus: () => null },
    '@/components/themed-button': { Button: 'Button' },
    '@/components/pressable-scale': { PressableScale: 'PressableScale' },
    '@/components/settings-chrome': { LADDER: {}, SectionLabel: 'SectionLabel' },
    '@/lib/work-lifecycle': { workOperationBlocksExecution: () => false },
  };
  const exports: Record<string, (props: Record<string, unknown>) => Node> = {};
  const compiled = ts.transpileModule(
    readFileSync(new URL('../work-task-detail.tsx', import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    }
  ).outputText;
  new Function('require', 'exports', compiled)((name: string) => {
    if (!(name in imports)) throw new Error(name);
    return imports[name];
  }, exports);
  const oldId = 'bcece6c7-0000-4000-8000-000000000001';
  const newId = '56fd862a-0000-4000-8000-000000000002';
  const result = (id: string) => ({
    id,
    summary: 'Result',
    attempt_id: 'attempt',
    evidence: [],
    artifacts: [],
  });
  let selected: unknown;
  let reviewed: unknown;
  const props = {
    detail: {
      task: { id: 'task', title: 'Task', repo_path: '/repo', brief: 'Goal', revision: 7 },
      attempts: [],
      operations: [],
      results: [result(oldId)],
      reviews: [],
    },
    selectedResultId: oldId,
    currentAttemptIds: [],
    connected: true,
    available: true,
    onSelectResult: (id: string) => {
      selected = id;
    },
    onAcceptResult: (id: string) => {
      reviewed = id;
    },
  };
  const before = exports.WorkTaskDetail(props);
  const row = (tree: Node) =>
    nodes(tree).find((node) => node.props.testID === `task-result-${oldId}`)!;
  const label = text(row(before));
  expect(label).toBe(`✓ Submission ${oldId.slice(0, 13)}Result`);
  const after = exports.WorkTaskDetail({
    ...props,
    detail: { ...props.detail, results: [result(newId), result(oldId)] },
  });
  expect(text(row(after))).toBe(label);
  expect(row(after).props.accessibilityLabel).toBe(`Submission: ${oldId}`);
  expect(row(after).props.accessibilityState).toEqual({ selected: true });
  (row(after).props.onPress as () => void)();
  expect(selected).toBe(oldId);
  const accept = nodes(after).find((node) => node.props.testID === 'task-result-accept')!;
  (accept.props.onPress as () => void)();
  expect(reviewed).toBe(oldId);
  expect(
    text(nodes(after).find((node) => node.props.testID === 'task-selected-submission-id'))
  ).toBe(`Submission: ${oldId}`);
});

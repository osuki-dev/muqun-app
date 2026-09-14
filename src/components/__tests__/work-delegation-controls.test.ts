import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import * as domain from '../../lib/work-delegation';
import { DEMO_WORK_IDS, createDemoWorkTransport } from '../../lib/demo-work';
import { createWorkApi } from '../../lib/work-api';
import { DEMO_PAIRING_SERVER_ID } from '../../lib/pairing';
import type { WorkDelegationControlsProps } from '../work-delegation-controls';
// Evaluate the actual component with a tiny host renderer, without globally mocking native modules.
function renderer() {
  const states: unknown[] = [];
  let index = 0;
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const imports: Record<string, unknown> = {
    react: {
      useState: (initial: unknown) => {
        const at = index++;
        if (!(at in states))
          states[at] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
        return [
          states[at],
          (next: unknown) => {
            states[at] = next;
          },
        ];
      },
    },
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { View: 'View' },
    '@osuki-dev/ui': { Text: 'Text' },
    '@lingui/react/macro': {
      useLingui: () => ({
        t: (strings: TemplateStringsArray, ...values: unknown[]) =>
          strings.reduce((text, part, i) => text + part + (values[i] ?? ''), ''),
      }),
    },
    './themed-button': { Button: 'Button' },
    './themed-input': { Input: 'Input' },
    './pressable-scale': { PressableScale: 'PressableScale' },
    './settings-chrome': { LADDER: { gap: 8, tight: 4 } },
    '@/lib/work-delegation': domain,
  };
  const source = readFileSync(new URL('../work-delegation-controls.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports: Record<string, (props: WorkDelegationControlsProps) => Node> = {};
  new Function('require', 'exports', compiled)((name: string) => {
    if (!(name in imports)) throw new Error(name);
    return imports[name];
  }, exports);
  return (props: WorkDelegationControlsProps) => {
    index = 0;
    return exports.WorkDelegationControls(props);
  };
}
type Node = { type: unknown; props: Record<string, unknown> };
function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function find(tree: Node, id: string) {
  const value = nodes(tree).find((node) => node.props.testID === id);
  if (!value) throw new Error(id);
  return value;
}
async function fixture(): Promise<WorkDelegationControlsProps> {
  const api = createWorkApi(
    {
      serverId: DEMO_PAIRING_SERVER_ID,
      label: 'Demo',
      url: 'https://demo.invalid',
      token: 'demo',
      pairedAt: 0,
    },
    'demo',
    createDemoWorkTransport()
  );
  const detail = await api.detail(DEMO_WORK_IDS.review, { isCurrent: () => true });
  return {
    serverId: DEMO_PAIRING_SERVER_ID,
    serverLabel: 'Fictional demo',
    task: detail.task,
    attempts: detail.attempts,
    committed: domain.parseWorkDelegationState(undefined),
    availability: { connected: true, capable: true, pending: false, historyComplete: true },
    onConfigure: async () => {},
  };
}
test('actual delegation controls require explicit lead and invoke one complete captured policy without optimistic committed state', async () => {
  const render = renderer();
  const props = await fixture();
  const intents: domain.WorkDelegationIntent[] = [];
  props.onConfigure = async (intent) => {
    intents.push(intent);
  };
  let tree = render(props);
  expect(find(tree, 'task-delegation-enable').props.disabled).toBe(true);
  (find(tree, `task-delegation-lead-${DEMO_WORK_IDS.lead}`).props.onPress as () => void)();
  tree = render(props);
  expect(find(tree, 'task-delegation-enable').props.disabled).toBe(false);
  (find(tree, 'task-delegation-enable').props.onPress as () => void)();
  tree = render(props);
  expect(find(tree, 'task-delegation-enable').props.disabled).toBe(true);
  expect(intents).toHaveLength(1);
  expect(intents[0].coordinator?.instanceId).toBe(props.attempts[0].instance_id!);
  expect(intents[0].input.policy.enabled).toBe(true);
  expect(props.committed.policy.enabled).toBe(false);
  await Promise.resolve();
});
test('actual controls hide child configuration and allow root disable despite invalid draft or incomplete history', async () => {
  const render = renderer();
  const props = await fixture();
  props.committed = {
    ...props.committed,
    policy: { ...props.committed.policy, enabled: true },
    coordinator_attempt_id: DEMO_WORK_IDS.lead,
  };
  let tree = render(props);
  (find(tree, 'task-delegation-limit').props.onChangeText as (text: string) => void)('invalid');
  props.availability.historyComplete = false;
  tree = render(props);
  expect(find(tree, 'task-delegation-disable').props.disabled).toBe(false);
  expect(find(tree, 'task-delegation-enable').props.disabled).toBe(true);
  props.task = { ...props.task, parent_task_id: DEMO_WORK_IDS.uncertain };
  tree = render(props);
  expect(nodes(tree).some((node) => node.props.testID === 'task-delegation-enable')).toBe(false);
  expect(nodes(tree).some((node) => node.props.testID === 'task-delegation-disable')).toBe(false);
});

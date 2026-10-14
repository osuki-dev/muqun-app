import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { productionSource, walk } from '../../test-support/production-source';
import * as toolOutput from '../../lib/agent-tool-output';
import { subagentPresentation } from '../../lib/agent-subagent-presentation';
import { toolDurationMs } from '../../lib/agent-protocol';

/** Exercise the production card while replacing native and localization boundaries. */
function renderCard(props: object): any {
  const source = productionSource('src/components/agent-tool-card.tsx');
  const expressions = new Map<string, string>();
  walk(source.program, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.init &&
      ['AgentToolCard', 'styles'].includes(node.id.name)
    ) {
      expressions.set(node.id.name, source.code(node.init));
    }
  });
  const require = createRequire(import.meta.url);
  const code = require('@babel/core').transformSync(
    `const styles = ${expressions.get('styles')}; exports.render = ${expressions.get('AgentToolCard')};`,
    {
      filename: 'subagent-render.tsx',
      babelrc: false,
      configFile: false,
      presets: ['@react-native/babel-preset'],
    }
  ).code;
  const exports: { render?: (props: object) => unknown } = {};
  const colors = { textMuted: 'muted', warning: 'warning', danger: 'danger', accent: 'accent' };
  runInNewContext(code, {
    ...toolOutput,
    subagentPresentation,
    toolDurationMs,
    exports,
    require,
    memo: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
    useLingui: () => ({
      t: (parts: string[]) => parts.join(''),
      i18n: { _: (word: unknown) => word },
    }),
    subagentActionWord: { wait: 'Wait', close: 'Close', completed: 'Completed' },
    subagentStateWord: { working: 'Working', idle: 'Idle', unknown: 'Unknown' },
    useThemeTokens: () => ({ colors }),
    usePaneChatMarkdownStyle: () => ({}),
    usePaneChatColors: () => colors,
    useAppearanceProfile: () => ({ chrome: { control: 12 } }),
    isToolPending: () => false,
    renderToolBody: (body: unknown) => body,
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
    AGENT_TYPE: { micro: { size: 12 }, meta: { size: 14 } },
    ...Object.fromEntries(
      [
        'EmbeddedTerminalToolBlock',
        'Chip',
        'PressableScale',
        'StatusDot',
        'GitFork',
        'Text',
        'View',
        'Trans',
      ].map((name) => [name, name])
    ),
  });
  return exports.render?.(props);
}

test('subagent card renders action, observed identity/state and exact child navigation independently of call completion', () => {
  const opened: string[] = [];
  const part = {
    type: 'tool',
    id: 'wait-call',
    name: 'subagent',
    state: 'completed',
    child_session_id: 'opaque-child-id',
    content: [],
    input: { operation: 'wait', prompt: 'Review authentication' },
    output: 'Found a race in the authentication handler.',
    metadata: { status: 'completed' },
  };
  const childSession = {
    asid: 'opaque-child-id',
    status: 'busy',
    agent_name: 'Reviewer',
    agent_role: 'Security',
  };
  const card = renderCard({
    part,
    childSession,
    onOpenChildSession: (id: string) => opened.push(id),
  });
  expect(card.props.toolName).toBe('Wait');
  expect(card.props.taskSummary.identity).toBe('Reviewer');
  expect(card.props.taskSummary.title).toBe('Review authentication');
  expect(card.props.status).toBe('completed');
  expect(card.props.taskSummary.status.props.children[1].props.children).toBe('Working');
  expect(card.props.taskSummary.statusLabel).toBe('Working');
  expect(card.props.taskSummary.busy).toBe(true);
  expect(card.props.children.subagentText).toBe(part.output);
  expect(card.props.actions).toHaveLength(1);
  card.props.actions[0].props.onPress();
  expect(opened).toEqual(['opaque-child-id']);
  const closed = renderCard({
    part: { ...part, input: { operation: 'closeAgent' } },
    childSession: { ...childSession, status: 'idle' },
  });
  expect(closed.props.toolName).toBe('Close');
  expect(closed.props.taskSummary.status.props.children[1].props.children).toBe('Idle');
  expect(closed.props.taskSummary.statusLabel).toBe('Idle');
  expect(closed.props.taskSummary.busy).toBe(false);
  expect(closed.props.actions).toBeNull();
});

test('historical activity preserves its supplied path and result without inventing a child state or controls', () => {
  const card = renderCard({
    part: {
      type: 'tool',
      id: 'activity',
      name: 'subagent',
      state: 'completed',
      title: '/root/review',
      input: {},
      content: [],
      output: 'Review returned.',
      metadata: { kind: 'completed' },
    },
  });
  expect(card.props.toolName).toBe('Completed');
  expect(card.props.taskSummary.identity).toBe('/root/review');
  expect(card.props.taskSummary.status.props.children[1].props.children).toBe('Unknown');
  expect(card.props.taskSummary.statusLabel).toBe('Unknown');
  expect(card.props.taskSummary.busy).toBe(false);
  expect(card.props.chips).toBeNull();
  expect(card.props.actions).toBeNull();
  expect(card.props.children.subagentText).toBe('Review returned.');
});

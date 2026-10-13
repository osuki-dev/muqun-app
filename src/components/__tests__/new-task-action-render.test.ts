import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as model from '../../lib/home-launch-model';
import { defaultAgentFeatures } from '../../lib/agent-protocol';

type Element = { type: string | ((props: object) => unknown); props: Record<string, any> };
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Element;
  return [
    node,
    ...nodes(typeof node.type === 'function' ? node.type(node.props) : node.props.children),
  ];
}

const require = createRequire(import.meta.url);
const code = require('@babel/core').transformSync(
  readFileSync('src/components/new-task-action.tsx', 'utf8'),
  {
    filename: 'new-task-action.tsx',
    babelrc: false,
    configFile: false,
    presets: ['@react-native/babel-preset'],
  }
).code;

/** Exercise the real card entry projection and actions without shared module mocks. */
function fixture(count: number) {
  const opened: unknown[][] = [];
  const routes: unknown[] = [];
  const colors = { primary: '#294862', warning: '#9a4b21' };
  const agents = Array.from({ length: count }, (_, index) => ({
    id: `agent-${index}`,
    kind: `provider-${index}`,
    name: `Provider ${index}`,
    status: index === 1 ? 'unconfigured' : 'connected',
    enabled: true,
    features: defaultAgentFeatures(),
  }));
  const state = {
    index: {
      servers: { computer: { agents: { supported: true, agents } } },
      lastUsed: { computer: `agent-${count - 1}` },
    },
  };
  let stateIndex = 0;
  const exports: Record<string, (props: object) => unknown> = {};
  runInNewContext(code, {
    exports,
    require: (module: string) => {
      if (module === 'react/jsx-runtime' || module.startsWith('@babel/runtime/'))
        return require(module);
      if (module === 'react')
        return {
          useState: (initial: unknown) => [stateIndex++ === 0 ? true : initial, () => {}],
          useEffect: () => {},
          useMemo: (fn: () => unknown) => fn(),
          useRef: () => ({ current: null }),
        };
      if (module === 'react-native')
        return {
          View: 'View',
          StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
        };
      if (module === 'react-native-reanimated')
        return {
          __esModule: true,
          default: { View: 'AnimatedView', ScrollView: 'ScrollView' },
          useReducedMotion: () => true,
          useAnimatedStyle: () => ({}),
          useSharedValue: () => ({}),
        };
      if (module === '@osuki-dev/ui') return { useThemeTokens: () => ({ colors }) };
      if (module === '@lingui/react/macro')
        return { useLingui: () => ({ t: (parts: string[]) => parts.join('') }) };
      if (module === '@/lib/home-launch-model') return model;
      if (module === '@/stores/agents')
        return { useAgents: (select: (state: unknown) => unknown) => select(state) };
      if (module === '@/stores/server-capabilities')
        return {
          useServerCapabilities: (select: (state: unknown) => unknown) =>
            select({ byServer: { computer: ['agent_sessions'] } }),
        };
      if (module === '@/hooks/use-agent-features')
        return { useSelectedAgent: () => ({ ready: [], selected: 'agent-0' }) };
      if (module === '@/hooks/use-home-commands')
        return {
          useHomeCommands: () => ({ openAgent: (...args: unknown[]) => opened.push(args) }),
        };
      if (module === 'expo-router')
        return { useRouter: () => ({ push: (route: unknown) => routes.push(route) }) };
      if (module === '@/hooks/use-surface-background')
        return { useSurfaceBackground: () => (color: string) => color };
      if (module === '@/components/pressable-scale') return { PressableScale: 'PressableScale' };
      if (module === '@/components/agent-mark') return { AgentMark: 'AgentMark' };
      if (module === '@/components/text') return { Text: 'Text' };
      if (module === '@/lib/color') return { withAlpha: (color: string) => color };
      if (module === '@/lib/motion')
        return { listLayout: () => {}, fadeIn: () => {}, fadeOut: () => {} };
      return {};
    },
  });
  return {
    opened,
    routes,
    colors,
    tree: nodes(exports.NewTaskAction({ serverId: 'computer', label: 'Computer' })),
  };
}

test('classic connection cards keep every discovered agent in one nonwrapping horizontal strip', () => {
  for (const count of [2, 3, 4, 5, 12]) {
    const { tree, opened } = fixture(count);
    const scroll = tree.find((node) => node.props.testID === 'server-agent-actions-computer')!;
    expect(scroll.type).toBe('ScrollView');
    expect(scroll.props.horizontal).toBe(true);
    expect(scroll.props.nestedScrollEnabled).toBe(true);
    expect(scroll.props.directionalLockEnabled).toBe(true);
    expect(scroll.props.contentContainerStyle.flexWrap).toBe('nowrap');
    const buttons = nodes(scroll).filter((node) => node.type === 'PressableScale');
    expect(buttons.map((button) => button.props.testID)).toEqual([
      `server-agent-action-agent-${count - 1}`,
      ...Array.from({ length: count - 1 }, (_, index) => `server-agent-action-agent-${index}`),
    ]);
    const ready = buttons.find((button) => button.props.testID === 'server-agent-action-agent-0')!;
    ready.props.onPress();
    expect(opened).toEqual([['computer', undefined, undefined, undefined, 'agent-0']]);
  }
});

test('scrolling preserves provider marks, warning colors, and setup destination', () => {
  const { tree, routes, colors } = fixture(5);
  const setup = tree.find(
    (node) => node.type === 'PressableScale' && node.props.testID === 'server-agent-action-agent-1'
  )!;
  const mark = nodes(setup).find((node) => node.type === 'AgentMark')!;
  expect(mark.props.kind).toBe('provider-1');
  expect(mark.props.color).toBe(colors.warning);
  setup.props.onPress();
  expect(routes).toEqual([
    {
      pathname: '/agent-guide',
      params: {
        serverId: 'computer',
        label: 'Computer',
        agentId: 'agent-1',
        status: 'needs-setup',
        intent: 'existing',
      },
    },
  ]);
});

test('one discovered agent retains the existing direct ready entry', () => {
  const { tree, opened } = fixture(1);
  expect(tree.some((node) => node.type === 'ScrollView')).toBe(false);
  tree
    .find(
      (node) => node.type === 'PressableScale' && node.props.testID === 'server-opencode-action'
    )!
    .props.onPress();
  expect(opened).toEqual([['computer', undefined, undefined, undefined, 'agent-0']]);
});

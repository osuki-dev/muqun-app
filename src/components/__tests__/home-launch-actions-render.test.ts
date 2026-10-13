import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as model from '../../lib/home-launch-model';
import { defaultAgentFeatures } from '../../lib/agent-protocol';
import { resolveAppearanceProfile } from '../../lib/appearance-profile';

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
function style(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return Object.assign({}, ...value.map(style));
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

const require = createRequire(import.meta.url);
const code = require('@babel/core').transformSync(
  readFileSync('src/components/home-launch-actions.tsx', 'utf8'),
  {
    filename: 'home-launch-actions.tsx',
    babelrc: false,
    configFile: false,
    presets: ['@react-native/babel-preset'],
  }
).code;

/** Run the production layout and buttons; replace only native and store boundaries. */
function fixture(agentCount: number, profile: 'classic' | 'editorial') {
  let width = 0;
  const launched: unknown[][] = [];
  const colors = {
    primary: '#294862',
    onPrimary: '#fceac9',
    surface: '#f4ebd8',
    text: '#302820',
    textMuted: '#81715e',
  };
  const discovery = {
    agents: {
      supported: true,
      agents: Array.from({ length: agentCount }, (_, index) => ({
        id: `agent-${index}`,
        kind: `agent-${index}`,
        name: `Agent ${index}`,
        status: 'connected',
        enabled: true,
        features: defaultAgentFeatures(),
      })),
    },
  };
  const state = { index: { servers: { computer: discovery }, lastUsed: {} } };
  const exports: Record<string, (props: object) => unknown> = {};
  runInNewContext(code, {
    exports,
    require: (module: string) => {
      if (module === 'react/jsx-runtime' || module.startsWith('@babel/runtime/'))
        return require(module);
      if (module === 'react')
        return {
          useState: () => [
            width,
            (next: number) => {
              width = next;
            },
          ],
          useEffect: () => {},
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
          useSharedValue: () => ({ get: () => 0, set: () => {} }),
        };
      if (module === '@osuki-dev/ui') return { useThemeTokens: () => ({ colors }) };
      if (module === '@lingui/react/macro')
        return { useLingui: () => ({ t: (parts: string[]) => parts.join('') }) };
      if (module === '@lingui/react')
        return { useLingui: () => ({ _: (value: unknown) => value }) };
      if (module === '@/lib/home-launch-model') return model;
      if (module === '@/stores/agents')
        return { useAgents: (select: (state: unknown) => unknown) => select(state) };
      if (module === '@/components/appearance-profile-provider')
        return { useAppearanceProfile: () => resolveAppearanceProfile(profile) };
      if (module === '@/hooks/use-surface-background')
        return { useSurfaceBackground: () => (color: string) => color };
      if (module === '@/components/pressable-scale') return { PressableScale: 'PressableScale' };
      if (module === '@/components/agent-mark') return { AgentMark: 'AgentMark' };
      if (module === '@/components/theme-icon') return { ThemeIcon: 'ThemeIcon' };
      if (module === '@/components/text') return { Text: 'Text' };
      if (module === '@/i18n/labels')
        return { agentLaunchCaption: { 'new-session': 'New session' } };
      if (module === 'expo-router') return { useIsFocused: () => true };
      if (module === '@/hooks/use-app-active') return { useAppActive: () => true };
      return {};
    },
  });
  const controller = {
    chosen: { serverId: 'computer' },
    chosenConnection: 'live',
    chosenOffline: false,
    opening: false,
    launchOnChosen: (action: (id: string) => void) => action('computer'),
    run: (action: () => void) => action(),
  };
  const props = { controller, onNewAgent: (...args: unknown[]) => launched.push(args) };
  return {
    colors,
    launched,
    render: (
      nextWidth: number,
      options: { grid?: boolean; dock?: boolean; newOnly?: boolean } = {}
    ) => {
      const before = nodes(exports.HomeLaunchActions({ ...props, ...options }));
      before
        .find((node) => node.props.testID === 'home-launch-actions')!
        .props.onLayout({ nativeEvent: { layout: { width: nextWidth } } });
      return nodes(exports.HomeLaunchActions({ ...props, ...options }));
    },
  };
}

const buttons = (tree: Element[]) => tree.filter((node) => node.type === 'PressableScale');

test('both Home profiles render one phone scroll strip with paired agents and coherent utility columns', () => {
  for (const profile of ['classic', 'editorial'] as const) {
    const app = fixture(5, profile);
    const tree = app.render(370);
    const scroll = tree.find((node) => node.type === 'ScrollView')!;
    expect(scroll.props.horizontal).toBe(true);
    const columns = scroll.props.children.flat().filter(Boolean) as Element[];
    expect(
      columns.map((column) => buttons(nodes(column)).map((node) => node.props.testID))
    ).toEqual([
      ['home-new-agent-agent-0', 'home-new-agent-agent-1'],
      ['home-new-agent-agent-2', 'home-new-agent-agent-3'],
      ['home-new-agent-agent-4'],
      ['home-open-sessions', 'home-open-terminal'],
      ['home-new-terminal'],
      ['home-open-ssh'],
    ]);
    const agent = buttons(tree).find((node) => node.props.testID === 'home-new-agent-agent-0')!;
    expect(style(agent.props.style).backgroundColor).toBe(app.colors.primary);
    expect(style(agent.props.style).borderRadius).toBe(
      resolveAppearanceProfile(profile).chrome.control
    );
    agent.props.onPress();
    expect(app.launched).toEqual([['computer', undefined, 'agent-0']]);
    expect(app.render(900).some((node) => node.type === 'ScrollView')).toBe(true);
  }
});

test('Pad grid and cover dock render four agent tiles across without a phone scroll strip', () => {
  for (const options of [{ grid: true }, { dock: true }]) {
    const app = fixture(4, 'editorial');
    const tree = app.render(1000, { ...options, newOnly: true });
    expect(tree.some((node) => node.type === 'ScrollView')).toBe(false);
    const agentRow = tree.find(
      (node) =>
        node.type === 'View' &&
        Array.isArray(node.props.children) &&
        node.props.children.length === 4 &&
        node.props.children.every((child: unknown) => buttons(nodes(child)).length === 1)
    )!;
    expect(
      agentRow.props.children.map((column: Element) => buttons(nodes(column))[0]!.props.testID)
    ).toEqual([
      'home-new-agent-agent-0',
      'home-new-agent-agent-1',
      'home-new-agent-agent-2',
      'home-new-agent-agent-3',
    ]);
    expect(buttons(tree).map((node) => node.props.testID)).toEqual([
      'home-new-agent-agent-0',
      'home-new-agent-agent-1',
      'home-new-agent-agent-2',
      'home-new-agent-agent-3',
      'home-new-terminal',
    ]);
  }
});

test('classic Pad keeps all agents in one horizontal row with four visible and utilities below', () => {
  for (const options of [{ grid: true }, { dock: true }]) {
    for (const count of [1, 2, 4, 5, 12]) {
      const tree = fixture(count, 'classic').render(1000, { ...options, newOnly: true });
      const scroll = tree.find((node) => node.props.testID === 'home-launch-agents-scroll')!;
      expect(scroll.props.horizontal).toBe(true);
      expect(scroll.props.nestedScrollEnabled).toBe(true);
      expect(buttons(nodes(scroll)).map((button) => button.props.testID)).toEqual(
        Array.from({ length: count }, (_, index) => `home-new-agent-agent-${index}`)
      );
      const columns = scroll.props.children as Element[];
      expect(columns[0]!.props.style.width).toBe(
        Math.floor((1000 - (Math.min(count, 4) - 1) * 8) / Math.min(count, 4))
      );
      expect(
        buttons(nodes(scroll)).some((button) => button.props.testID === 'home-new-terminal')
      ).toBe(false);
      expect(
        buttons(tree).filter((button) => button.props.testID === 'home-new-terminal')
      ).toHaveLength(1);
    }
  }
});

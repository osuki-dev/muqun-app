import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as notices from '../in-app-notifications';
import * as swipe from '../notice-swipe';
import { readApprovalBody } from '../agent-engine-text';
import { appearanceProfiles } from '../appearance-profile';
import { notificationSurfaceStyle } from '../notification-surface';
import { appChrome } from '../../constants/appearance';

type Node = {
  type: unknown;
  props: {
    children?: unknown;
    testID?: string;
    style?: unknown;
    numberOfLines?: number;
    accessibilityElementsHidden?: boolean;
    pointerEvents?: string;
    onPress?: () => void;
    onAccessibilityAction?: (event: { nativeEvent: { actionName: string } }) => void;
    onContentSizeChange?: (width: number, height: number) => void;
  };
};
const require = createRequire(import.meta.url);
const { transformSync } = require('@babel/core');
const code = transformSync(
  readFileSync(new URL('../../components/in-app-notification-host.tsx', import.meta.url), 'utf8'),
  {
    filename: 'in-app-notification-host.tsx',
    babelrc: false,
    configFile: false,
    presets: ['@react-native/babel-preset'],
  }
).code;

function nodes(value: unknown): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object' || !('props' in value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('');
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return value && typeof value === 'object' && 'props' in value
    ? text((value as Node).props.children)
    : '';
}
function style(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return Object.assign({}, ...value.map(style));
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Isolate only native boundaries; exercise the real card tree and queue actions. */
function fixture(
  count: number,
  profileId: 'classic' | 'editorial' = 'classic',
  dark = false,
  height = 844
) {
  let cursor = 0;
  const state: unknown[] = [];
  let items: notices.InAppNotice[] = Array.from({ length: count }, (_, index) => ({
    id: `notice-${index}`,
    title: `Agent blocked · Computer ${index + 1}`,
    body:
      index === 0
        ? `${'Context about the pending task. '.repeat(7)}Keep the final requirement and /critical/file.ts visible.`
        : `Question ${index + 1}`,
    kind: 'approval',
    question: { asid: `session-${index}`, formId: `form-${index}` },
    route: `/agent?asid=session-${index}`,
  }));
  const opened: unknown[] = [];
  const profile = appearanceProfiles[profileId];
  const colors = {
    primary: '#23558d',
    textMuted: dark ? '#aabbcc' : '#455566',
    surfaceRaised: dark ? '#253039' : '#e3eff2',
    border: '#8999aa',
  };
  const useState = (initial: unknown) => {
    const slot = cursor++;
    if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
    return [
      state[slot],
      (next: unknown) => {
        state[slot] = next;
      },
    ];
  };
  const store = Object.assign(
    (select: (value: { items: notices.InAppNotice[] }) => unknown) => select({ items }),
    {
      getState: () => ({
        dismiss: (id: string) => {
          items = items.filter((item) => item.id !== id);
        },
        clear: () => {
          items = [];
        },
      }),
    }
  );
  const gestureCalls: Record<string, unknown[]> = {};
  const gesture = new Proxy(
    {},
    {
      get:
        (_target, key) =>
        (...args: unknown[]) => {
          gestureCalls[String(key)] = args;
          return gesture;
        },
    }
  );
  const exports: Record<string, unknown> = {};
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name === 'react/jsx-runtime' || name.startsWith('@babel/runtime/')) return require(name);
      if (name === 'react')
        return { useState, useEffect: () => {}, useMemo: (read: () => unknown) => read() };
      if (name === '@lingui/react/macro')
        return {
          useLingui: () => ({
            t: (parts: TemplateStringsArray, ...values: unknown[]) =>
              parts.reduce((s, part, i) => s + part + (values[i] ?? ''), ''),
          }),
        };
      if (name === '@lingui/react') return { useLingui: () => ({ _: (value: unknown) => value }) };
      if (name === '@osuki-dev/ui') return { useThemeTokens: () => ({ colors }) };
      if (name === 'lucide-react-native') return { Bell: 'Bell', ChevronRight: 'ChevronRight' };
      if (name === 'expo-router')
        return {
          usePathname: () => '/',
          router: { navigate: (route: unknown) => opened.push(route) },
        };
      if (name === 'react-native')
        return {
          View: 'View',
          ScrollView: 'ScrollView',
          useWindowDimensions: () => ({ width: 390, height }),
          StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 },
          AppState: { currentState: 'active' },
        };
      if (name === 'react-native-safe-area-context')
        return { useSafeAreaInsets: () => ({ top: 20, bottom: 20 }) };
      if (name === 'react-native-gesture-handler')
        return {
          Gesture: {
            Pan: () => {
              for (const key of Object.keys(gestureCalls)) delete gestureCalls[key];
              return gesture;
            },
          },
          GestureDetector: 'GestureDetector',
        };
      if (name === 'react-native-reanimated')
        return {
          __esModule: true,
          default: { View: 'AnimatedView' },
          useSharedValue: (initial: unknown) => {
            const [shared] = useState(() => {
              let value = initial;
              return {
                get: () => value,
                set: (next: unknown) => {
                  value = next;
                },
              };
            });
            return shared;
          },
          useAnimatedStyle: (read: () => unknown) => read(),
          cancelAnimation: () => {},
          runOnJS: (fn: unknown) => fn,
          withTiming: (value: unknown) => value,
        };
      if (name === '@/hooks/use-surface-background')
        return { useSurfaceBackgroundOpacity: () => 1 };
      if (name === '@/theme/surface-background')
        return { surfaceBackgroundFill: (color: string) => color };
      if (name === '@/hooks/use-user-fonts') return { useMonoFontFamily: () => 'monospace' };
      if (name === '@/hooks/use-render-refs')
        return { useStableHandler: (handler: unknown) => handler };
      if (name === '@/components/text') return { Text: 'Text' };
      if (name === '@/components/nav-header') return { NAV_HEADER_CONTROL_SIZE: 32 };
      if (name === '@/components/appearance-profile-provider')
        return { useAppearanceProfile: () => profile };
      if (name === '@/components/notification-surface')
        return {
          useNotificationSurfaceStyle: (shadow = true) => notificationSurfaceStyle(profile, shadow),
        };
      if (name === '@/constants/appearance') return { appChrome };
      if (name === '@/constants/nav-header') return { NAV_HEADER_TOP_GAP: 4 };
      if (name === '@/i18n/labels') return { permissionActionPhrase: { bash: 'Run a command' } };
      if (name === '@/lib/agent-engine-text') return { readApprovalBody };
      if (name === '@/lib/feedback') return { feedback: () => Promise.resolve() };
      if (name === '@/lib/in-app-notifications') return notices;
      if (name === '@/lib/motion')
        return {
          fadeInDown: () => undefined,
          timing: () => ({}),
          settleTo: (shared: { set: (value: number) => void }, value: number) => shared.set(value),
        };
      if (name === '@/lib/notice-swipe') return swipe;
      if (name === '@/constants/agent-type')
        return { AGENT_TYPE: { meta: { size: 12, lineHeight: 18 } } };
      if (name === '@/stores/app-settings')
        return {
          useAppSettings: (select: (value: { notificationsEnabled: boolean }) => unknown) =>
            select({ notificationsEnabled: true }),
        };
      if (name === '@/stores/in-app-notifications') return { useInAppNotifications: store };
      if (name === './pressable-scale') return { PressableScale: 'Pressable' };
      throw new Error(name);
    },
  });
  const render = () => {
    cursor = 0;
    return (exports.InAppNotificationHost as () => Node)();
  };
  return { render, opened, items: () => items, gestureCalls };
}

function byId(tree: Node, id: string) {
  return nodes(tree).find((node) => node.props.testID === id)!;
}

test('single and five-notice cards preserve full context, theme geometry and horizontal 44pt actions', () => {
  for (const profile of ['classic', 'editorial'] as const)
    for (const dark of [false, true])
      for (const count of [1, 5]) {
        const scope = fixture(count, profile, dark);
        const tree = scope.render();
        const card = byId(tree, 'in-app-notification');
        expect(text(card)).toContain('Needs your input · Computer 1');
        expect(text(card)).toContain('/critical/file.ts visible.');
        expect(
          nodes(card)
            .filter((node) => node.type === 'Text')
            .every((node) => node.props.numberOfLines === undefined)
        ).toBe(true);
        expect(style(card.props.style).borderRadius).toBeLessThanOrEqual(
          appearanceProfiles[profile].chrome.card
        );
        const open = byId(card, 'in-app-notification-open');
        expect(style(open.props.style).minHeight).toBeGreaterThanOrEqual(44);
        expect(style(open.props.style).minWidth).toBeGreaterThanOrEqual(44);
        const actions = nodes(card).find(
          (node) => Array.isArray(node.props.children) && node.props.children.includes(open)
        )!;
        expect(style(actions.props.style).flexDirection).toBe('row');
        const backs = nodes(tree).filter(
          (node) => node.props.testID === 'in-app-notification-back'
        );
        expect(backs).toHaveLength(count === 1 ? 0 : 2);
        for (const back of backs) {
          expect(back.props.children).toBeUndefined();
          expect(back.props.pointerEvents).toBe('none');
          expect(back.props.accessibilityElementsHidden).toBe(true);
          expect(style(back.props.style).boxShadow).toBeUndefined();
          expect(style(back.props.style).borderRadius).toBe(style(card.props.style).borderRadius);
        }
        if (count === 5) {
          const next = byId(card, 'in-app-notification-next');
          expect(text(next)).toBe('1 / 5');
          expect(style(next.props.style).backgroundColor).toBeUndefined();
          expect(style(next.props.style).minHeight).toBeGreaterThanOrEqual(44);
        }
      }
});

test('cycling preserves the queue; Open navigates to and dismisses only the selected notice', () => {
  const scope = fixture(5);
  byId(scope.render(), 'in-app-notification-next').props.onPress!();
  const next = scope.render();
  expect(text(byId(next, 'in-app-notification'))).toContain('Computer 2');
  expect(scope.items()).toHaveLength(5);
  byId(next, 'in-app-notification-open').props.onPress!();
  expect(scope.opened).toEqual(['/agent?asid=session-1']);
  expect(scope.items().map((item) => item.id)).toEqual([
    'notice-0',
    'notice-2',
    'notice-3',
    'notice-4',
  ]);
});

test('the accessible dismiss action still removes only the current card', () => {
  const scope = fixture(5);
  const content = nodes(byId(scope.render(), 'in-app-notification')).find(
    (node) => node.props.onAccessibilityAction
  )!;
  content.props.onAccessibilityAction!({ nativeEvent: { actionName: 'dismiss' } });
  expect(scope.items()).toHaveLength(4);
  expect(scope.opened).toEqual([]);
  expect(scope.items()[0]!.id).toBe('notice-1');
});

test('multiline notifications keep actions outside a bounded scroller and give vertical drags to the text', () => {
  const scope = fixture(5, 'classic', false, 320);
  const body = Array.from({ length: 80 }, (_, line) => String(line)).join('\n');
  scope.items()[0]!.body = body;
  const card = byId(scope.render(), 'in-app-notification');
  const content = byId(card, 'in-app-notification-content');
  expect(content?.type).toBe('ScrollView');
  expect(text(content)).toContain(body);
  expect(style(content.props.style).maxHeight).toBeLessThanOrEqual(144);
  expect(byId(content, 'in-app-notification-open')).toBeUndefined();
  expect(byId(card, 'in-app-notification-open')).toBeDefined();
  content.props.onContentSizeChange!(362, 1500);
  scope.render();
  expect(scope.gestureCalls.activeOffsetY).toBeUndefined();
  expect(scope.gestureCalls.failOffsetY).toEqual([[-6, 6]]);
  expect(scope.gestureCalls.activeOffsetX).toEqual([[-6, 6]]);
});

test('cancelled notification swipes return to rest without beginning dismissal', () => {
  const scope = fixture(1);
  const translation = (tree: Node) => {
    const detector = nodes(tree).find((node) => node.type === 'GestureDetector')!;
    return style((detector.props.children as Node).props.style);
  };
  scope.render();
  const event = { translationX: 30, translationY: -20, velocityX: 500, velocityY: -300 };
  (scope.gestureCalls.onUpdate![0] as (event: swipe.NoticeSwipe) => void)(event);
  expect(translation(scope.render()).transform).toEqual([{ translateX: 15 }, { translateY: -10 }]);
  const end = scope.gestureCalls.onEnd![0] as (event: swipe.NoticeSwipe, success: boolean) => void;
  end(event, false);
  expect(translation(scope.render())).toEqual({
    opacity: 1,
    transform: [{ translateX: 0 }, { translateY: 0 }],
  });
  expect(scope.items()).toHaveLength(1);
  // An intentional release with the same movement still starts dismissal.
  end(event, true);
  expect(translation(scope.render()).opacity).toBe(0);
});

test('approval bodies preserve unknown actions and translate known actions without repeating their subject', () => {
  const scope = fixture(1);
  const notice = scope.items()[0]!;
  delete notice.question;
  notice.body = 'custom_permission: /critical/file.ts';
  expect(text(byId(scope.render(), 'in-app-notification-content'))).toContain(notice.body);
  notice.body = 'bash: echo hello';
  const content = text(byId(scope.render(), 'in-app-notification-content'));
  expect(content).toContain('Run a command');
  expect(content).not.toContain('bash:');
  expect(content.match(/echo hello/g)).toHaveLength(1);
});

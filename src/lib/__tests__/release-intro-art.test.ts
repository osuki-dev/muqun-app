import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
type Element = { type: unknown; props: { children?: unknown; [key: string]: unknown } };
type Component = (props: Record<string, unknown>) => Element | null;

/** Run the production ownership boundaries with native modules isolated. */
function artFixture({ reduced = false, reader = false, compileFails = false } = {}) {
  let active = true;
  let cursor = 0;
  let values: unknown[] = [];
  const effects: (() => void | (() => void))[] = [];
  const listeners = new Map<string, (value: boolean) => void>();
  const frames: boolean[] = [];
  let compiles = 0;
  let disposals = 0;
  const { transformSync } = require('@babel/core');
  const source = readFileSync(
    new URL('../../components/release-intro-art.tsx', import.meta.url),
    'utf8'
  );
  const code = transformSync(source, {
    filename: 'release-intro-art.tsx',
    babelrc: false,
    configFile: false,
    presets: ['@react-native/babel-preset'],
  }).code;
  const exports: Record<string, unknown> = {};
  runInNewContext(code, {
    exports,
    require: (name: string) => {
      if (name === 'react/jsx-runtime' || name.startsWith('@babel/runtime/')) return require(name);
      if (name === 'react')
        return {
          useState: (initial: unknown) => {
            const slot = cursor++;
            const state = values;
            if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
            return [
              state[slot],
              (next: unknown) => {
                state[slot] = next;
              },
            ];
          },
          useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
            const slot = cursor++;
            const previous = values[slot] as { deps: unknown[] } | undefined;
            if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
              effects.push(effect);
              values[slot] = { deps };
            }
          },
        };
      if (name === '@osuki-dev/ui')
        return { useThemeTokens: () => ({ colors: { primary: '#3366cc', text: '#222222' } }) };
      if (name === 'lucide-react-native')
        return { Workflow: 'Workflow', GitFork: 'GitFork', Layers3: 'Layers3' };
      if (name === '@/hooks/use-app-active') return { useAppActive: () => active };
      if (name === '@/lib/motion') return { timing: () => ({}) };
      if (name === '@/lib/release-intro-shader') return { RELEASE_INTRO_SKSL: 'shader' };
      if (name === 'react-native')
        return {
          View: 'View',
          StyleSheet: { create: (value: unknown) => value, absoluteFill: {}, hairlineWidth: 1 },
          AccessibilityInfo: {
            isScreenReaderEnabled: async () => reader,
            isReduceMotionEnabled: async () => reduced,
            addEventListener: (event: string, listener: (value: boolean) => void) => {
              listeners.set(event, listener);
              return { remove: () => listeners.delete(event) };
            },
          },
        };
      if (name === 'react-native-skia')
        return {
          Canvas: 'Canvas',
          Fill: 'Fill',
          Shader: 'Shader',
          Skia: {
            Color: () => [0.2, 0.4, 0.8, 1],
            RuntimeEffect: {
              Make: () => {
                compiles++;
                if (compileFails) throw new Error('unavailable');
                return { dispose: () => disposals++ };
              },
            },
          },
        };
      if (name === 'react-native-reanimated')
        return {
          useReducedMotion: () => reduced,
          useSharedValue: (value: unknown) => ({ get: () => value, set: () => {} }),
          useDerivedValue: (read: () => unknown) => ({ get: read }),
          useFrameCallback: () => ({ setActive: (value: boolean) => frames.push(value) }),
          withTiming: (value: number) => value,
          cancelAnimation: () => {},
        };
      throw new Error(name);
    },
  });
  const render = (component: Component, props: Record<string, unknown>, state: unknown[]) => {
    values = state;
    cursor = 0;
    return component(props);
  };
  const parentState: unknown[] = [];
  const gpu = (visible = true) => {
    const tree = render(exports.ReleaseIntroArt as Component, { scene: 1, visible }, parentState)!;
    return (tree.props.children as Element[]).find(
      (child) => child && typeof child.type === 'function'
    );
  };
  return {
    gpu,
    render,
    frames,
    listeners,
    flush: () => effects.splice(0).map((effect) => effect()),
    background: () => {
      active = false;
    },
    compiles: () => compiles,
    disposals: () => disposals,
  };
}

test('production art waits for accessibility, unmounts on exit/background and responds to live settings', async () => {
  const scope = artFixture();
  expect(scope.gpu()).toBeUndefined();
  const cleanup = scope.flush();
  await Promise.resolve();
  expect(scope.gpu()).toBeDefined();
  expect(scope.gpu(false)).toBeUndefined();
  scope.listeners.get('reduceMotionChanged')!(true);
  expect(scope.gpu()).toBeUndefined();
  scope.listeners.get('reduceMotionChanged')!(false);
  scope.listeners.get('screenReaderChanged')!(true);
  expect(scope.gpu()).toBeUndefined();
  scope.listeners.get('screenReaderChanged')!(false);
  expect(scope.gpu()).toBeDefined();
  scope.background();
  expect(scope.gpu()).toBeUndefined();
  cleanup.forEach((effect) => effect?.());
  expect(scope.listeners.size).toBe(0);
  expect(scope.compiles()).toBe(0);
});

test('production GPU owner stops its clock and releases its compiled effect on removal', async () => {
  const scope = artFixture();
  scope.gpu();
  scope.flush();
  await Promise.resolve();
  const owner = scope.gpu()!;
  scope.flush();
  const state: unknown[] = [];
  expect(scope.render(owner.type as Component, owner.props, state)).toBeNull();
  const ownerCleanup = scope.flush();
  expect(scope.compiles()).toBe(1);
  const field = scope.render(owner.type as Component, owner.props, state)!;
  scope.render(field.type as Component, field.props, []);
  const fieldCleanup = scope.flush();
  expect(scope.frames).toEqual([true]);
  fieldCleanup.forEach((effect) => effect?.());
  ownerCleanup.forEach((effect) => effect?.());
  expect(scope.frames).toEqual([true, false]);
  expect(scope.compiles()).toBe(1);
  expect(scope.disposals()).toBe(1);
});

test('a shader compile failure preserves the native emblem without starting a clock', async () => {
  const scope = artFixture({ compileFails: true });
  scope.gpu();
  scope.flush();
  await Promise.resolve();
  const owner = scope.gpu()!;
  scope.flush();
  const state: unknown[] = [];
  scope.render(owner.type as Component, owner.props, state);
  scope.flush();
  expect(scope.render(owner.type as Component, owner.props, state)).toBeNull();
  expect(scope.frames).toEqual([]);
});

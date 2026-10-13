import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import * as particles from '../release-intro-particles';

const require = createRequire(import.meta.url);
type Element = { type: unknown; props: { children?: unknown; [key: string]: unknown } };
type Component = (props: Record<string, unknown>) => Element | null;
type Shared = { get: () => unknown; set: (next: unknown) => void };
type Animation = { shared: Shared; duration: number; value: number };

/** Exercise the real ownership and transition effects with native modules isolated. */
function artFixture({ reduced = false, reader = false } = {}) {
  let active = true;
  let cursor = 0;
  let values: unknown[] = [];
  const effects: (() => void | (() => void))[] = [];
  const listeners = new Map<string, (value: boolean) => void>();
  const animations: Animation[] = [];
  const cancelled: Shared[] = [];
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
            const previous = values[slot] as { deps: unknown[]; cleanup?: () => void } | undefined;
            if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
              const next = { deps, cleanup: undefined as (() => void) | undefined };
              effects.push(() => {
                previous?.cleanup?.();
                next.cleanup = effect() || undefined;
                return next.cleanup;
              });
              values[slot] = next;
            }
          },
        };
      if (name === '@osuki-dev/ui')
        return { useThemeTokens: () => ({ colors: { primary: '#3366cc' } }) };
      if (name === 'lucide-react-native')
        return { Workflow: 'Workflow', GitFork: 'GitFork', Layers3: 'Layers3' };
      if (name === '@/hooks/use-app-active') return { useAppActive: () => active };
      if (name === '@/lib/release-intro-particles') return particles;
      if (name === 'react-native')
        return {
          View: 'View',
          StyleSheet: { create: (value: unknown) => value, absoluteFill: {} },
          AccessibilityInfo: {
            isScreenReaderEnabled: async () => reader,
            isReduceMotionEnabled: async () => reduced,
            addEventListener: (event: string, listener: (value: boolean) => void) => {
              listeners.set(event, listener);
              return { remove: () => listeners.delete(event) };
            },
          },
        };
      if (name === 'react-native-worklets') return { scheduleOnUI: (run: () => void) => run() };
      if (name === 'react-native-skia') return { Canvas: 'Canvas', Points: 'Points' };
      if (name === 'react-native-reanimated')
        return {
          Easing: { linear: 'linear' },
          ReduceMotion: { Never: 'never' },
          useReducedMotion: () => reduced,
          useSharedValue: (initial: unknown) => {
            const slot = cursor++;
            if (!(slot in values)) {
              let value = initial;
              const shared: Shared = {
                get: () => value,
                set: (next) => {
                  if (next && typeof next === 'object' && 'duration' in next) {
                    animations.push({ shared, ...(next as Omit<Animation, 'shared'>) });
                  } else value = next;
                },
              };
              values[slot] = shared;
            }
            return values[slot];
          },
          useDerivedValue: (read: () => unknown) => {
            const slot = cursor++;
            if (!(slot in values)) values[slot] = { get: read };
            return values[slot];
          },
          withTiming: (value: number, config: { duration: number }) => ({ value, ...config }),
          cancelAnimation: (shared: Shared) => cancelled.push(shared),
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
  const fieldState: unknown[] = [];
  const owner = (scene = 0, visible = true) => {
    const tree = render(exports.ReleaseIntroArt as Component, { scene, visible }, parentState)!;
    return (tree.props.children as Element[]).find(
      (child) => child && typeof child.type === 'function'
    );
  };
  return {
    owner,
    field: (scene = 0) => {
      const element = owner(scene)!;
      render(element.type as Component, element.props, fieldState);
      return fieldState[3] as { get: () => particles.IntroPoint[] };
    },
    animations,
    cancelled,
    listeners,
    flush: () => effects.splice(0).map((effect) => effect()),
    background: () => {
      active = false;
    },
  };
}

test('accessibility resolves before particles mount; live reduced motion shows a stable final motif', async () => {
  const scope = artFixture();
  expect(scope.owner()).toBeUndefined();
  const cleanup = scope.flush();
  await Promise.resolve();
  scope.field();
  scope.flush();
  expect(scope.animations).toHaveLength(1);
  scope.listeners.get('reduceMotionChanged')!(true);
  const positions = scope.field();
  scope.flush();
  expect(positions.get()).toEqual(particles.introParticlePositions({ scene: 0, from: null }, 1));
  expect(scope.animations).toHaveLength(1);
  scope.listeners.get('reduceMotionChanged')!(false);
  scope.field();
  scope.flush();
  expect(scope.animations).toHaveLength(2);
  expect(positions.get()).toEqual(particles.introParticlePositions({ scene: 0, from: null }, 0));
  scope.listeners.get('screenReaderChanged')!(true);
  scope.field();
  scope.flush();
  expect(positions.get()).toEqual(particles.introParticlePositions({ scene: 0, from: null }, 1));
  expect(scope.owner(0, false)).toBeUndefined();
  scope.background();
  expect(scope.owner()).toBeUndefined();
  cleanup.forEach((effect) => effect?.());
  expect(scope.listeners.size).toBe(0);
});

test('first entry and forward/back transitions animate from actual positions and cancel on removal', async () => {
  const scope = artFixture();
  scope.owner();
  scope.flush();
  await Promise.resolve();
  const positions = scope.field();
  scope.flush();
  expect(scope.animations[0]!.duration).toBe(particles.RELEASE_INTRO_FORMATION_MS);
  expect(positions.get()).toEqual(particles.introParticlePositions({ scene: 0, from: null }, 0));
  scope.animations[0]!.shared.set(0.45);
  const interrupted = positions.get();
  scope.field(1);
  scope.flush();
  expect(positions.get()).toEqual(interrupted);
  scope.animations[1]!.shared.set(0.5);
  const backFrom = positions.get();
  scope.field(0);
  const cleanup = scope.flush();
  expect(positions.get()).toEqual(backFrom);
  expect(scope.animations).toHaveLength(3);
  const cancellations = scope.cancelled.length;
  cleanup.forEach((effect) => effect?.());
  expect(scope.cancelled.length).toBe(cancellations + 1);
});

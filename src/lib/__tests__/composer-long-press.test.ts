import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { composerLongPress } from '../composer-long-press';

// Exercise the installed RN state machine, not a copy of its release rule.
// Isolated require stubs avoid process-wide native mocks affecting other tests.
const nodeRequire = createRequire(import.meta.url);
const { transformSync } = nodeRequire('@babel/core') as {
  transformSync: (source: string, options: Record<string, unknown>) => { code: string };
};
const source = readFileSync(
  nodeRequire.resolve('react-native/Libraries/Pressability/Pressability'),
  'utf8'
);
const code = transformSync(source, {
  filename: 'Pressability.js',
  babelrc: false,
  configFile: false,
  presets: ['@react-native/babel-preset'],
}).code;
const exports: Record<string, unknown> = {};
runInNewContext(code, {
  exports,
  setTimeout,
  clearTimeout,
  __DEV__: false,
  process: { env: { NODE_ENV: 'production' } },
  require: (name: string) => {
    if (name.startsWith('@babel/runtime/')) return nodeRequire(name);
    if (name === 'invariant')
      return (valid: boolean) => {
        if (!valid) throw new Error('Invalid RN transition');
      };
    if (name.endsWith('/Platform')) return { OS: 'android' };
    if (name.endsWith('/SoundManager')) return { playTouchSound() {} };
    if (name.endsWith('/UIManager')) return { measure() {} };
    if (name.endsWith('/ReactNativeFeatureFlags'))
      return { shouldPressibilityUseW3CPointerEventsForHover: () => false };
    if (name.endsWith('/HoverState')) return { isHoverEnabled: () => false };
    if (name.endsWith('/Rect')) return { normalizeRect: (value: unknown) => value };
    if (name.includes('PressabilityPerformanceEventEmitter')) return { emitEvent() {} };
    throw new Error(`Unexpected Pressability dependency: ${name}`);
  },
});
type Config = { onPress: () => void; onLongPress?: () => void; minPressDuration: number };
type Event = {
  currentTarget: number;
  persist: () => void;
  nativeEvent: { pageX: number; pageY: number; timestamp: number };
};
const Pressability = exports.default as new (config: Config) => {
  configure: (config: Config) => void;
  getEventHandlers: () => {
    onResponderGrant: (event: Event) => void;
    onResponderRelease: (event: Event) => void;
  };
  _handleLongPress: (event: Event) => void;
  _receiveSignal: (signal: string, event: Event) => void;
  reset: () => void;
};
const event: Event = {
  currentTarget: 1,
  persist() {},
  nativeEvent: { pageX: 10, pageY: 10, timestamp: 1 },
};

test('claimed voice cannot become Send when its action disappears before release', () => {
  let draft = 'Keep this draft';
  let recordings = 0;
  let action: (() => void) | undefined = () => {
    recordings++;
    action = undefined;
    pressability.configure(config);
  };
  const config = {
    minPressDuration: 0,
    onPress: () => {
      draft = '';
    },
    onLongPress: composerLongPress(() => action),
  };
  const pressability = new Pressability(config);
  const handlers = pressability.getEventHandlers();
  handlers.onResponderGrant(event);
  pressability._handleLongPress(event);
  // Moving out and back in is still the same consumed long-press gesture.
  pressability._receiveSignal('LEAVE_PRESS_RECT', event);
  pressability._receiveSignal('ENTER_PRESS_RECT', event);
  handlers.onResponderRelease(event);
  expect(recordings).toBe(1);
  expect(draft).toBe('Keep this draft');

  // Cancelling voice must not prevent the next intentional short Send press.
  handlers.onResponderGrant(event);
  handlers.onResponderRelease(event);
  expect(draft).toBe('');
  pressability.reset();
});

test('a long hold stays non-sending when voice is removed before the threshold', () => {
  let sends = 0;
  let recordings = 0;
  let action: (() => void) | undefined = () => {
    recordings++;
  };
  const config = {
    minPressDuration: 0,
    onPress: () => {
      sends++;
    },
    onLongPress: composerLongPress(() => action),
  };
  const pressability = new Pressability(config);
  const handlers = pressability.getEventHandlers();
  handlers.onResponderGrant(event);
  action = undefined;
  pressability.configure(config);
  pressability._handleLongPress(event);
  handlers.onResponderRelease(event);
  expect(recordings).toBe(0);
  expect(sends).toBe(0);
  pressability.reset();
});

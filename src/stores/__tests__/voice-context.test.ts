import { afterEach, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { claimVoiceInput, clearVoiceInput, deliverVoiceInput, useVoiceInput } from '../voice-input';

afterEach(() => useVoiceInput.setState({ request: null }));

// Execute the actual ownership hook against its production store. Isolated hook
// boundaries let the test inspect the render-before-effect window without RN.
const nodeRequire = createRequire(import.meta.url);
const source = readFileSync(
  new URL('../../components/voice-input-button.tsx', import.meta.url),
  'utf8'
);
const hookSource = source.slice(
  source.indexOf('export function useVoiceInputTrigger('),
  source.indexOf('export function VoiceInputPanel(')
);
const { transformSync } = nodeRequire('@babel/core') as {
  transformSync: (source: string, options: Record<string, unknown>) => { code: string };
};
const code = transformSync(hookSource, {
  filename: 'voice-hook.tsx',
  babelrc: false,
  configFile: false,
  presets: ['@react-native/babel-preset'],
}).code;

function fixture() {
  const owner = {};
  const delivered: string[] = [];
  let latest: unknown;
  let effects: { run: () => (() => void) | void; deps: unknown[] }[] = [];
  let committed: { deps: unknown[]; cleanup?: () => void }[] = [];
  const exports: Record<string, unknown> = {};
  runInNewContext(code, {
    exports,
    require: nodeRequire,
    useIsFocused: () => true,
    useState: () => [owner],
    useLatestReader: (value: unknown) => {
      latest = value;
      return () => latest;
    },
    useEffect: (run: () => (() => void) | void, deps: unknown[]) => {
      effects.push({ run, deps });
    },
    useVoiceSettings: Object.assign(
      (select: (state: { config: object }) => unknown) => select({ config: {} }),
      { getState: () => ({ config: {} }) }
    ),
    useVoiceInput: (select: (state: ReturnType<typeof useVoiceInput.getState>) => unknown) =>
      select(useVoiceInput.getState()),
    claimVoiceInput,
    clearVoiceInput,
    deliverVoiceInput,
    loadVoiceSettings: async () => {},
    voiceRecorderAvailable: () => true,
    Platform: { OS: 'android' },
    Keyboard: { dismiss() {} },
    VoiceInputPanel: 'VoiceInputPanel',
  });
  const hook = exports.useVoiceInputTrigger as (args: {
    context: string;
    disabled: boolean;
    onText: (text: string) => void;
  }) => { open?: () => void; panel: unknown };
  return {
    delivered,
    render(context: string) {
      effects = [];
      return hook({ context, disabled: false, onText: (text) => delivered.push(text) });
    },
    flushEffects() {
      committed = effects.map((effect, index) => {
        const previous = committed[index];
        if (
          previous &&
          previous.deps.length === effect.deps.length &&
          previous.deps.every((value, index) => Object.is(value, effect.deps[index]))
        )
          return previous;
        previous?.cleanup?.();
        return { deps: effect.deps, cleanup: effect.run() ?? undefined };
      });
    },
    unmount() {
      committed.forEach((effect) => effect.cleanup?.());
    },
  };
}

test('a retained workbench with an empty context immediately hides recording and clears its owner', () => {
  const scope = fixture();
  const home = scope.render('server-a/session-a');
  scope.flushEffects();
  home.open!();
  const request = useVoiceInput.getState().request!;
  expect(scope.render('server-a/session-a').panel).not.toBeNull();
  scope.flushEffects();
  const hidden = scope.render('');
  expect(hidden.open).toBeUndefined();
  expect(hidden.panel).toBeNull();
  scope.flushEffects();
  expect(useVoiceInput.getState().request).toBeNull();
  expect(deliverVoiceInput(request, 'late text')).toBe(false);
  expect(scope.delivered).toEqual([]);
  scope.unmount();
});

test('a session switch rejects a result even before context-change cleanup runs', () => {
  const scope = fixture();
  const initial = scope.render('server-a/session-a');
  scope.flushEffects();
  initial.open!();
  const stale = useVoiceInput.getState().request!;
  scope.render('server-b/session-b');
  deliverVoiceInput(stale, 'wrong session');
  expect(scope.delivered).toEqual([]);
  scope.flushEffects();
  const next = scope.render('server-b/session-b');
  next.open!();
  const current = useVoiceInput.getState().request!;
  expect(deliverVoiceInput(current, 'correct draft')).toBe(true);
  expect(scope.delivered).toEqual(['correct draft']);
  scope.unmount();
});

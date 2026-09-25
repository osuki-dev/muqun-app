import { RuleTester } from 'oxlint/plugins-dev';
import plugin from './index.ts';
RuleTester.describe = (_name, run) => run();
RuleTester.it = (_name, run) => run();

// The rule only looks at app source, so every case is filed under `src/`.
const filename = `${process.cwd()}/src/components/probe.tsx`;
const tsx = { parserOptions: { lang: 'tsx' as const } };

new RuleTester({ languageOptions: tsx }).run('react-compiler', plugin.rules['react-compiler']!, {
  valid: [
    {
      // The same write through the accessor the compiler understands.
      filename,
      code: `import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
export function Slide() {
  const x = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ opacity: x.value }));
  return <Animated.View style={style} onTouchStart={() => { x.set(1); }} />;
}`,
    },
    {
      filename,
      code: `import { useState } from 'react';
export function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>{count}</button>;
}`,
    },
    {
      // A Lingui tagged template with interpolations: React Doctor flags it,
      // but the macro expands it before the compiler ever sees it.
      filename,
      code: `import { useLingui } from '@lingui/react/macro';
export function Greeting({ name }: { name: string }) {
  const { t } = useLingui();
  return <span>{t\`Hello \${name}\`}</span>;
}`,
    },
    {
      // An explicit opt-out is a decision, not a finding.
      filename,
      code: `import { useRef } from 'react';
export function useLatest<T>(value: T) {
  'use no memo';
  const ref = useRef(value);
  ref.current = value;
  return ref;
}`,
    },
    {
      // A deferred shared-value read through \`.get()\`: the memo keys on the
      // stable shared value, not on what it holds.
      filename,
      code: `import { useSharedValue } from 'react-native-reanimated';
export function Handle() {
  const x = useSharedValue(0);
  const onMove = () => x.get() + 1;
  return <div onClick={onMove} />;
}`,
    },
    {
      // A render-time read keeps \`.value\`: moved to \`.get()\`, the compiler
      // would serve the first value on every later render.
      filename,
      code: `import { useSharedValue } from 'react-native-reanimated';
export function Now() {
  const x = useSharedValue(0);
  return <span>{x.value}</span>;
}`,
    },
  ],
  invalid: [
    {
      filename,
      code: `import { useCallback, useState } from 'react';
declare function save(): Promise<void>;
export function Saver() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async () => {
    setBusy(true);
    try { await save(); } finally { setBusy(false); }
  }, []);
  return <button disabled={busy} onClick={run} />;
}`,
      errors: 1,
    },
    {
      filename,
      code: `import { useRef } from 'react';
export function Peek({ value }: { value: number }) {
  const ref = useRef(value);
  return <span>{ref.current}</span>;
}`,
      errors: 1,
    },
    {
      filename,
      // A shared value a hook has already been handed, then written with
      // \`.value =\` -- the shape every one of these took in the app.
      code: `import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
export function Slide() {
  const x = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ opacity: x.value }));
  return <Animated.View style={style} onTouchStart={() => { x.value = 1; }} />;
}`,
      errors: 1,
    },
    {
      filename,
      // Compiles, but the memo is keyed on \`x.value\`.
      code: `import { useSharedValue } from 'react-native-reanimated';
export function Handle() {
  const x = useSharedValue(0);
  const onMove = () => x.value + 1;
  return <div onClick={onMove} />;
}`,
      errors: 1,
    },
  ],
});

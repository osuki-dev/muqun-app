import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';

import { productionSource, transpile, walk } from '@/test-support/production-source';

// Exercise the production transition effect without loading native modules.
const source = productionSource('src/components/home-composer-options.tsx');
let effect = '';
walk(source.program, (node) => {
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'useEffect' &&
    node.arguments[0]
  ) {
    effect = source.code(node.arguments[0]);
  }
});

function transition(
  open: boolean,
  options: { initialHeight?: number; synchronous?: boolean } = {}
) {
  const visibility: boolean[] = [];
  const heights: number[] = [];
  const animating: boolean[] = [];
  const pending: (() => void)[] = [];
  let latestOpen = open;
  let complete: ((finished: boolean) => void) | undefined;
  const dispose = runInNewContext(transpile(`(${effect})();`), {
    open,
    contentHeight: 240,
    readOpen: () => latestOpen,
    onVisibilityChange: (visible: boolean) => visibility.push(visible),
    onHeightAnimationChange: (value: boolean) => animating.push(value),
    visibleHeight: {
      get: () => options.initialHeight ?? (open ? 0 : 240),
      set: (height: number) => heights.push(height),
    },
    opacity: { set: () => {} },
    setShowModes: () => {},
    timing: (token: string) => token,
    withTiming: (value: number, _config: unknown, callback?: typeof complete) => {
      if (callback) complete = callback;
      if (options.synchronous) callback?.(true);
      return value;
    },
    scheduleOnRN: (callback: () => void) => pending.push(callback),
  }) as () => void;
  return {
    visibility,
    heights,
    animating,
    finish: (finished: boolean) => complete?.(finished),
    flush: () => pending.splice(0).forEach((callback) => callback()),
    setOpen: (value: boolean) => {
      latestOpen = value;
    },
    dispose,
  };
}

test('Home decoration stays hidden until options finish collapsing', () => {
  const opening = transition(true);
  expect(opening.visibility).toEqual([true]);
  expect(opening.heights).toEqual([240]);
  opening.finish(true);
  opening.flush();
  expect(opening.visibility).toEqual([true]);
  expect(opening.animating).toEqual([true, false]);

  const closing = transition(false);
  expect(closing.heights).toEqual([0]);
  expect(closing.visibility).toEqual([]);
  closing.finish(true);
  closing.flush();
  expect(closing.visibility).toEqual([false]);
  expect(closing.animating).toEqual([true, false]);
});

test('a cancelled collapse does not expose decoration under reopened options', () => {
  const closing = transition(false);
  closing.finish(false);
  closing.flush();
  expect(closing.visibility).toEqual([]);
  expect(closing.animating).toEqual([true]);
});

test('a queued UI completion cannot reveal decoration after a reopen render', () => {
  const closing = transition(false);
  closing.finish(true);
  closing.setOpen(true);
  closing.flush();
  expect(closing.visibility).toEqual([]);
  expect(closing.animating).toEqual([true]);
});

test('a queued old close cannot finish a newer close or an unmounted panel', () => {
  const closing = transition(false);
  closing.finish(true);
  closing.dispose();
  // The reader can be false again during another close; effect ownership must
  // reject the old completion independently of that current boolean.
  closing.setOpen(false);
  closing.flush();
  expect(closing.visibility).toEqual([]);
  expect(closing.animating).toEqual([true]);
});

test('a queued opening completion cannot finish a newly closing transition', () => {
  const opening = transition(true);
  opening.finish(true);
  opening.setOpen(false);
  opening.flush();
  expect(opening.animating).toEqual([true]);
});

test('an already collapsed or fully open panel never holds dock reporting', () => {
  expect(transition(false, { initialHeight: 0 }).animating).toEqual([false]);
  expect(transition(true, { initialHeight: 240 }).animating).toEqual([false]);
});

test('instant animation completion releases reporting without a timer', () => {
  const opening = transition(true, { synchronous: true });
  opening.flush();
  expect(opening.animating).toEqual([true, false]);
  const closing = transition(false, { synchronous: true });
  closing.flush();
  expect(closing.animating).toEqual([true, false]);
  expect(closing.visibility).toEqual([false]);
});

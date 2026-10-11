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

function transition(open: boolean) {
  const visibility: boolean[] = [];
  const heights: number[] = [];
  const pending: (() => void)[] = [];
  let latestOpen = open;
  let complete: ((finished: boolean) => void) | undefined;
  const dispose = runInNewContext(transpile(`(${effect})();`), {
    open,
    contentHeight: 240,
    readOpen: () => latestOpen,
    onVisibilityChange: (visible: boolean) => visibility.push(visible),
    visibleHeight: { set: (height: number) => heights.push(height) },
    opacity: { set: () => {} },
    setShowModes: () => {},
    timing: (token: string) => token,
    withTiming: (value: number, _config: unknown, callback?: typeof complete) => {
      if (callback) complete = callback;
      return value;
    },
    scheduleOnRN: (callback: () => void) => pending.push(callback),
  }) as () => void;
  return {
    visibility,
    heights,
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
  expect(opening.visibility).toEqual([true]);

  const closing = transition(false);
  expect(closing.heights).toEqual([0]);
  expect(closing.visibility).toEqual([]);
  closing.finish(true);
  closing.flush();
  expect(closing.visibility).toEqual([false]);
});

test('a cancelled collapse does not expose decoration under reopened options', () => {
  const closing = transition(false);
  closing.finish(false);
  closing.flush();
  expect(closing.visibility).toEqual([]);
});

test('a queued UI completion cannot reveal decoration after a reopen render', () => {
  const closing = transition(false);
  closing.finish(true);
  closing.setOpen(true);
  closing.flush();
  expect(closing.visibility).toEqual([]);
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
});

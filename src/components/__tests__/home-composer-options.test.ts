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
  let complete: ((finished: boolean) => void) | undefined;
  runInNewContext(transpile(`(${effect})();`), {
    open,
    contentHeight: 240,
    onVisibilityChange: (visible: boolean) => visibility.push(visible),
    visibleHeight: { set: (height: number) => heights.push(height) },
    opacity: { set: () => {} },
    setShowModes: () => {},
    timing: (token: string) => token,
    withTiming: (value: number, _config: unknown, callback?: typeof complete) => {
      if (callback) complete = callback;
      return value;
    },
    scheduleOnRN: (callback: (value: boolean) => void, value: boolean) => callback(value),
  });
  return { visibility, heights, finish: (finished: boolean) => complete?.(finished) };
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
  expect(closing.visibility).toEqual([false]);
});

test('a cancelled collapse does not expose decoration under reopened options', () => {
  const closing = transition(false);
  closing.finish(false);
  expect(closing.visibility).toEqual([]);
});

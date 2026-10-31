import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/** Exercise the shipped MVCP state machine, without simulating React or native rendering. */
function resize(options: {
  entry: string;
  previous: number;
  size: number;
  contentLength: number;
  scrollLength: number;
  scroll?: number;
  initial?: boolean;
  hasScrollTarget?: boolean;
}) {
  const entry = new URL(options.entry, import.meta.resolve('@legendapp/list/react-native'));
  const source = readFileSync(entry, 'utf8');
  const start = source.indexOf('function prepareMVCP(');
  const end = source.indexOf('// src/platform/flushSync.native.ts', start);
  if (start < 0 || end <= start)
    throw new Error('Review the Legend List MVCP patch for this version');
  const adjustments: number[] = [];
  const key = 'message';
  const state = {
    idsInView: [key],
    positions: [0],
    props: { data: [key], maintainVisibleContentPosition: { data: false, size: true } },
    indexByKey: new Map([[key, 0]]),
    scroll: options.scroll ?? 0,
    scrollLength: options.scrollLength,
    didContainersLayout: true,
    ...(options.hasScrollTarget === false
      ? {}
      : {
          scrollingTo: {
            key,
            index: 0,
            viewPosition: 1,
            itemSize: options.previous,
            isInitialScroll: options.initial ?? true,
          },
        }),
  };
  const prepare = runInNewContext(`(${source.slice(start, end)})`, {
    Platform: { OS: 'ios' },
    IsNewArchitecture: true,
    MVCP_POSITION_EPSILON: 0.1,
    resolveAnchorLock: () => undefined,
    getContentSize: () => options.contentLength,
    getId: () => key,
    getItemSize: () => options.size,
    updateAnchorLock: () => {},
    shouldQueueNativeMVCPAdjust: () => false,
    requestAdjust: (_ctx: unknown, delta: number) => {
      adjustments.push(delta);
      state.scroll += delta;
    },
  });
  prepare({ state }, false, 'item-size')();
  return { scroll: state.scroll, adjustments };
}

for (const entry of ['react-native.mjs', 'react-native.js']) {
  test(`${entry}: initial end placement never scrolls a short row outside its viewport`, () => {
    expect(
      resize({ entry, previous: 40, size: 298, contentLength: 340, scrollLength: 1096.5 })
    ).toEqual({ scroll: 0, adjustments: [] });
  });

  test(`${entry}: initial end growth uses only the newly available scroll range`, () => {
    expect(
      resize({ entry, previous: 400, size: 900, contentLength: 942, scrollLength: 800 })
    ).toEqual({ scroll: 142, adjustments: [142] });
    expect(
      resize({
        entry,
        previous: 1500,
        size: 1758,
        contentLength: 2058,
        scrollLength: 800,
        scroll: 1000,
      })
    ).toEqual({ scroll: 1258, adjustments: [258] });
  });

  test(`${entry}: initial end shrink stops at the start instead of producing a negative offset`, () => {
    expect(
      resize({ entry, previous: 900, size: 100, contentLength: 142, scrollLength: 800 })
    ).toEqual({ scroll: 0, adjustments: [] });
  });

  test(`${entry}: ordinary scroll targets and a reader's existing anchor retain their behavior`, () => {
    expect(
      resize({
        entry,
        previous: 40,
        size: 298,
        contentLength: 340,
        scrollLength: 1096.5,
        initial: false,
      })
    ).toEqual({ scroll: 258, adjustments: [258] });
    expect(
      resize({
        entry,
        previous: 40,
        size: 298,
        contentLength: 340,
        scrollLength: 1096.5,
        scroll: 200,
        hasScrollTarget: false,
      })
    ).toEqual({ scroll: 200, adjustments: [] });
  });
}

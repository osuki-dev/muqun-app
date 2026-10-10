import { expect, test } from 'bun:test';

import { homeRefreshDelay } from '../home-refresh-schedule';

test('an answering computer is asked on its cadence, a failing one backs off to five minutes', () => {
  const cases: [failures: number, socketLive: boolean, seconds: number][] = [
    [0, false, 30],
    [0, true, 60],
    [1, false, 30],
    [2, true, 60],
    [3, false, 120],
    [4, false, 240],
    [5, false, 300],
    [9, true, 300],
  ];
  expect(cases.map(([failures, live]) => homeRefreshDelay(failures, live) / 1000)).toEqual(
    cases.map(([, , seconds]) => seconds)
  );
});

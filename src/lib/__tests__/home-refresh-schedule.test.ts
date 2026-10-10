import { expect, test } from 'bun:test';

import { homeRefreshDue, type HomeRefreshAttempt } from '../home-refresh-schedule';

test('when a computer is asked again', () => {
  const at = (failures: number, liveAtFailure?: boolean): HomeRefreshAttempt => ({
    atMs: 0,
    failures,
    ...(liveAtFailure === undefined ? {} : { liveAtFailure }),
  });
  const cases: [
    name: string,
    attempt: HomeRefreshAttempt | undefined,
    seconds: number,
    socketLive: boolean,
    live: boolean,
    due: boolean,
  ][] = [
    ['never asked', undefined, 0, false, false, true],
    ['a tick a hair early still counts', at(0), 29.5, false, true, true],
    ['an open socket halves the polling', at(0), 45, true, true, false],
    ['a failing computer backs off', at(3, false), 100, false, false, false],
    ['down when it failed, answering now: at once', at(3, false), 1, false, true, true],
    ['reads failing while it answers: no bypass', at(3, true), 100, false, true, false],
    ['the backoff stops at five minutes', at(9, true), 300, false, true, true],
  ];
  expect(
    cases.map(([name, attempt, seconds, socketLive, live]) => [
      name,
      homeRefreshDue(attempt, seconds * 1000, socketLive, live),
    ])
  ).toEqual(cases.map(([name, , , , , due]) => [name, due]));
});

import { expect, test } from 'bun:test';

import {
  buildLaunchModel,
  LAUNCH_SCROLL_MAX_WIDTH,
  launchRowLayout,
} from '../../lib/home-launch-model';

test('the cover column (~370pt) gives compact tiles two usable columns', () => {
  const cover = launchRowLayout({ width: 370, grid: true, agentCount: 3, utilityCount: 4 });
  // (370 - 2 × 8) / 3 and (370 - 8) / 2.
  expect(cover).toEqual({
    mode: 'grid',
    columns: 3,
    agentColumns: 3,
    agentWidth: 118,
    utilityColumns: 2,
    utilityWidth: 181,
  });
});

test('the embedded Pad column (~1000pt) lays the utilities out four across', () => {
  const embedded = launchRowLayout({ width: 1000, grid: true, agentCount: 3, utilityCount: 4 });
  // (1000 - 2 × 8) / 3 and (1000 - 3 × 8) / 4.
  expect(embedded).toEqual({
    mode: 'grid',
    columns: 4,
    agentColumns: 3,
    agentWidth: 328,
    utilityColumns: 4,
    utilityWidth: 244,
  });
});

const discoveryWith = (ids: string[]) =>
  ({
    checkedAtMs: 1,
    agents: {
      supported: true,
      features: {},
      agents: ids.map((id) => ({
        id,
        kind: id,
        name: id,
        enabled: true,
        status: 'connected',
        features: {},
      })),
    },
  }) as unknown as NonNullable<Parameters<typeof buildLaunchModel>[0]>['discovery'];

test('the phone row is unchanged: it scrolls under 560pt and wraps above', () => {
  const phone = { grid: false, agentCount: 3, utilityCount: 4 };
  expect(launchRowLayout({ ...phone, width: 0 })).toEqual({ mode: 'scroll' });
  expect(launchRowLayout({ ...phone, width: 375 })).toEqual({ mode: 'scroll' });
  expect(launchRowLayout({ ...phone, width: LAUNCH_SCROLL_MAX_WIDTH })).toEqual({ mode: 'wrap' });
});

test('a Pad Home lays the launch area out as a grid and never scrolls sideways', () => {
  for (const width of [0, 320, 560, 900, 1400]) {
    expect(launchRowLayout({ width, grid: true, agentCount: 5, utilityCount: 4 }).mode).toBe(
      'grid'
    );
  }
  // Every agent gets a tile; nothing collapses behind "More agents".
  const padKinds = buildLaunchModel({
    discovery: discoveryWith(['a', 'b', 'c', 'd']),
    maxAgentTiles: Number.POSITIVE_INFINITY,
  }).entries.map((entry) => entry.kind);
  expect(padKinds).toEqual([
    'agent',
    'agent',
    'agent',
    'agent',
    'sessions',
    'terminal',
    'new-terminal',
    'ssh',
  ]);
});

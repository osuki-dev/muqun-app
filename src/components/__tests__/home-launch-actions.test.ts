import { expect, test } from 'bun:test';
import { LAUNCH_GRID_GAP, launchRowLayout } from '../../lib/home-launch-model';

test('three agents form a lead tile beside a stacked pair on phone and Pad', () => {
  for (const width of [320, 370, 1000]) {
    const layout = launchRowLayout({ width, agentCount: 3, utilityCount: 4 });
    expect(layout.agentRows.map((row) => row.map((cell) => cell.indices))).toEqual([[[0], [1, 2]]]);
    expect(layout.agentRows[0]![0]!.featured).toBe(true);
    expect(layout.utilityWidth).toBe(width < 640 ? Math.floor((width - 8) / 2) : 244);
  }
});

test('one and two agents keep simple rows; wider layouts balance larger inventories', () => {
  for (const agentCount of [1, 2]) {
    const layout = launchRowLayout({ width: 370, agentCount, utilityCount: 0 });
    expect(layout.agentRows).toHaveLength(1);
    expect(layout.agentRows[0]).toHaveLength(agentCount);
  }
  const five = launchRowLayout({ width: 1000, agentCount: 5, utilityCount: 4 });
  expect(five.agentRows.map((row) => row.length)).toEqual([3, 2]);
});

test('every agent remains reachable once, in order, without horizontal overflow or orphan rows', () => {
  for (const width of [280, 320, 370, 560, 640, 900, 1400]) {
    for (let agentCount = 1; agentCount <= 20; agentCount++) {
      const { agentRows } = launchRowLayout({ width, agentCount, utilityCount: 4 });
      expect(agentRows.flatMap((row) => row.flatMap((cell) => cell.indices))).toEqual(
        Array.from({ length: agentCount }, (_, index) => index)
      );
      for (const row of agentRows) {
        expect(
          row.reduce((total, cell) => total + cell.width, (row.length - 1) * LAUNCH_GRID_GAP)
        ).toBeLessThanOrEqual(width);
        expect(row.every((cell) => cell.width >= 136)).toBe(true);
        if (agentCount > 1) expect(row.length).toBeGreaterThan(1);
      }
    }
  }
});

test('unmeasured or invalid width cannot produce negative geometry', () => {
  for (const width of [0, -20, Number.NaN]) {
    const layout = launchRowLayout({ width, agentCount: 5, utilityCount: 4 });
    expect(layout.agentRows.flat().every((cell) => cell.width === 0)).toBe(true);
    expect(layout.utilityWidth).toBe(0);
  }
});

import { expect, test } from 'bun:test';
import { LAUNCH_GRID_GAP, launchRowLayout } from '../../lib/home-launch-model';

test('phones group consecutive agents in horizontally scrolling pairs for every count', () => {
  for (const width of [280, 320, 370, 560, 640, 900]) {
    for (let agentCount = 0; agentCount <= 20; agentCount++) {
      const layout = launchRowLayout({ width, agentCount, utilityCount: 4 });
      expect(layout.mode).toBe('scroll');
      expect(layout.agentRows.length).toBe(agentCount ? 1 : 0);
      const cells = layout.agentRows.flat();
      expect(cells.flatMap((cell) => cell.indices)).toEqual(
        Array.from({ length: agentCount }, (_, index) => index)
      );
      expect(cells).toHaveLength(Math.ceil(agentCount / 2));
      for (const cell of cells) {
        expect(cell.indices.length).toBe(cell.featured ? 1 : 2);
        expect(cell.width).toBeGreaterThanOrEqual(160);
        expect(cell.width).toBeLessThanOrEqual(220);
        expect(cell.width).toBe(layout.utilityWidth);
      }
    }
  }
});

test('one agent fills a column, two stack, and an odd final agent fills its column', () => {
  for (const [agentCount, expected] of [
    [1, [[0]]],
    [2, [[0, 1]]],
    [3, [[0, 1], [2]]],
    [
      4,
      [
        [0, 1],
        [2, 3],
      ],
    ],
    [5, [[0, 1], [2, 3], [4]]],
  ] as const) {
    const cells = launchRowLayout({ width: 370, agentCount, utilityCount: 4 }).agentRows[0]!;
    expect(cells.map((cell) => cell.indices)).toEqual(expected.map((pair) => [...pair]));
    expect(cells.at(-1)?.featured).toBe(agentCount % 2 === 1);
  }
});

test('phone columns reveal the next column and allow overflow instead of wrapping below', () => {
  for (const width of [280, 320, 370, 430]) {
    const { agentRows } = launchRowLayout({ width, agentCount: 4, utilityCount: 4 });
    const row = agentRows[0]!;
    expect(row[0]!.width + LAUNCH_GRID_GAP).toBeLessThan(width);
    expect(row.reduce((total, cell) => total + cell.width, LAUNCH_GRID_GAP)).toBeGreaterThan(width);
  }
});

test('Pad fits four agents across once each has room, and keeps every additional agent', () => {
  for (const [width, columns] of [
    [280, 2],
    [423, 2],
    [424, 3],
    [567, 3],
    [568, 4],
    [640, 4],
    [1000, 4],
  ] as const) {
    for (let agentCount = 0; agentCount <= 20; agentCount++) {
      const layout = launchRowLayout({ width, agentCount, utilityCount: 4, grid: true });
      expect(layout.mode).toBe('grid');
      expect(layout.agentRows.flatMap((row) => row.flatMap((cell) => cell.indices))).toEqual(
        Array.from({ length: agentCount }, (_, index) => index)
      );
      expect(layout.agentRows).toHaveLength(Math.ceil(agentCount / columns));
      for (const row of layout.agentRows) {
        expect(row.length).toBeLessThanOrEqual(columns);
        expect(row.every((cell) => cell.indices.length === 1 && !cell.featured)).toBe(true);
        expect(
          row.reduce((total, cell) => total + cell.width, (row.length - 1) * LAUNCH_GRID_GAP)
        ).toBeLessThanOrEqual(width);
        expect(row.every((cell) => cell.width >= 136)).toBe(true);
      }
    }
  }
});

test('unmeasured or invalid widths cannot produce negative geometry in either presentation', () => {
  for (const grid of [false, true]) {
    for (const width of [0, -20, Number.NaN]) {
      const layout = launchRowLayout({ width, agentCount: 5, utilityCount: 4, grid });
      expect(layout.agentRows.flat().every((cell) => cell.width === 0)).toBe(true);
      expect(layout.utilityWidth).toBe(0);
    }
  }
});

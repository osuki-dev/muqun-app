import { describe, expect, test } from 'bun:test';
import { chunkCardRows } from './theme-grid-rows';

type Cell = { id: string };

const keyOf = (cell: Cell) => cell.id;
const same = (a: Cell, b: Cell) => a === b;
const cells = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

describe('chunkCardRows', () => {
  test('splits cells into rows with their grid start and a short last row', () => {
    const rows = chunkCardRows(cells, 2, 220, keyOf, same);
    expect(rows.map((row) => [row.start, row.cells.map(keyOf)])).toEqual([
      [0, ['a', 'b']],
      [2, ['c', 'd']],
      [4, ['e']],
    ]);
  });

  test('a row height or column count change gives every row a new key', () => {
    const before = chunkCardRows(cells, 2, 220, keyOf, same).map((row) => row.key);
    const taller = chunkCardRows(cells, 2, 236, keyOf, same).map((row) => row.key);
    const wider = chunkCardRows(cells, 3, 220, keyOf, same).map((row) => row.key);
    for (const key of [...taller, ...wider]) expect(before).not.toContain(key);
    expect(new Set(before).size).toBe(before.length);
  });

  test('reuses unchanged rows and rebuilds the ones whose cards changed', () => {
    const first = chunkCardRows(cells, 2, 220, keyOf, same);
    // A page appended: the full rows are the same objects, the short one grows.
    const more = [...cells, { id: 'f' }, { id: 'g' }];
    const second = chunkCardRows(more, 2, 220, keyOf, same, first);
    expect(second[0]).toBe(first[0]!);
    expect(second[1]).toBe(first[1]!);
    expect(second[2]).not.toBe(first[2]!);
    expect(second[2]!.cells.map(keyOf)).toEqual(['e', 'f']);
    // A card replaced by an equal-keyed but different object is redrawn.
    const replaced = [{ id: 'a' }, ...more.slice(1)];
    expect(chunkCardRows(replaced, 2, 220, keyOf, same, second)[0]).not.toBe(second[0]!);
  });

  test('a row that moved in the grid is not reused', () => {
    const first = chunkCardRows(cells, 2, 220, keyOf, same);
    const shifted = chunkCardRows([{ id: 'z' }, { id: 'y' }, ...cells], 2, 220, keyOf, same, first);
    expect(shifted[1]!.start).toBe(2);
    expect(shifted[1]).not.toBe(first[0]!);
  });
});

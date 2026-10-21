/**
 * The themes sheet's card grid as rows of one virtualized list.
 *
 * The list caches every row's size under the row's key for as long as the list
 * lives: a data change, a `dataKey` change or a new `getFixedItemSize` does not
 * forget it. A key that once stood for a row of one height therefore keeps
 * that height when the row is drawn at another -- a sheet measured wider than
 * the window it was first laid out in, a rotation, a Pad split -- and the rows
 * after it overlap or leave gaps until each is scrolled into view and measured
 * again. So a row's key names the geometry it was sized for as well as its
 * first card: a new height is a new key, and no cached size can outlive it.
 *
 * Rows keep their identity across builds while their cards are the same ones,
 * so appending a page or a state change elsewhere in the sheet does not hand
 * every mounted row a new item and re-render it.
 */

export type CardRow<Cell> = {
  kind: 'cards';
  key: string;
  /** The index of the row's first card in the whole grid. */
  start: number;
  cells: readonly Cell[];
};

/** The key of a row of `columns` cards each `height` tall, led by `firstKey`. */
export function cardRowKey(firstKey: string, columns: number, height: number): string {
  return `${firstKey}@${columns}x${height}`;
}

/**
 * Cells into rows of `columns`, reusing a row of `previous` whose key and
 * cells are unchanged. `sameCell` says whether two cells draw the same thing.
 */
export function chunkCardRows<Cell>(
  cells: readonly Cell[],
  columns: number,
  height: number,
  keyOf: (cell: Cell) => string,
  sameCell: (a: Cell, b: Cell) => boolean,
  previous: readonly CardRow<Cell>[] = []
): CardRow<Cell>[] {
  const reusable = new Map(previous.map((row) => [row.key, row]));
  const rows: CardRow<Cell>[] = [];
  const width = Math.max(1, Math.floor(columns));
  for (let start = 0; start < cells.length; start += width) {
    const slice = cells.slice(start, start + width);
    const key = cardRowKey(keyOf(slice[0]!), width, height);
    const old = reusable.get(key);
    const same =
      old !== undefined &&
      old.start === start &&
      old.cells.length === slice.length &&
      old.cells.every((cell, index) => sameCell(cell, slice[index]!));
    rows.push(same ? old : { kind: 'cards', key, start, cells: slice });
  }
  return rows;
}

import { describe, expect, test } from 'bun:test';

import { heldOrder } from '../home-sort-hold';

describe('heldOrder', () => {
  const items = (...keys: string[]) => keys.map((key) => ({ key }));
  // shown order, newly sorted items -> what is drawn
  test.each<[string, string[], string[], string[]]>([
    ['nothing held: the sort as given', ['a', 'b'], ['a', 'b'], ['a', 'b']],
    ['an item that rose keeps its old place', ['a', 'b', 'c'], ['c', 'a', 'b'], ['a', 'b', 'c']],
    ['an arrival joins at the end', ['a', 'b'], ['n', 'b', 'a'], ['a', 'b', 'n']],
    ['an item that went is dropped', ['a', 'b', 'c'], ['c', 'a'], ['a', 'c']],
  ])('%s', (_name, shown, sorted, drawn) => {
    expect(heldOrder(shown, items(...sorted), (item) => item.key).map((item) => item.key)).toEqual(
      drawn
    );
  });
});

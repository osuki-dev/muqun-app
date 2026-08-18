// When a server card is allowed to spend a line on an address.
//
// The rule is one sentence: an address is a disambiguator, so it appears when
// it is disambiguating and not otherwise. These tests hold down the edges of
// "disambiguating" -- case, whitespace, blanks, and the difference between a
// pair and a crowd -- because every one of them is a way for a card to either
// print noise or hide the one fact that tells two machines apart.
import { describe, expect, test } from 'bun:test';

import { serverIdsNeedingAddress, type NamedServer } from '../server-address';

function servers(...pairs: [string, string][]): NamedServer[] {
  return pairs.map(([serverId, label]) => ({ serverId, label }));
}

describe('serverIdsNeedingAddress', () => {
  test('an empty list needs nothing', () => {
    expect(serverIdsNeedingAddress([]).size).toBe(0);
  });

  test('one server never shows its address', () => {
    expect(serverIdsNeedingAddress(servers(['a', 'mac-mini'])).size).toBe(0);
  });

  test('distinct names stay quiet however many there are', () => {
    const needed = serverIdsNeedingAddress(
      servers(['a', 'mac-mini'], ['b', 'studio'], ['c', 'thinkpad'])
    );
    expect(needed.size).toBe(0);
  });

  test('both halves of a collision show their address, not just the second', () => {
    const needed = serverIdsNeedingAddress(servers(['a', 'mac-mini'], ['b', 'mac-mini']));
    expect([...needed].sort()).toEqual(['a', 'b']);
  });

  test('a collision does not drag the unambiguous names in with it', () => {
    const needed = serverIdsNeedingAddress(
      servers(['a', 'mac-mini'], ['b', 'mac-mini'], ['c', 'studio'])
    );
    expect([...needed].sort()).toEqual(['a', 'b']);
  });

  test('three of a name is still a collision', () => {
    const needed = serverIdsNeedingAddress(
      servers(['a', 'box'], ['b', 'box'], ['c', 'box'])
    );
    expect([...needed].sort()).toEqual(['a', 'b', 'c']);
  });

  // `===` says these differ. A reader scanning the list cannot tell them apart,
  // and the list is what the rule is about.
  test('case is not a distinction a reader can see', () => {
    const needed = serverIdsNeedingAddress(servers(['a', 'mac-mini'], ['b', 'Mac-Mini']));
    expect([...needed].sort()).toEqual(['a', 'b']);
  });

  test('neither is trailing whitespace', () => {
    const needed = serverIdsNeedingAddress(servers(['a', 'mac-mini '], ['b', ' mac-mini']));
    expect([...needed].sort()).toEqual(['a', 'b']);
  });

  test('two unnamed servers are indistinguishable, so both show their address', () => {
    const needed = serverIdsNeedingAddress(servers(['a', ''], ['b', '   ']));
    expect([...needed].sort()).toEqual(['a', 'b']);
  });

  test('one unnamed server is still unambiguous', () => {
    expect(serverIdsNeedingAddress(servers(['a', ''], ['b', 'studio'])).size).toBe(0);
  });
});

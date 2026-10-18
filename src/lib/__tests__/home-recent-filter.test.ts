import { describe, expect, test } from 'bun:test';

import {
  filterHomeRecent,
  homeContinueServerId,
  homeRecentFilterIds,
  type HomeContinueEntry,
} from '../home-continue';

function pane(key: string, serverId: string): HomeContinueEntry {
  return { key, title: key, atMs: 1, destination: { type: 'pane', serverId, paneId: key } };
}

const ssh = {
  key: 'ssh',
  title: 'ssh',
  atMs: 1,
  destination: { type: 'recent', target: { kind: 'ssh-host', hostId: 'h' } },
} as unknown as HomeContinueEntry;

describe('Recent filter chips', () => {
  const entries = [pane('a1', 'a'), pane('b1', 'b'), pane('a2', 'a'), ssh];

  test('each row knows its computer; an SSH host has none', () => {
    expect(entries.map(homeContinueServerId)).toEqual(['a', 'b', 'a', undefined]);
  });

  test('one chip per computer with rows, in the reader’s order, only when there is a choice', () => {
    expect(homeRecentFilterIds(entries, ['c', 'b', 'a'])).toEqual(['b', 'a']);
    expect(homeRecentFilterIds([pane('a1', 'a'), ssh], ['a', 'b'])).toEqual([]);
  });

  test('a chip narrows the list; no chip keeps every row', () => {
    expect(filterHomeRecent(entries, 'a').map((entry) => entry.key)).toEqual(['a1', 'a2']);
    expect(filterHomeRecent(entries, null)).toBe(entries);
  });
});

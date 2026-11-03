import { expect, test } from 'bun:test';
import type { HomeContinueEntry } from '../home-continue';
import {
  computerSessionBadges,
  computerSessionEntries,
  homeSessionUrgency,
  sessionsOutsideCards,
} from '../home-computer-sessions';
import { SERVER_AGENTS_STALE_AFTER_MS } from '../server-agents';

const NOW = 10 * SERVER_AGENTS_STALE_AFTER_MS;

function pane(
  key: string,
  serverId: string,
  observation?: HomeContinueEntry['observation']
): HomeContinueEntry {
  return {
    key,
    title: key,
    atMs: 0,
    destination: { type: 'pane', serverId, paneId: key },
    ...(observation ? { observation } : {}),
  };
}
const agent = (status: 'working' | 'blocked' | 'idle', pendingUserInput?: boolean, atMs = NOW) =>
  ({ kind: 'gateway-agent', status, pendingUserInput, observedAtMs: atMs, seen: {} }) as const;
const session = (status: 'busy' | 'idle' | 'retry', atMs = NOW) =>
  ({ kind: 'agent-session', status, observedAtMs: atMs, seen: {} }) as const;

test('urgency: the ledger task wins, then a current observation; stale or idle is quiet', () => {
  const stale = NOW - SERVER_AGENTS_STALE_AFTER_MS - 1;
  const cases: [
    HomeContinueEntry,
    Parameters<typeof homeSessionUrgency>[1],
    number,
    ReturnType<typeof homeSessionUrgency>,
  ][] = [
    [pane('t', 'a', session('idle')), 'waiting', 0, 0],
    [pane('t', 'a', session('idle')), 'working', 0, 1],
    [pane('t', 'a', session('busy')), 'done', 0, 2],
    [pane('p', 'a', agent('idle', true)), undefined, 0, 0],
    [pane('p', 'a', agent('blocked')), undefined, 0, 0],
    [pane('p', 'a', agent('working')), undefined, 0, 1],
    [pane('s', 'a', session('retry')), undefined, 0, 1],
    [pane('s', 'a', session('busy', stale)), undefined, 0, 2],
    // A newer "still the same" keeps an old observation current.
    [pane('s', 'a', session('busy', stale)), undefined, NOW, 1],
    [pane('n', 'a'), undefined, 0, 2],
  ];
  for (const [entry, taskState, confirmedAtMs, expected] of cases)
    expect(homeSessionUrgency(entry, taskState, confirmedAtMs, NOW)).toBe(expected);
});

test('one computer: needs-you, then running, then the rest, each in Continue order', () => {
  const entries = [
    pane('idle-new', 'a', agent('idle')),
    pane('other-computer', 'b', agent('working')),
    pane('run-1', 'a', agent('working')),
    pane('idle-old', 'a'),
    pane('needs', 'a', agent('idle', true)),
    pane('run-2', 'a', session('busy')),
  ];
  const urgency = (entry: HomeContinueEntry) => homeSessionUrgency(entry, undefined, 0, NOW);
  expect(computerSessionEntries(entries, 'a', urgency).map((entry) => entry.key)).toEqual([
    'needs',
    'run-1',
    'run-2',
    'idle-new',
    'idle-old',
  ]);
  expect(computerSessionBadges(entries, urgency)).toEqual({
    a: { needsYou: 1, running: 2 },
    b: { needsYou: 0, running: 1 },
  });
});

test('rows no listed card holds stay outside the cards: SSH hosts and unlisted computers', () => {
  const ssh: HomeContinueEntry = {
    key: 'ssh',
    title: 'ssh',
    atMs: 0,
    destination: { type: 'recent', target: { kind: 'ssh-host', hostId: 'h' } },
  };
  const entries = [pane('a1', 'a'), pane('b1', 'b'), ssh];
  expect(sessionsOutsideCards(entries, ['a']).map((entry) => entry.key)).toEqual(['b1', 'ssh']);
});

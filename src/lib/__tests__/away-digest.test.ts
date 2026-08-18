/**
 * The rules behind "while you were away": the capability gate, the threshold,
 * what survives parsing, and above all what the summariser is allowed to say --
 * that a pane which was blocked and then finished is reported as finished, that
 * a rename does not split one pane into two rows, and that nothing to report
 * means no card rather than an empty one.
 */
import { describe, expect, test } from 'bun:test';

import {
  AWAY_THRESHOLD_MS,
  MAX_DIGEST_ROWS,
  agentEventsFromResponse,
  awayDurationParts,
  gatewaySupportsAgentEvents,
  keepRecentlyViewedServers,
  parseServerLastViewedIndex,
  summariseAwayEvents,
  wasAwayLongEnough,
  type AgentEvent,
} from '../away-digest';

const NOW = 1_800_000_000_000;
const SINCE = NOW - 60 * 60 * 1000;

function event(patch: Partial<AgentEvent> & Pick<AgentEvent, 'atMs'>): AgentEvent {
  return {
    paneId: 'pane-1',
    agent: 'claude',
    from: 'working',
    to: 'idle',
    ...patch,
  };
}

describe('the capability gate', () => {
  test('an older gateway is never asked', () => {
    expect(gatewaySupportsAgentEvents(['pane_parts', 'tasks'])).toBe(false);
    expect(gatewaySupportsAgentEvents([])).toBe(false);
    expect(gatewaySupportsAgentEvents(undefined)).toBe(false);
    expect(gatewaySupportsAgentEvents(null)).toBe(false);
  });

  test('a gateway that keeps the ring says so', () => {
    expect(gatewaySupportsAgentEvents(['pane_approvals', 'agent_events'])).toBe(true);
  });
});

describe('the threshold', () => {
  test('stepping away for a moment is not being away', () => {
    expect(wasAwayLongEnough(NOW - 60_000, NOW)).toBe(false);
    expect(wasAwayLongEnough(NOW - (AWAY_THRESHOLD_MS - 1), NOW)).toBe(false);
  });

  test('fifteen minutes is away', () => {
    expect(wasAwayLongEnough(NOW - AWAY_THRESHOLD_MS, NOW)).toBe(true);
    expect(wasAwayLongEnough(NOW - 3 * AWAY_THRESHOLD_MS, NOW)).toBe(true);
  });

  test('a server never opened before has no absence to summarise', () => {
    expect(wasAwayLongEnough(null, NOW)).toBe(false);
    expect(wasAwayLongEnough(undefined, NOW)).toBe(false);
    expect(wasAwayLongEnough(0, NOW)).toBe(false);
    expect(wasAwayLongEnough(Number.NaN, NOW)).toBe(false);
  });

  test('a mark in the future is a clock that moved, not a window', () => {
    expect(wasAwayLongEnough(NOW + AWAY_THRESHOLD_MS, NOW)).toBe(false);
  });
});

describe('parsing the ring', () => {
  test("the ring's own envelope becomes events", () => {
    expect(
      agentEventsFromResponse({
        session_id: 'default',
        capacity: 200,
        missed: false,
        next_since: 4,
        events: [
          { seq: 4, pane_id: 'w1:p1', agent: 'claude', from: 'working', to: 'done', unix_ms: NOW },
        ],
      })
    ).toEqual([
      { paneId: 'w1:p1', agent: 'claude', from: 'working', to: 'done', atMs: NOW },
    ]);
  });

  // The endpoint was specified with `at` and shipped with `unix_ms`. A client
  // that understands only one of them shows an empty digest against a gateway
  // that speaks the other, and shows it silently.
  test('`at` is read where `unix_ms` is absent', () => {
    const [parsed] = agentEventsFromResponse({
      events: [{ pane_id: 'pane-1', agent: 'claude', from: 'working', to: 'done', at: NOW }],
    });
    expect(parsed.atMs).toBe(NOW);
  });

  test('`unix_ms` wins where both are present', () => {
    const [parsed] = agentEventsFromResponse({
      events: [
        { pane_id: 'pane-1', agent: 'claude', to: 'done', unix_ms: NOW, at: NOW - 5_000 },
      ],
    });
    expect(parsed.atMs).toBe(NOW);
  });

  test('an absent `from` is unknown rather than a dropped event', () => {
    // The ring leaves `from` out for the first thing it ever saw a pane do.
    const [parsed] = agentEventsFromResponse({
      events: [{ seq: 1, pane_id: 'pane-1', agent: 'claude', to: 'done', unix_ms: NOW }],
    });
    expect(parsed.from).toBe('unknown');
    expect(parsed.to).toBe('done');
  });

  test('a status this build has no name for reads as unknown', () => {
    const [parsed] = agentEventsFromResponse({
      events: [
        { pane_id: 'pane-1', agent: 'claude', from: 'idle', to: 'compacting', unix_ms: NOW },
      ],
    });
    expect(parsed.to).toBe('unknown');
  });

  test('an event that cannot be ordered or labelled is not an event', () => {
    expect(
      agentEventsFromResponse({
        events: [
          { pane_id: 'pane-1', agent: 'claude', to: 'done' },
          { pane_id: 'pane-1', agent: 'claude', to: 'done', unix_ms: 'noon' },
          { pane_id: '', agent: '  ', to: 'done', unix_ms: NOW },
          null,
          'nope',
        ],
      })
    ).toEqual([]);
  });

  test('anything that is not the envelope is no events at all', () => {
    expect(agentEventsFromResponse(null)).toEqual([]);
    expect(agentEventsFromResponse({})).toEqual([]);
    expect(agentEventsFromResponse({ events: 'soon' })).toEqual([]);
    expect(agentEventsFromResponse([])).toEqual([]);
  });
});

describe('summarising the window', () => {
  test('nothing happened means no card', () => {
    expect(summariseAwayEvents([], { sinceMs: SINCE, nowMs: NOW })).toBeNull();
  });

  test('where an agent ended up beats what it did on the way', () => {
    const digest = summariseAwayEvents(
      [
        event({ from: 'idle', to: 'working', atMs: SINCE + 1_000 }),
        event({ from: 'working', to: 'blocked', atMs: SINCE + 2_000 }),
        event({ from: 'blocked', to: 'working', atMs: SINCE + 3_000 }),
        event({ from: 'working', to: 'done', atMs: SINCE + 4_000 }),
      ],
      { sinceMs: SINCE, nowMs: NOW }
    );

    expect(digest?.rows).toHaveLength(1);
    expect(digest?.rows[0]).toMatchObject({
      agent: 'claude',
      paneId: 'pane-1',
      status: 'done',
      blocked: 1,
      finished: true,
      transitions: 4,
      atMs: SINCE + 4_000,
    });
    expect(digest?.transitions).toBe(4);
  });

  test('how often it stopped to ask survives the summary', () => {
    const digest = summariseAwayEvents(
      [
        event({ from: 'working', to: 'blocked', atMs: SINCE + 1_000 }),
        event({ from: 'blocked', to: 'working', atMs: SINCE + 2_000 }),
        event({ from: 'working', to: 'blocked', atMs: SINCE + 3_000 }),
        event({ from: 'blocked', to: 'working', atMs: SINCE + 4_000 }),
        event({ from: 'working', to: 'done', atMs: SINCE + 5_000 }),
      ],
      { sinceMs: SINCE, nowMs: NOW }
    );

    expect(digest?.rows[0].blocked).toBe(2);
    expect(digest?.rows[0].status).toBe('done');
  });

  test('a status that did not change is not news', () => {
    expect(
      summariseAwayEvents(
        [
          event({ from: 'working', to: 'working', atMs: SINCE + 1_000 }),
          event({ from: 'idle', to: 'idle', atMs: SINCE + 2_000 }),
        ],
        { sinceMs: SINCE, nowMs: NOW }
      )
    ).toBeNull();
  });

  test('anything from before the user left is not "while you were away"', () => {
    expect(
      summariseAwayEvents(
        [
          event({ from: 'idle', to: 'done', atMs: SINCE - 1 }),
          event({ from: 'idle', to: 'done', atMs: SINCE }),
        ],
        { sinceMs: SINCE, nowMs: NOW }
      )
    ).toBeNull();
  });

  test('the pane is the identity, so a rename is still one row', () => {
    const digest = summariseAwayEvents(
      [
        event({ agent: 'claude', from: 'idle', to: 'working', atMs: SINCE + 1_000 }),
        event({ agent: 'Dark mode', from: 'working', to: 'done', atMs: SINCE + 2_000 }),
      ],
      { sinceMs: SINCE, nowMs: NOW }
    );

    expect(digest?.rows).toHaveLength(1);
    // The latest name it was seen under, not the first.
    expect(digest?.rows[0].agent).toBe('Dark mode');
  });

  test('two panes running the same binary are two rows', () => {
    const digest = summariseAwayEvents(
      [
        event({ paneId: 'pane-1', from: 'idle', to: 'done', atMs: SINCE + 1_000 }),
        event({ paneId: 'pane-2', from: 'idle', to: 'done', atMs: SINCE + 2_000 }),
      ],
      { sinceMs: SINCE, nowMs: NOW }
    );

    expect(digest?.rows.map((row) => row.paneId)).toEqual(['pane-2', 'pane-1']);
  });

  test('an event with no pane still groups, by name', () => {
    const digest = summariseAwayEvents(
      [event({ paneId: '', agent: 'codex', from: 'idle', to: 'working', atMs: SINCE + 1_000 })],
      { sinceMs: SINCE, nowMs: NOW }
    );

    expect(digest?.rows[0].key).toBe('agent:codex');
    expect(digest?.rows[0].agent).toBe('codex');
  });

  test('most recent first, whatever order the ring answered in', () => {
    const digest = summariseAwayEvents(
      [
        event({ paneId: 'pane-2', agent: 'nvim', to: 'idle', atMs: SINCE + 9_000 }),
        event({ paneId: 'pane-1', agent: 'claude', to: 'done', atMs: SINCE + 30_000 }),
        event({ paneId: 'pane-3', agent: 'codex', from: 'idle', to: 'working', atMs: SINCE + 20_000 }),
      ],
      { sinceMs: SINCE, nowMs: NOW }
    );

    expect(digest?.rows.map((row) => row.agent)).toEqual(['claude', 'codex', 'nvim']);
  });

  test('a card is four rows and a count, not a wall', () => {
    const digest = summariseAwayEvents(
      Array.from({ length: 7 }, (_, index) =>
        event({
          paneId: `pane-${index}`,
          agent: `agent-${index}`,
          atMs: SINCE + (index + 1) * 1_000,
        })
      ),
      { sinceMs: SINCE, nowMs: NOW }
    );

    expect(digest?.rows).toHaveLength(MAX_DIGEST_ROWS);
    expect(digest?.otherAgents).toBe(3);
    // The most recent four, since they are ordered before they are cut.
    expect(digest?.rows.map((row) => row.agent)).toEqual([
      'agent-6',
      'agent-5',
      'agent-4',
      'agent-3',
    ]);
  });

  test('two agents on the same millisecond come out in a stable order', () => {
    const rows = () =>
      summariseAwayEvents(
        [
          event({ paneId: 'pane-b', agent: 'b', atMs: SINCE + 1_000 }),
          event({ paneId: 'pane-a', agent: 'a', atMs: SINCE + 1_000 }),
        ],
        { sinceMs: SINCE, nowMs: NOW }
      )?.rows.map((row) => row.key);

    expect(rows()).toEqual(['pane-a', 'pane-b']);
    expect(rows()).toEqual(rows());
  });
});

describe('how long you were gone', () => {
  test('minutes, hours, days', () => {
    expect(awayDurationParts({ sinceMs: NOW - 47 * 60_000, untilMs: NOW })).toEqual({
      unit: 'minute',
      value: 47,
    });
    expect(awayDurationParts({ sinceMs: NOW - 3 * 3_600_000, untilMs: NOW })).toEqual({
      unit: 'hour',
      value: 3,
    });
    expect(awayDurationParts({ sinceMs: NOW - 2 * 86_400_000, untilMs: NOW })).toEqual({
      unit: 'day',
      value: 2,
    });
  });

  test('never zero: nothing under the threshold gets this far', () => {
    expect(awayDurationParts({ sinceMs: NOW, untilMs: NOW })).toEqual({
      unit: 'minute',
      value: 1,
    });
  });
});

describe('the stored visit marks', () => {
  test('a well-formed index reads back', () => {
    expect(parseServerLastViewedIndex('{"a":123,"b":456}')).toEqual({ a: 123, b: 456 });
  });

  test('anything that is not a timestamp is dropped rather than defaulted', () => {
    expect(
      parseServerLastViewedIndex('{"a":"soon","b":0,"c":-1,"d":null,"e":789,"":1}')
    ).toEqual({ e: 789 });
  });

  test('a file that is not an index at all is no marks', () => {
    expect(parseServerLastViewedIndex('nonsense')).toEqual({});
    expect(parseServerLastViewedIndex('[1,2,3]')).toEqual({});
    expect(parseServerLastViewedIndex('null')).toEqual({});
  });

  test('unpairing a server forgets when it was last opened', () => {
    expect(keepRecentlyViewedServers({ a: 1, b: 2 }, ['b'])).toEqual({ b: 2 });
  });

  test('a long-lived install keeps only the most recently viewed', () => {
    const index = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`server-${i}`, i + 1])
    );
    const kept = keepRecentlyViewedServers(index, Object.keys(index));

    expect(Object.keys(kept)).toHaveLength(24);
    expect(kept['server-29']).toBe(30);
    expect(kept['server-0']).toBeUndefined();
  });
});

import { expect, test } from 'bun:test';

import {
  EMPTY_GONE_SESSIONS,
  hiddenSessionKeys,
  markSessionGone,
  resolveSuspectedSessions,
  suspectSession,
  type AgentSessionListing,
  type GoneSessionsState,
} from '../gone-agent-sessions';
import { goneSessionKey } from '../home-continue';

const row = (asid: string, agentId = 'claude', deleted?: true) => ({
  asid,
  agentId,
  ...(deleted ? { deleted } : {}),
});
const listing = (over: Partial<AgentSessionListing> = {}): AgentSessionListing => ({
  serverId: 'desk',
  observedAtMs: 200,
  seen: [],
  complete: true,
  searched: [],
  ...over,
});
const suspected = (asid: string, agentId?: string) => ({
  serverId: 'desk',
  asid,
  suspectedAtMs: 100,
  ...(agentId ? { agentId } : {}),
});

test('a 404 hides the session, and the next listing decides whether it was gone', () => {
  const cases: {
    name: string;
    agentId?: string;
    listing: AgentSessionListing;
    verdict: 'restored' | 'gone' | 'suspected';
  }[] = [
    {
      name: 'listed again',
      agentId: 'claude',
      listing: listing({ seen: [row('s1')] }),
      verdict: 'restored',
    },
    {
      name: 'listed again, owner unknown to the device',
      listing: listing({ seen: [row('s1', 't3')] }),
      verdict: 'restored',
    },
    {
      name: 'omitted by a complete listing the owner answered',
      agentId: 'claude',
      listing: listing({ seen: [row('other')] }),
      verdict: 'gone',
    },
    {
      name: 'omitted while the owner is not attached yet (no rows of its own)',
      agentId: 'claude',
      listing: listing({ seen: [row('other', 't3')] }),
      verdict: 'suspected',
    },
    {
      name: 'omitted by a full page without its folder searched',
      agentId: 'claude',
      listing: listing({ seen: [row('other')], complete: false }),
      verdict: 'suspected',
    },
    {
      name: 'omitted by a full page with its folder searched',
      agentId: 'claude',
      listing: listing({ seen: [row('other')], complete: false, searched: ['s1'] }),
      verdict: 'gone',
    },
    {
      name: 'the same id under another agent is not this session',
      agentId: 'claude',
      listing: listing({ seen: [row('s1', 't3'), row('other')] }),
      verdict: 'gone',
    },
    {
      name: 'listed as deleted',
      agentId: 'claude',
      listing: listing({ seen: [row('s1', 'claude', true)], complete: false }),
      verdict: 'gone',
    },
    {
      name: 'another computer listed',
      agentId: 'claude',
      listing: listing({ serverId: 'laptop', seen: [] }),
      verdict: 'suspected',
    },
    {
      name: 'a listing read before the 404 says nothing either way',
      agentId: 'claude',
      listing: listing({ seen: [row('s1')], observedAtMs: 50 }),
      verdict: 'suspected',
    },
  ];
  for (const c of cases) {
    const key = goneSessionKey('desk', 's1', c.agentId);
    const before = suspectSession(EMPTY_GONE_SESSIONS, suspected('s1', c.agentId));
    expect({ name: c.name, hidden: hiddenSessionKeys(before).has(key) }).toEqual({
      name: c.name,
      hidden: true,
    });
    const { state, gone } = resolveSuspectedSessions(before, c.listing);
    expect({
      name: c.name,
      gone: gone.map((s) => s.asid),
      confirmed: state.gone.size,
      suspected: state.suspected.length,
      hidden: hiddenSessionKeys(state).has(key),
    }).toEqual({
      name: c.name,
      gone: c.verdict === 'gone' ? ['s1'] : [],
      confirmed: c.verdict === 'gone' ? 1 : 0,
      suspected: c.verdict === 'suspected' ? 1 : 0,
      hidden: c.verdict !== 'restored',
    });
  }
});

test('a deletion the user made stays gone when the listing still carries the row', () => {
  const deleted = markSessionGone(EMPTY_GONE_SESSIONS, 'desk', 's1', 'claude');
  const { state, gone } = resolveSuspectedSessions(deleted, listing({ seen: [row('s1')] }));
  expect(gone).toEqual([]);
  expect(state).toBe(deleted);
  expect(hiddenSessionKeys(state).has(goneSessionKey('desk', 's1', 'claude'))).toBe(true);
  // Suspecting a session already confirmed gone changes nothing.
  expect(suspectSession(deleted, suspected('s1', 'claude'))).toBe(deleted);
});

test('a listing settles each suspected session on its own', () => {
  let state: GoneSessionsState = EMPTY_GONE_SESSIONS;
  for (const asid of ['back', 'dead', 'unknown'])
    state = suspectSession(state, suspected(asid, 'claude'));
  state = suspectSession(state, suspected('dead', 'claude'));
  expect(state.suspected).toHaveLength(3);
  const settled = resolveSuspectedSessions(
    state,
    listing({ seen: [row('back')], complete: false, searched: ['dead'] })
  );
  expect(settled.gone.map((s) => s.asid)).toEqual(['dead']);
  expect(settled.state.suspected.map((s) => s.asid)).toEqual(['unknown']);
  expect([...settled.state.gone]).toEqual([goneSessionKey('desk', 'dead', 'claude')]);
});

import { describe, expect, test } from 'bun:test';
import type { HomeAgentEntry } from '@/lib/home-commands';
import {
  homeAgentHref,
  padAgentRouteParams,
  padRouteHandoff,
  phoneAgentParams,
} from '@/lib/pad-detail';

const target: HomeAgentEntry = {
  kind: 'agent-session',
  serverId: 's1',
  sessionId: 'herdr',
  asid: 'a1',
  directory: '/w',
  agentId: 'opencode',
};

describe('padAgentRouteParams', () => {
  test('carries the agent target onto the workspace route', () => {
    expect(padAgentRouteParams(target, 'existing')).toEqual({
      serverId: 's1',
      sessionId: 'herdr',
      asid: 'a1',
      directory: '/w',
      agentId: 'opencode',
    });
  });
  test('a new session drops the asid and says new', () => {
    expect(padAgentRouteParams(target, 'new')).toEqual({
      serverId: 's1',
      sessionId: 'herdr',
      directory: '/w',
      agentId: 'opencode',
      intent: 'new',
    });
  });
  test('empties are dropped', () => {
    expect(padAgentRouteParams({ kind: 'agent-session', serverId: 's1' }, 'existing')).toEqual({
      serverId: 's1',
    });
  });
});

describe('homeAgentHref', () => {
  test('Pad goes straight to the workspace route, never through /agent', () => {
    expect(homeAgentHref(target, 'existing', true)).toEqual({
      pathname: '/servers/[serverId]',
      params: padAgentRouteParams(target, 'existing'),
    });
  });
  test('a phone opens /agent with its server param', () => {
    expect(homeAgentHref(target, 'new', false)).toEqual({
      pathname: '/agent',
      params: {
        server: 's1',
        sessionId: 'herdr',
        directory: '/w',
        agentId: 'opencode',
        intent: 'new',
      },
    });
  });
});

describe('padRouteHandoff', () => {
  test('a terminal route hands off its terminal target', () => {
    expect(padRouteHandoff({ serverId: 's1', sessionId: 'main', paneId: 'p1' })).toEqual({
      target: { kind: 'gateway-terminal', serverId: 's1', sessionId: 'main', paneId: 'p1' },
    });
  });
  test('an agent route carries the agent through the handoff', () => {
    expect(
      padRouteHandoff({
        serverId: 's1',
        sessionId: 'herdr',
        asid: 'a1',
        directory: '/w',
        agentId: 'x',
      })
    ).toEqual({
      target: { kind: 'gateway-terminal', serverId: 's1' },
      agent: {
        target: {
          kind: 'agent-session',
          serverId: 's1',
          sessionId: 'herdr',
          asid: 'a1',
          directory: '/w',
          agentId: 'x',
        },
        intent: 'existing',
      },
    });
  });
  test('a new-session route carries intent and no asid', () => {
    expect(
      padRouteHandoff({ serverId: 's1', intent: 'new', asid: 'stale', directory: '/w' })
    ).toEqual({
      target: { kind: 'gateway-terminal', serverId: 's1' },
      agent: {
        target: { kind: 'agent-session', serverId: 's1', directory: '/w' },
        intent: 'new',
      },
    });
  });
});

describe('phoneAgentParams', () => {
  test('maps an agent detail back onto /agent', () => {
    expect(
      phoneAgentParams({
        kind: 'agent',
        serverId: 's1',
        sessionId: 'herdr',
        asid: 'a1',
        directory: '/w',
        nonce: 3,
      })
    ).toEqual({ server: 's1', sessionId: 'herdr', asid: 'a1', directory: '/w' });
  });
  test('a new detail keeps its intent', () => {
    expect(
      phoneAgentParams({
        kind: 'agent',
        serverId: 's1',
        sessionId: 'herdr',
        intent: 'new',
        agentId: 'x',
      })
    ).toEqual({ server: 's1', sessionId: 'herdr', agentId: 'x', intent: 'new' });
  });
});

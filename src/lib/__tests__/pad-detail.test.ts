import { describe, expect, test } from 'bun:test';
import { initialPadShellState, padShellReducer, type PadShellState } from '@/lib/pad-detail';

const target = {
  kind: 'agent-session',
  serverId: 's1',
  sessionId: 'herdr',
  directory: '/w',
  asid: 'a1',
  agentId: 't3',
} as never;

describe('padShellReducer', () => {
  test('open-agent swaps detail and hides home', () => {
    const s = padShellReducer(
      { ...initialPadShellState, overviewVisible: true },
      { type: 'open-agent', target, intent: 'existing' }
    );
    expect(s.detail).toEqual({
      kind: 'agent',
      serverId: 's1',
      sessionId: 'herdr',
      asid: 'a1',
      directory: '/w',
      agentId: 't3',
      intent: undefined,
    });
    expect(s.overviewVisible).toBe(false);
  });
  test('open-agent with new intent drops the asid', () => {
    const s = padShellReducer(initialPadShellState, { type: 'open-agent', target, intent: 'new' });
    expect(s.detail).toMatchObject({ kind: 'agent', asid: undefined, intent: 'new' });
  });
  test('open-agent without a sessionId falls back to herdr', () => {
    const bare = { kind: 'agent-session', serverId: 's1' } as never;
    const s = padShellReducer(initialPadShellState, {
      type: 'open-agent',
      target: bare,
      intent: 'existing',
    });
    expect(s.detail).toMatchObject({ kind: 'agent', sessionId: 'herdr' });
  });
  test('open-pane returns to the pane detail', () => {
    const agent: PadShellState = {
      detail: { kind: 'agent', serverId: 's1', sessionId: 'herdr' },
      overviewVisible: false,
    };
    expect(padShellReducer(agent, { type: 'open-pane' }).detail).toEqual({ kind: 'pane' });
  });
  test('show-home keeps the detail underneath', () => {
    const agent: PadShellState = {
      detail: { kind: 'agent', serverId: 's1', sessionId: 'herdr' },
      overviewVisible: false,
    };
    const s = padShellReducer(agent, { type: 'show-home' });
    expect(s.overviewVisible).toBe(true);
    expect(s.detail.kind).toBe('agent');
  });
  test('route with asid opens that agent and hides home', () => {
    const s = padShellReducer(initialPadShellState, {
      type: 'route',
      serverId: 's1',
      params: { asid: 'a9', sessionId: 'herdr' },
    });
    expect(s.detail).toMatchObject({ kind: 'agent', asid: 'a9', serverId: 's1' });
    expect(s.overviewVisible).toBe(false);
  });
  test('route with overview=home shows home', () => {
    const s = padShellReducer(initialPadShellState, {
      type: 'route',
      serverId: 's1',
      params: { overview: 'home' },
    });
    expect(s.overviewVisible).toBe(true);
  });
  test('route without agent params is a no-op', () => {
    expect(
      padShellReducer(initialPadShellState, { type: 'route', serverId: 's1', params: {} })
    ).toBe(initialPadShellState);
  });
});

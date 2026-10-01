import { describe, expect, test } from 'bun:test';
import {
  initialPadShellState,
  padRouteKey,
  padShellReducer,
  shouldApplyRoute,
  type PadShellState,
} from '@/lib/pad-detail';

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
  test('two new opens for the same directory are different details', () => {
    const first = padShellReducer(initialPadShellState, {
      type: 'open-agent',
      target,
      intent: 'new',
    });
    const second = padShellReducer(first, { type: 'open-agent', target, intent: 'new' });
    const a = first.detail.kind === 'agent' ? first.detail.nonce : undefined;
    const b = second.detail.kind === 'agent' ? second.detail.nonce : undefined;
    expect(typeof a).toBe('number');
    expect(typeof b).toBe('number');
    expect(b).not.toBe(a);
  });
  test('route intent=new after an open-agent new gets a new nonce', () => {
    const first = padShellReducer(initialPadShellState, {
      type: 'open-agent',
      target,
      intent: 'new',
    });
    const second = padShellReducer(first, {
      type: 'route',
      serverId: 's1',
      params: { intent: 'new', directory: '/w' },
    });
    const a = first.detail.kind === 'agent' ? first.detail.nonce : undefined;
    const b = second.detail.kind === 'agent' ? second.detail.nonce : undefined;
    expect(b).not.toBe(a);
  });
  test('an existing open has no nonce', () => {
    const fromNew = padShellReducer(initialPadShellState, {
      type: 'open-agent',
      target,
      intent: 'new',
    });
    const s = padShellReducer(fromNew, { type: 'open-agent', target, intent: 'existing' });
    expect(s.detail).toMatchObject({ kind: 'agent', asid: 'a1' });
    expect(s.detail.kind === 'agent' ? s.detail.nonce : 'pane').toBeUndefined();
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
  test('route with asid and overview=home: home wins and the detail is left alone', () => {
    const s = padShellReducer(initialPadShellState, {
      type: 'route',
      serverId: 's1',
      params: { asid: 'a9', overview: 'home' },
    });
    expect(s.overviewVisible).toBe(true);
    expect(s.detail).toEqual({ kind: 'pane' });
  });
  test('route overview=home is a no-op when home is already visible', () => {
    const shown: PadShellState = { ...initialPadShellState, overviewVisible: true };
    expect(
      padShellReducer(shown, { type: 'route', serverId: 's1', params: { overview: 'home' } })
    ).toBe(shown);
  });
  test('hide-home hides home and keeps the detail', () => {
    const agent: PadShellState = {
      detail: { kind: 'agent', serverId: 's1', sessionId: 'herdr' },
      overviewVisible: true,
    };
    const s = padShellReducer(agent, { type: 'hide-home' });
    expect(s.overviewVisible).toBe(false);
    expect(s.detail).toBe(agent.detail);
  });
  test('route intent=new drops the asid', () => {
    const s = padShellReducer(initialPadShellState, {
      type: 'route',
      serverId: 's1',
      params: { asid: 'a9', intent: 'new', directory: '/w' },
    });
    expect(s.detail).toMatchObject({
      kind: 'agent',
      asid: undefined,
      intent: 'new',
      directory: '/w',
    });
  });
});

describe('route once-per-key guard', () => {
  const base = { asid: 'a1', sessionId: 'herdr', directory: '/w', agentId: 't3' };
  const apply = (applied: string | null, serverId: string, params: typeof base) => {
    const key = padRouteKey(serverId, params);
    return { applied: shouldApplyRoute(applied, key), key };
  };
  test('first landing applies, identical params do not reapply', () => {
    const first = apply(null, 's1', base);
    expect(first.applied).toBe(true);
    expect(apply(first.key, 's1', { ...base }).applied).toBe(false);
  });
  test('asid change applies', () => {
    const { key } = apply(null, 's1', base);
    expect(apply(key, 's1', { ...base, asid: 'a2' }).applied).toBe(true);
  });
  test('directory-only change applies', () => {
    const { key } = apply(null, 's1', base);
    expect(apply(key, 's1', { ...base, directory: '/other' }).applied).toBe(true);
  });
  test('agentId-only change applies', () => {
    const { key } = apply(null, 's1', base);
    expect(apply(key, 's1', { ...base, agentId: 'codex' }).applied).toBe(true);
  });
  test('serverId change applies', () => {
    const { key } = apply(null, 's1', base);
    expect(apply(key, 's2', base).applied).toBe(true);
  });
});

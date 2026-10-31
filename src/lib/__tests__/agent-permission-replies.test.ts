import { describe, expect, test } from 'bun:test';

import { PermissionReplyGate, samePermissionReplyOwner } from '../agent-permission-replies';
import { parsePermissionRequest } from '../agent-protocol';

const pending = {
  id: 'request',
  asid: 'session',
  action: 'shell',
  resources: ['bun test'],
  save: [],
  prompt: '',
  options: [],
};

describe('permission reply ownership and delivery', () => {
  test('authorization names both the exact session scope and pairing object', () => {
    const connection = {};
    const owner = { scope: 'server:device:agent:session:generation', connection };
    expect(samePermissionReplyOwner(owner, { ...owner })).toBe(true);
    expect(samePermissionReplyOwner(owner, { ...owner, scope: 'different-session' })).toBe(false);
    expect(samePermissionReplyOwner(owner, { ...owner, connection: {} })).toBe(false);
    expect(samePermissionReplyOwner(null, owner)).toBe(false);
  });

  test('snapshot and stream duplicates share a single flight; failure stays manual', () => {
    const gate = new PermissionReplyGate();
    const owner = { scope: 'session', connection: {} };
    gate.replace(owner, [pending]);
    const ticket = gate.begin(owner, pending, true)!;
    expect(ticket).not.toBeNull();
    gate.add(owner, pending);
    expect(gate.begin(owner, pending, true)).toBeNull();
    expect(gate.begin(owner, pending, false)).toBeNull();
    gate.finish(ticket, false);
    gate.replace(owner, [pending]);
    expect(gate.begin(owner, pending, true)).toBeNull();
    const manual = gate.begin(owner, pending, false)!;
    expect(manual).not.toBeNull();
    gate.finish(manual, true);
    expect(gate.replace(owner, [pending])).toEqual([]);
    expect(gate.add(owner, pending)).toBe(false);
    expect(gate.begin(owner, pending, false)).toBeNull();
  });

  test('only actual pending requests can reply, and old completions cannot affect a new owner', () => {
    const gate = new PermissionReplyGate();
    const owner = { scope: 'first', connection: {} };
    gate.enter(owner);
    expect(gate.begin(owner, pending, true)).toBeNull();
    gate.add(owner, pending);
    const old = gate.begin(owner, pending, true)!;
    gate.resolve(owner, pending);
    gate.finish(old, false);
    expect(gate.begin(owner, pending, false)).toBeNull();
    const next = { ...owner, scope: 'next' };
    gate.replace(next, [pending]);
    const current = gate.begin(next, pending, true)!;
    gate.finish(old, true);
    expect(gate.begin(next, pending, false)).toBeNull();
    gate.finish(current, false);
    expect(gate.begin(next, pending, false)).not.toBeNull();
    expect(gate.begin(owner, pending, false)).toBeNull();
  });

  test('an unknown wire decision is never interpreted as allow', () => {
    const request = parsePermissionRequest({
      ...pending,
      options: [{ index: 0, label: 'Future scope', decision: 'future' }],
    });
    expect(request?.options).toEqual([]);
  });
});

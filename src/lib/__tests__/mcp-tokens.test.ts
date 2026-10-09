import { describe, expect, test } from 'bun:test';

import { MCP_SERVER_CAPABILITY, hasMcpServer, parseMcpToken, parseTokenList } from '../mcp-tokens';

describe('parseMcpToken', () => {
  test('a pane token with an expiry', () => {
    expect(
      parseMcpToken({
        id: 'k1',
        binding: { kind: 'pane', session_id: 's', pane_id: 'p' },
        label: 'build pane',
        issued_ms: 10,
        expires_ms: 99,
        last_used_ms: 50,
      })
    ).toEqual({
      id: 'k1',
      binding: { kind: 'pane', sessionId: 's', paneId: 'p' },
      label: 'build pane',
      issuedMs: 10,
      expiresMs: 99,
      lastUsedMs: 50,
    });
  });

  test('null expiry stays null and an agent binding parses', () => {
    expect(
      parseMcpToken({
        id: 'k2',
        binding: { kind: 'agent', agent_id: 'claude' },
        label: 'l',
        issued_ms: 1,
        expires_ms: null,
      })
    ).toEqual({
      id: 'k2',
      binding: { kind: 'agent', agentId: 'claude' },
      label: 'l',
      issuedMs: 1,
      expiresMs: null,
    });
  });

  test('a revoked token, or one without a usable binding, is dropped', () => {
    const ok = { id: 'k', binding: { kind: 'agent', agent_id: 'a' }, label: '', issued_ms: 1 };
    expect(parseMcpToken({ ...ok, revoked_ms: 5 })).toBeNull();
    expect(parseMcpToken({ ...ok, binding: { kind: 'other' } })).toBeNull();
    expect(parseMcpToken({ ...ok, id: undefined })).toBeNull();
  });

  test('capability', () => {
    expect(hasMcpServer([MCP_SERVER_CAPABILITY])).toBe(true);
    expect(hasMcpServer(undefined)).toBe(false);
  });
});

describe('last_used_ms of zero', () => {
  test('reads as never used', () => {
    const token = parseMcpToken({
      id: 'k3',
      binding: { kind: 'agent', agent_id: 'claude' },
      last_used_ms: 0,
    });
    expect(token?.lastUsedMs).toBeUndefined();
    expect(token && 'lastUsedMs' in token).toBe(false);
  });
});

describe('parseTokenList', () => {
  test('a body without a tokens array is a failure, not an empty list', () => {
    expect(parseTokenList({})).toBeNull();
    expect(parseTokenList({ tokens: 'x' })).toBeNull();
    expect(parseTokenList(null)).toBeNull();
  });

  test('an empty array is an empty list', () => {
    expect(parseTokenList({ tokens: [] })).toEqual([]);
  });
});

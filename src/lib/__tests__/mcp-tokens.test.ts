import { describe, expect, test } from 'bun:test';

import { MCP_SERVER_CAPABILITY, hasMcpServer, parseMcpToken } from '../mcp-tokens';

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

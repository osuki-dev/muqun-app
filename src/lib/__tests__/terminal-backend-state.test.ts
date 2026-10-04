import { describe, expect, test } from 'bun:test';

import type { TerminalDiscovery } from '../agent-protocol';
import { terminalBackendRows, terminalBackendState } from '../terminal-backend-state';

/** What a Mac gateway with tmux installed and no tmux server answers (iOS pass, finding 1). */
const deadTmuxSessions = [
  { id: 'default', label: 'b0', socket_path: '', backend: 'tmux', connected: false },
];
/** Discovery's `connected` there is about the tmux program, not the server. */
const tmuxPlane: TerminalDiscovery = {
  supported: true,
  mode: 'auto',
  activeBackend: 'tmux',
  backends: [
    { sessionId: 'default', label: 'b0', kind: 'tmux', connected: true, capabilities: [] },
  ],
};

describe('terminal backend state', () => {
  test('rows take liveness from /api/sessions over discovery', () => {
    expect(terminalBackendRows(deadTmuxSessions, tmuxPlane)).toEqual([
      { sessionId: 'default', label: 'b0', kind: 'tmux', connected: false },
    ]);
  });

  test('rows fall back to discovery, and an absent backend means herdr', () => {
    expect(terminalBackendRows([], tmuxPlane)[0]?.connected).toBe(true);
    expect(terminalBackendRows([{ id: 'h', label: 'Herdr', socket_path: '' }], null)).toEqual([
      { sessionId: 'h', label: 'Herdr', kind: 'herdr', connected: true },
    ]);
  });

  test('a loaded workspace with no panes and every backend down is down, not loading', () => {
    const state = terminalBackendState({
      loaded: true,
      paneCount: 0,
      backends: terminalBackendRows(deadTmuxSessions, tmuxPlane),
      plane: tmuxPlane,
      sessionId: 'default',
    });
    expect(state.kind).toBe('down');
    if (state.kind !== 'down') return;
    expect(state.message).toContain('tmux');
    expect(state.backends.map((backend) => backend.label)).toEqual(['b0']);
  });

  test('a load refused for a down backend is down before anything loads', () => {
    // `/health` says the primary backend is not connected, so the workspace's
    // first load fails and `loaded` never turns true: the loader used to spin
    // here forever under a banner that already said why.
    const state = terminalBackendState({
      loaded: false,
      paneCount: 0,
      backends: terminalBackendRows([], { ...tmuxPlane, backends: [] }),
      plane: null,
      unreachable: { backend: 'tmux' },
    });
    expect(state.kind).toBe('down');
    if (state.kind !== 'down') return;
    expect(state.backend).toBe('tmux');
    expect(state.message).toContain('tmux');
  });

  test('a refusal that names no backend falls back to discovery, then herdr', () => {
    const fromPlane = terminalBackendState({
      loaded: false,
      paneCount: 0,
      backends: [],
      plane: tmuxPlane,
      unreachable: {},
    });
    expect(fromPlane.kind === 'down' && fromPlane.backend).toBe('tmux');
    const bare = terminalBackendState({
      loaded: false,
      paneCount: 0,
      backends: [],
      unreachable: {},
    });
    expect(bare.kind === 'down' && bare.backend).toBe('herdr');
  });

  test('nothing loaded yet is pending, so the loader is still right', () => {
    expect(
      terminalBackendState({ loaded: false, paneCount: 0, backends: [], plane: tmuxPlane }).kind
    ).toBe('pending');
  });

  test('panes win over any probe', () => {
    expect(
      terminalBackendState({
        loaded: true,
        paneCount: 2,
        backends: terminalBackendRows(deadTmuxSessions, tmuxPlane),
      }).kind
    ).toBe('ready');
  });

  test('one reachable backend keeps the plane ready', () => {
    const backends = [
      { sessionId: 'a', label: 'A', kind: 'tmux', connected: false },
      { sessionId: 'b', label: 'B', kind: 'herdr', connected: true },
    ];
    expect(terminalBackendState({ loaded: true, paneCount: 0, backends }).kind).toBe('ready');
  });

  test("discovery's degraded reason or an unsupported plane is down too", () => {
    expect(
      terminalBackendState({
        loaded: true,
        paneCount: 0,
        backends: [],
        plane: { ...tmuxPlane, degradedReason: 'all_terminal_backends_disconnected' },
      }).kind
    ).toBe('down');
    const unsupported = terminalBackendState({
      loaded: true,
      paneCount: 0,
      backends: [],
      plane: { supported: false, mode: 'auto', backends: [] },
    });
    expect(unsupported.kind).toBe('down');
    if (unsupported.kind === 'down') expect(unsupported.message).toContain('Herdr');
  });

  test('a gateway too old for discovery and with no liveness stays ready', () => {
    expect(terminalBackendState({ loaded: true, paneCount: 0, backends: [] }).kind).toBe('ready');
  });
});

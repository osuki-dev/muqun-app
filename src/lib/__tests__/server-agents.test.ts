// What the home screen is allowed to remember about a server it is not
// connected to (card #621).
//
// The rendering cannot be tested here, so everything the mirror decides is kept
// out of the screen: what is worth writing, what an unpair has to remove, how
// old a snapshot has to be before the list stops calling it current, and that
// nothing read back out of storage is trusted on its word.
import { describe, expect, test } from 'bun:test';

import type { GatewayEntity } from '../gateway-entities';
import {
  isServerAgentsStale,
  keepMirroredServers,
  MAX_MIRRORED_SERVERS,
  MAX_SERVER_AGENTS,
  mirroredServerAgents,
  mirroredServerPanes,
  normalizeServerAgents,
  paneLocationCaption,
  parseServerAgentsIndex,
  sameServerAgents,
  serverAgentsAge,
  SERVER_AGENTS_STALE_AFTER_MS,
  visibleServerAgents,
  type ServerAgentsIndex,
  type ServerAgentsSnapshot,
} from '../server-agents';

const NOW = 1_700_000_000_000;

function snapshot(
  serverId: string,
  agents: { id: string; name: string; status?: string; hasAgent?: boolean }[],
  checkedAtMs = NOW
): ServerAgentsSnapshot {
  return {
    serverId,
    checkedAtMs,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: (agent.status ?? 'idle') as ServerAgentsSnapshot['agents'][number]['status'],
      hasAgent: agent.hasAgent ?? true,
    })),
  };
}

function entity(
  id: string,
  title: string,
  extra: Partial<GatewayEntity> & { raw?: Record<string, unknown> } = {}
): GatewayEntity {
  return { id, title, subtitle: '', raw: {}, ...extra };
}

describe('mirroredServerAgents', () => {
  // The bug this exists to stop: rename a panel on the server screen, go back
  // to the home screen, and the row still says what the agent was called when
  // it started. A rename sets the pane's label; the agents endpoint never
  // mentions it, so a mirror built from `agent.title` could not see it.
  test('a renamed pane names its agent on the home screen', () => {
    const agents = [entity('agent-1', 'Claude Code', { raw: { pane_id: 'pane-1' } })];
    const panes = [entity('pane-1', 'zsh', { label: 'Release notes' })];

    expect(mirroredServerAgents(agents, panes)).toEqual([
      { id: 'agent-1', name: 'Release notes', status: 'unknown', hasAgent: true, paneId: 'pane-1' },
    ]);
  });

  test('an unrenamed pane leaves the agent called what the agent is called', () => {
    const agents = [
      entity('agent-1', 'Claude Code', { status: 'working', raw: { pane_id: 'pane-1' } }),
    ];
    const panes = [entity('pane-1', 'Claude Code')];

    expect(mirroredServerAgents(agents, panes)).toEqual([
      { id: 'agent-1', name: 'Claude Code', status: 'working', hasAgent: true, paneId: 'pane-1' },
    ]);
  });

  test('names the row the way the pane strip names it when the two differ', () => {
    const agents = [entity('agent-1', 'Codex', { raw: { pane_id: 'pane-9' } })];
    const panes = [entity('pane-9', 'nvim')];

    expect(mirroredServerAgents(agents, panes)[0].name).toBe('Codex · nvim');
  });

  test('an agent whose pane is gone still gets a row, and still gets its link', () => {
    const agents = [entity('agent-1', 'Codex', { raw: { pane_id: 'pane-gone' } })];

    expect(mirroredServerAgents(agents, [])).toEqual([
      { id: 'agent-1', name: 'Codex', status: 'unknown', hasAgent: true, paneId: 'pane-gone' },
    ]);
  });

  test('no pane id means no pane id, rather than one that resolves to nothing', () => {
    const [agent] = mirroredServerAgents([entity('agent-1', 'Codex')], []);

    expect(agent.paneId).toBeUndefined();
    expect('paneId' in agent).toBe(false);
  });

  test('a status the gateway invented is narrowed before it is stored', () => {
    const agents = [entity('agent-1', 'Codex', { status: 'reticulating' })];

    expect(mirroredServerAgents(agents, [])[0].status).toBe('unknown');
  });
});

// The "every pane" mode: a tmux window/pane and a herdr tab/pane are the same
// concept, so this walks the pane list rather than the agent list, and a pane
// with no agent still gets a row.
describe('mirroredServerPanes', () => {
  test('a pane running an agent is titled and statused exactly like mirroredServerAgents', () => {
    const agents = [
      entity('agent-1', 'Claude Code', { status: 'working', raw: { pane_id: 'pane-1' } }),
    ];
    const panes = [entity('pane-1', 'zsh', { label: 'Release notes' })];

    expect(mirroredServerPanes(panes, agents)).toEqual([
      { id: 'agent-1', name: 'Release notes', status: 'working', hasAgent: true, paneId: 'pane-1' },
    ]);
  });

  test('a plain pane with no agent still gets a row, named for itself', () => {
    const panes = [entity('pane-2', 'zsh', { cwd: '/Users/ellen/muqun' })];

    expect(mirroredServerPanes(panes, [])).toEqual([
      {
        id: 'pane-2',
        name: 'zsh',
        status: 'unknown',
        hasAgent: false,
        paneId: 'pane-2',
        cwd: '/Users/ellen/muqun',
      },
    ]);
  });

  // The field the render-time filter (`visibleServerAgents`) reads: "agents"
  // mode has to be able to tell these two rows apart from the stored shape
  // alone, since the mirror no longer writes a different shape for that mode.
  test('hasAgent marks a pane-with-agent row true and a plain-pane row false', () => {
    const agents = [entity('agent-1', 'Claude Code', { raw: { pane_id: 'pane-1' } })];
    const panes = [entity('pane-1', 'Claude Code'), entity('pane-2', 'zsh')];

    const rows = mirroredServerPanes(panes, agents);
    expect(rows.find((row) => row.id === 'agent-1')?.hasAgent).toBe(true);
    expect(rows.find((row) => row.id === 'pane-2')?.hasAgent).toBe(false);
  });

  // The whole reason this exists: an agent's title is already distinctive, but
  // two shells both called "zsh" are not told apart by name -- their cwd is
  // the only thing that is.
  test('cwd is set for a plain pane and left off an agent row', () => {
    const agents = [entity('agent-1', 'Codex', { raw: { pane_id: 'pane-1' } })];
    const panes = [
      entity('pane-1', 'Codex', { cwd: '/repo' }),
      entity('pane-2', 'zsh', { cwd: '/tmp' }),
    ];

    const rows = mirroredServerPanes(panes, agents);
    expect(rows.find((row) => row.id === 'agent-1')?.cwd).toBeUndefined();
    expect(rows.find((row) => row.id === 'pane-2')?.cwd).toBe('/tmp');
  });

  test('a pane with no cwd reported is left off rather than stored empty', () => {
    const panes = [entity('pane-3', 'bash')];
    const [row] = mirroredServerPanes(panes, []);
    expect('cwd' in row).toBe(false);
  });

  test('every pane gets a row, not only the ones with an agent', () => {
    const agents = [entity('agent-1', 'Claude Code', { raw: { pane_id: 'pane-1' } })];
    const panes = [
      entity('pane-1', 'Claude Code'),
      entity('pane-2', 'nvim'),
      entity('pane-3', 'bash'),
    ];

    expect(mirroredServerPanes(panes, agents).map((row) => row.id)).toEqual([
      'agent-1',
      'pane-2',
      'pane-3',
    ]);
  });
});

describe('normalizeServerAgents', () => {
  test('caps the agent list to what a card can show', () => {
    const many = Array.from({ length: MAX_SERVER_AGENTS + 5 }, (_, index) => ({
      id: `a${index}`,
      name: `agent-${index}`,
    }));
    expect(normalizeServerAgents(snapshot('s1', many)).agents).toHaveLength(MAX_SERVER_AGENTS);
  });

  test('clips a long agent name rather than storing it whole', () => {
    const name = 'x'.repeat(200);
    const [agent] = normalizeServerAgents(snapshot('s1', [{ id: 'a', name }])).agents;
    expect(agent.name).not.toBe(name);
    expect(agent.name.length).toBeLessThanOrEqual(64);
  });

  test('keeps nothing beyond id, name and status', () => {
    const written = normalizeServerAgents({
      ...snapshot('s1', [{ id: 'a', name: 'claude' }]),
      // A caller handing over a whole gateway entity must not leak the rest of
      // it into storage.
      ...({ url: 'http://10.0.0.2:24847', token: 'secret' } as Record<string, unknown>),
    } as ServerAgentsSnapshot);
    expect(Object.keys(written).sort()).toEqual(['agents', 'checkedAtMs', 'serverId']);
    expect(Object.keys(written.agents[0]).sort()).toEqual(['hasAgent', 'id', 'name', 'status']);
  });
});

describe('sameServerAgents', () => {
  test('a first sighting is always a change', () => {
    expect(sameServerAgents(undefined, snapshot('s1', [{ id: 'a', name: 'claude' }]))).toBe(false);
  });

  test('the same agents at a later time are not a change worth writing', () => {
    const before = snapshot('s1', [{ id: 'a', name: 'claude', status: 'working' }], NOW);
    const after = snapshot('s1', [{ id: 'a', name: 'claude', status: 'working' }], NOW + 60_000);
    expect(sameServerAgents(before, after)).toBe(true);
  });

  test('a status change is a change', () => {
    const before = snapshot('s1', [{ id: 'a', name: 'claude', status: 'working' }]);
    const after = snapshot('s1', [{ id: 'a', name: 'claude', status: 'blocked' }]);
    expect(sameServerAgents(before, after)).toBe(false);
  });

  test('an agent appearing or leaving is a change', () => {
    const one = snapshot('s1', [{ id: 'a', name: 'claude' }]);
    const two = snapshot('s1', [
      { id: 'a', name: 'claude' },
      { id: 'b', name: 'codex' },
    ]);
    expect(sameServerAgents(one, two)).toBe(false);
    expect(sameServerAgents(two, one)).toBe(false);
  });

  test('a snapshot for a different server is never the same', () => {
    const first = snapshot('s1', [{ id: 'a', name: 'claude' }]);
    const second = snapshot('s2', [{ id: 'a', name: 'claude' }]);
    expect(sameServerAgents(first, second)).toBe(false);
  });
});

describe('freshness', () => {
  test('a snapshot inside the window is current', () => {
    expect(isServerAgentsStale(snapshot('s1', [], NOW), NOW + SERVER_AGENTS_STALE_AFTER_MS)).toBe(
      false
    );
  });

  test('a snapshot past the window is not presented as current', () => {
    expect(
      isServerAgentsStale(snapshot('s1', [], NOW), NOW + SERVER_AGENTS_STALE_AFTER_MS + 1)
    ).toBe(true);
  });

  test('ages read the way a card has room for', () => {
    expect(serverAgentsAge(snapshot('s1', [], NOW), NOW)).toBe('just now');
    expect(serverAgentsAge(snapshot('s1', [], NOW), NOW + 8 * 60_000)).toBe('8m ago');
    expect(serverAgentsAge(snapshot('s1', [], NOW), NOW + 3 * 3_600_000)).toBe('3h ago');
    expect(serverAgentsAge(snapshot('s1', [], NOW), NOW + 2 * 86_400_000)).toBe('2d ago');
  });

  test('a clock that went backwards does not report a negative age', () => {
    expect(serverAgentsAge(snapshot('s1', [], NOW), NOW - 60_000)).toBe('just now');
  });
});

// The setting (`serverCardPanes`, `app-settings.ts`) is answered here, out of
// a mirror that always holds every pane -- not by which mirror-writing
// function the server screen called. This is the render-time half of that:
// see `mirroredServerPanes`'s module doc for why the write side stopped
// branching on the setting.
describe('visibleServerAgents', () => {
  const withAgent = {
    id: 'agent-1',
    name: 'Claude Code',
    status: 'working',
    hasAgent: true,
  } as const;
  const plainPane = { id: 'pane-2', name: 'zsh', status: 'unknown', hasAgent: false } as const;

  test('"all" hands every row back untouched', () => {
    expect(visibleServerAgents([withAgent, plainPane], 'all')).toEqual([withAgent, plainPane]);
  });

  test('"agents" drops every row whose hasAgent is false', () => {
    expect(visibleServerAgents([withAgent, plainPane], 'agents')).toEqual([withAgent]);
  });

  test('"agents" against an all-plain-panes snapshot is an empty list, not the untouched one', () => {
    expect(visibleServerAgents([plainPane], 'agents')).toEqual([]);
  });
});

describe('keepMirroredServers', () => {
  test('drops a server that was unpaired', () => {
    const index: ServerAgentsIndex = {
      s1: snapshot('s1', [{ id: 'a', name: 'claude' }]),
      s2: snapshot('s2', [{ id: 'b', name: 'codex' }]),
    };
    expect(Object.keys(keepMirroredServers(index, ['s1']))).toEqual(['s1']);
  });

  test('keeps every server that is still paired', () => {
    const index: ServerAgentsIndex = {
      s1: snapshot('s1', []),
      s2: snapshot('s2', []),
    };
    expect(Object.keys(keepMirroredServers(index, ['s1', 's2', 's3'])).sort()).toEqual([
      's1',
      's2',
    ]);
  });

  test('caps the mirror at the most recently seen servers', () => {
    const index: ServerAgentsIndex = {};
    const ids: string[] = [];
    for (let position = 0; position < MAX_MIRRORED_SERVERS + 4; position += 1) {
      const id = `s${position}`;
      ids.push(id);
      index[id] = snapshot(id, [], NOW - position * 1000);
    }
    const kept = keepMirroredServers(index, ids);
    expect(Object.keys(kept)).toHaveLength(MAX_MIRRORED_SERVERS);
    // Newest first: s0 was seen most recently, the tail is what falls off.
    expect(Object.keys(kept)).toContain('s0');
    expect(Object.keys(kept)).not.toContain(`s${MAX_MIRRORED_SERVERS + 3}`);
  });
});

describe('parseServerAgentsIndex', () => {
  test('round-trips what was written', () => {
    const index: ServerAgentsIndex = {
      s1: snapshot('s1', [{ id: 'a', name: 'claude', status: 'working' }]),
    };
    expect(parseServerAgentsIndex(JSON.stringify(index))).toEqual(index);
  });

  test('narrows a status it does not recognise', () => {
    const stored = JSON.stringify({
      s1: { serverId: 's1', checkedAtMs: NOW, agents: [{ id: 'a', name: 'x', status: 'ON FIRE' }] },
    });
    expect(parseServerAgentsIndex(stored).s1.agents[0].status).toBe('unknown');
  });

  test('skips entries that are the wrong shape and keeps the rest', () => {
    const stored = JSON.stringify({
      broken: { serverId: 's0' },
      s1: {
        serverId: 's1',
        checkedAtMs: NOW,
        agents: [{ id: 'a', name: 'claude', status: 'idle' }, 'nonsense', { id: 7 }],
      },
    });
    const index = parseServerAgentsIndex(stored);
    expect(Object.keys(index)).toEqual(['s1']);
    expect(index.s1.agents).toHaveLength(1);
  });

  test('answers with an empty mirror for anything unreadable', () => {
    expect(parseServerAgentsIndex('not json')).toEqual({});
    expect(parseServerAgentsIndex('[]')).toEqual({});
    expect(parseServerAgentsIndex('null')).toEqual({});
    expect(parseServerAgentsIndex('42')).toEqual({});
  });
});

// The pane id is what turns an agent on the home screen from a label into a
// link, so it has to survive the same trip everything else does: written by the
// server screen, through the keychain, back out onto a card that has no session
// of its own to resolve a name against.
describe('the pane an agent is running in', () => {
  test('travels with the agent', () => {
    const written = normalizeServerAgents({
      serverId: 's1',
      checkedAtMs: NOW,
      agents: [{ id: 'a', name: 'claude', status: 'working', hasAgent: true, paneId: 'pane-7' }],
    });
    expect(written.agents[0].paneId).toBe('pane-7');
    expect(parseServerAgentsIndex(JSON.stringify({ s1: written })).s1.agents[0].paneId).toBe(
      'pane-7'
    );
  });

  test('is left off rather than stored empty when the gateway did not report one', () => {
    // `paneId: ''` would read as a pane that resolves to nothing, and the card
    // decides whether to deep-link by asking whether the field is there at all.
    const written = normalizeServerAgents({
      serverId: 's1',
      checkedAtMs: NOW,
      agents: [{ id: 'a', name: 'claude', status: 'idle', hasAgent: true, paneId: '' }],
    });
    expect(Object.keys(written.agents[0]).sort()).toEqual(['hasAgent', 'id', 'name', 'status']);
  });

  test('a snapshot written before this field existed still reads back', () => {
    const stored = JSON.stringify({
      s1: {
        serverId: 's1',
        checkedAtMs: NOW,
        agents: [{ id: 'a', name: 'claude', status: 'idle' }],
      },
    });
    expect(parseServerAgentsIndex(stored).s1.agents[0].paneId).toBeUndefined();
  });

  test('an agent moving to another pane is worth a write', () => {
    // Otherwise the row keeps pointing at the pane the agent has left, and the
    // tap opens the wrong panel.
    const before = normalizeServerAgents({
      serverId: 's1',
      checkedAtMs: NOW,
      agents: [{ id: 'a', name: 'claude', status: 'working', hasAgent: true, paneId: 'pane-1' }],
    });
    const after = normalizeServerAgents({
      serverId: 's1',
      checkedAtMs: NOW + 1000,
      agents: [{ id: 'a', name: 'claude', status: 'working', hasAgent: true, paneId: 'pane-2' }],
    });
    expect(sameServerAgents(before, after)).toBe(false);
  });
});

// A plain pane's cwd, the same kind of round trip as its pane id above: it is
// the one fact that tells two shells with the same name apart, so it has to
// survive storage and be worth a write when it changes.
describe("a plain pane's cwd", () => {
  test('travels with the pane', () => {
    const written = normalizeServerAgents({
      serverId: 's1',
      checkedAtMs: NOW,
      agents: [{ id: 'p', name: 'zsh', status: 'unknown', hasAgent: false, cwd: '/repo' }],
    });
    expect(written.agents[0].cwd).toBe('/repo');
    expect(parseServerAgentsIndex(JSON.stringify({ s1: written })).s1.agents[0].cwd).toBe('/repo');
  });

  test('is left off rather than stored empty when there is none', () => {
    const written = normalizeServerAgents({
      serverId: 's1',
      checkedAtMs: NOW,
      agents: [{ id: 'p', name: 'zsh', status: 'unknown', hasAgent: false, cwd: '' }],
    });
    expect(Object.keys(written.agents[0]).sort()).toEqual(['hasAgent', 'id', 'name', 'status']);
  });

  test('a snapshot written before this field existed still reads back', () => {
    const stored = JSON.stringify({
      s1: {
        serverId: 's1',
        checkedAtMs: NOW,
        agents: [{ id: 'p', name: 'zsh', status: 'unknown' }],
      },
    });
    expect(parseServerAgentsIndex(stored).s1.agents[0].cwd).toBeUndefined();
  });

  test('a shell changing directory is worth a write', () => {
    const before = normalizeServerAgents({
      serverId: 's1',
      checkedAtMs: NOW,
      agents: [{ id: 'p', name: 'zsh', status: 'unknown', hasAgent: false, cwd: '/repo' }],
    });
    const after = normalizeServerAgents({
      serverId: 's1',
      checkedAtMs: NOW + 1000,
      agents: [{ id: 'p', name: 'zsh', status: 'unknown', hasAgent: false, cwd: '/repo/src' }],
    });
    expect(sameServerAgents(before, after)).toBe(false);
  });
});

// The cwd earns a second line on the card only when it says something the
// name did not. A prompt-named pane very often already is its path, and drawing
// it twice is what made those rows half again as tall as the rows around them.
describe('the location shown under a pane name', () => {
  test('is the cwd when the name says nothing about where the pane is', () => {
    expect(paneLocationCaption('zsh', '/home/ryu/.osuki/draw')).toBe('/home/ryu/.osuki/draw');
    expect(paneLocationCaption('osk', '/home/ryu/.osuki/Muqun')).toBe('/home/ryu/.osuki/Muqun');
  });

  test('drops out when a shell prompt already spells the same path', () => {
    expect(paneLocationCaption('ryu@osk:~/.osuki/draw', '/home/ryu/.osuki/draw')).toBeUndefined();
    expect(
      paneLocationCaption('ryu@osk:~/.osuki/muqun-gateway', '/home/ryu/.osuki/muqun-gateway')
    ).toBeUndefined();
  });

  test('drops out when the name carries the absolute path verbatim', () => {
    expect(paneLocationCaption('nvim /srv/app', '/srv/app')).toBeUndefined();
  });

  test('keeps a cwd the prompt only partly agrees with', () => {
    expect(paneLocationCaption('ryu@osk:~/.osuki/draw', '/home/ryu/.osuki/draw/src')).toBe(
      '/home/ryu/.osuki/draw/src'
    );
  });

  test('reads a tilde at the root of the home directory', () => {
    expect(paneLocationCaption('ryu@osk:~', '/home/ryu')).toBe('/home/ryu');
  });

  test('says nothing for an agent pane, which never carries a cwd', () => {
    expect(paneLocationCaption('Claude Code', undefined)).toBeUndefined();
    expect(paneLocationCaption('Claude Code', '')).toBeUndefined();
  });

  test('ignores a trailing slash rather than treating it as a different place', () => {
    expect(paneLocationCaption('ryu@osk:~/.osuki/draw', '/home/ryu/.osuki/draw/')).toBeUndefined();
    expect(paneLocationCaption('zsh', '/srv/app/')).toBe('/srv/app');
    expect(paneLocationCaption('zsh', '/')).toBe('/');
  });
});

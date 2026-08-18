/**
 * The rules that decide whether the New Task entries exist at all, what the
 * pickers are allowed to offer, and what a spawn is allowed to navigate to.
 */
import { describe, expect, test } from 'bun:test';

import {
  AGENT_SPAWN_CAPABILITY,
  AGENT_SPAWN_SHIPPED,
  agentIsInterruptible,
  agentProfilesFromResponse,
  agentSpawnRequest,
  canSpawnAgent,
  gatewaySupportsAgentSpawn,
  normalizeCwd,
  recentCwdsFromResponse,
  spawnedAgentFromResponse,
} from '../agent-spawn';

describe('the capability gate', () => {
  test('a gateway that declares it can spawn is offered the entries', () => {
    // Only once the feature ships. New Task is held back from 1.2.0
    // (`AGENT_SPAWN_SHIPPED`), and the gate answers no to everything while it
    // is -- which is the whole point of one switch hiding every entry.
    expect(gatewaySupportsAgentSpawn(['pane_approvals', AGENT_SPAWN_CAPABILITY])).toBe(
      AGENT_SPAWN_SHIPPED
    );
  });

  test('a gateway that predates spawning is not', () => {
    expect(gatewaySupportsAgentSpawn(['pane_approvals', 'assets'])).toBe(false);
  });

  test('a gateway too old to have a capability list at all is not', () => {
    // The pre-capabilities gateways answer `/health` without the field. That
    // is the case the gate exists for, so it must not throw its way to a
    // rendered entry.
    expect(gatewaySupportsAgentSpawn(undefined)).toBe(false);
    expect(gatewaySupportsAgentSpawn(null)).toBe(false);
    expect(gatewaySupportsAgentSpawn('agent_spawn' as unknown as string[])).toBe(false);
  });
});

describe('the agent catalog', () => {
  test('reads the kinds a host will accept', () => {
    const profiles = agentProfilesFromResponse({
      agents: [
        { kind: 'claude', command: 'claude', available: true, source: 'builtin' },
        { kind: 'codex', command: 'codex-cli', available: false, source: 'config' },
      ],
      default_startup_timeout_ms: 30_000,
    });

    expect(profiles).toEqual([
      { kind: 'claude', command: 'claude', available: true },
      { kind: 'codex', command: 'codex-cli', available: false },
    ]);
  });

  test('a probe the gateway never ran is not a missing agent', () => {
    // `available` absent means the gateway did not look, which is different
    // from having looked and not found it. Only an explicit false dims a row.
    const [profile] = agentProfilesFromResponse({ agents: [{ kind: 'amp' }] });
    expect(profile).toEqual({ kind: 'amp', command: 'amp', available: true });
  });

  test('an entry with no kind is dropped rather than drawn blank', () => {
    // The kind is what the spawn sends back, so a row without one offers a
    // choice that cannot be made.
    expect(agentProfilesFromResponse({ agents: [{ command: 'mystery' }, 'claude'] })).toEqual([]);
  });

  test('the same kind twice is one row', () => {
    const profiles = agentProfilesFromResponse({
      agents: [{ kind: 'claude' }, { kind: 'claude', command: 'claude-2' }],
    });
    expect(profiles).toHaveLength(1);
    expect(profiles[0].command).toBe('claude');
  });

  test('anything that is not a catalog is an empty picker, not a crash', () => {
    expect(agentProfilesFromResponse(null)).toEqual([]);
    expect(agentProfilesFromResponse({ error: 'nope' })).toEqual([]);
    expect(agentProfilesFromResponse([{ kind: 'claude' }])).toHaveLength(1);
  });
});

describe('recent directories', () => {
  test('are read newest first and deduplicated', () => {
    expect(
      recentCwdsFromResponse({
        cwds: ['~/code/muqun', '  ~/code/muqun  ', '~/code/muqun-gateway', ''],
      })
    ).toEqual(['~/code/muqun', '~/code/muqun-gateway']);
  });

  test('objects carrying a cwd are read too', () => {
    expect(recentCwdsFromResponse({ cwds: [{ cwd: '~/code/muqun', used_at: 1 }] })).toEqual([
      '~/code/muqun',
    ]);
  });

  test('a gateway with no list leaves the manual field to do the job', () => {
    expect(recentCwdsFromResponse(null)).toEqual([]);
    expect(recentCwdsFromResponse({})).toEqual([]);
  });
});

describe('what a spawn answered with', () => {
  test('the pane id is taken from a nested pane', () => {
    expect(
      spawnedAgentFromResponse({
        pane: { pane_id: 'pane-9', tab_id: 'tab-2', workspace_id: 'ws-1' },
      })
    ).toEqual({ paneId: 'pane-9', tabId: 'tab-2', workspaceId: 'ws-1' });
  });

  test('and from a flat answer, or from one wrapped in a result', () => {
    expect(spawnedAgentFromResponse({ pane_id: 'pane-9' })).toEqual({
      paneId: 'pane-9',
      tabId: null,
      workspaceId: null,
    });
    expect(spawnedAgentFromResponse({ result: { root_pane: { pane_id: 'pane-9' } } })?.paneId).toBe(
      'pane-9'
    );
  });

  test('an answer that names no pane is null, never an empty id', () => {
    // An empty pane id does not navigate nowhere -- it clears the terminal. The
    // caller has to be able to tell "made it" from "said nothing".
    expect(spawnedAgentFromResponse({ ok: true })).toBeNull();
    expect(spawnedAgentFromResponse({ pane: { pane_id: '' } })).toBeNull();
    expect(spawnedAgentFromResponse(null)).toBeNull();
  });
});

describe('the request the sheet sends', () => {
  test('carries only the fields that were filled in', () => {
    expect(agentSpawnRequest({ agent: 'claude' })).toEqual({ agent: 'claude' });
    expect(agentSpawnRequest({ agent: 'claude', cwd: '  ', prompt: '   ' })).toEqual({
      agent: 'claude',
    });
  });

  test('trims what it does carry', () => {
    expect(
      agentSpawnRequest({
        agent: ' claude ',
        cwd: ' ~/code/muqun ',
        tabId: 'tab-1',
        prompt: '  ship the dark mode toggle  ',
      })
    ).toEqual({
      agent: 'claude',
      cwd: '~/code/muqun',
      tab_id: 'tab-1',
      prompt: 'ship the dark mode toggle',
    });
  });

  test('only the agent is required to press Go', () => {
    expect(canSpawnAgent({ agent: 'claude' })).toBe(true);
    expect(canSpawnAgent({ agent: '   ' })).toBe(false);
  });

  test('a path is trimmed and otherwise left alone', () => {
    // No expansion and no rejection: where a path may point is the gateway's
    // judgement against the workspaces it has open, and a phone that guessed
    // would refuse paths that work.
    expect(normalizeCwd('  ~/code/muqun  ')).toBe('~/code/muqun');
    expect(normalizeCwd('../elsewhere')).toBe('../elsewhere');
  });
});

describe('when Stop is offered', () => {
  test('only for an agent that is working', () => {
    expect(agentIsInterruptible('working')).toBe(true);
  });

  test('not for one that is waiting on an answer, or has none to give', () => {
    // Blocked belongs to the approval banner; idle and done have nothing to
    // interrupt.
    expect(agentIsInterruptible('blocked')).toBe(false);
    expect(agentIsInterruptible('idle')).toBe(false);
    expect(agentIsInterruptible('done')).toBe(false);
    expect(agentIsInterruptible(undefined)).toBe(false);
  });
});

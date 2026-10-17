import { describe, expect, test } from 'bun:test';

import {
  parseAgentDomainEvent,
  parseAgentSessionInfo,
  parseAgentSessionSnapshot,
} from '../agent-protocol';
import {
  agentSnapshotRefreshQuery,
  matchesRuntimeTerminal,
  nativeAgentInteraction,
  parseAgentSessionRuntime,
  replaceAgentTranscript,
  type AgentSessionRuntime,
} from '../agent-session-runtime';

const terminal = { session_id: 'host-session', pane_id: 'pane', instance_id: 'opaque-instance' };
const external: AgentSessionRuntime = {
  source: 'terminal',
  interaction: 'terminal',
  status: 'blocked',
  terminal,
};
const info = { asid: 'conversation', agent_id: 'codex', status: 'unknown', runtime: external };

describe('runtime provenance on the existing session protocol', () => {
  test('snapshot, inventory and metadata events preserve terminal blocked without inventing native requests', () => {
    const snapshot = parseAgentSessionSnapshot({ info, timeline: [], seq: 3 });
    expect(snapshot.info?.runtime).toEqual(external);
    expect(snapshot.info?.status).toBe('unknown');
    expect(snapshot.forms).toEqual([]);
    expect(snapshot.permissions).toEqual([]);
    expect(parseAgentSessionInfo(info)?.runtime).toEqual(external);
    const event = parseAgentDomainEvent('agent.session.updated', { info, seq: 4 });
    expect(event?.type === 'agent.session.updated' && event.info.runtime).toEqual(external);
  });
  test('native and legacy sessions retain native control', () => {
    expect(nativeAgentInteraction(undefined)).toBe(true);
    expect(
      nativeAgentInteraction(parseAgentSessionRuntime({ source: 'native', interaction: 'native' }))
    ).toBe(true);
    expect(parseAgentSessionInfo({ asid: 'legacy' })?.runtime).toBeUndefined();
  });
  test('an unobserved thread can explicitly resume only when the Gateway authorizes native interaction', () => {
    const runtime = parseAgentSessionRuntime({
      source: 'unobserved',
      interaction: 'native',
      reason: 'not_loaded',
    });
    expect(nativeAgentInteraction(runtime)).toBe(true);
    expect(runtime?.status).toBeUndefined();
    expect(replaceAgentTranscript('silent', runtime)).toBe(false);
  });
  test('external working, idle and blocked observations never authorize a native turn or reply', () => {
    for (const status of ['working', 'idle', 'blocked', 'completed', 'unknown'] as const) {
      expect(nativeAgentInteraction(parseAgentSessionRuntime({ ...external, status }))).toBe(false);
    }
    expect(
      nativeAgentInteraction(
        parseAgentSessionRuntime({
          source: 'unobserved',
          interaction: 'unavailable',
          reason: 'not_loaded',
        })
      )
    ).toBe(false);
  });
  test('missing and malformed process bindings fail closed', () => {
    for (const value of [
      null,
      {},
      'native',
      { ...external, terminal: undefined },
      { ...external, terminal: { ...terminal, instance_id: '' } },
      { ...external, interaction: 'native' },
    ]) {
      expect(nativeAgentInteraction(parseAgentSessionRuntime(value))).toBe(false);
      expect(parseAgentSessionRuntime(value)?.interaction).toBe('unavailable');
    }
  });
  test('unknown future statuses stay unreported rather than becoming idle or working', () => {
    expect(parseAgentSessionRuntime({ ...external, status: 'thinking' })?.status).toBeUndefined();
  });
});

describe('external history remains a reader-controlled snapshot', () => {
  test('automatic snapshots and stream catch-up preserve external history', () => {
    expect(replaceAgentTranscript('silent', external)).toBe(false);
    expect(
      replaceAgentTranscript('silent', { source: 'unobserved', interaction: 'unavailable' })
    ).toBe(false);
    expect(replaceAgentTranscript('enter', external)).toBe(true);
    expect(replaceAgentTranscript('refresh', external)).toBe(true);
  });
  test('native and legacy streaming behavior remains unchanged', () => {
    expect(replaceAgentTranscript('silent', undefined)).toBe(true);
    expect(replaceAgentTranscript('silent', { source: 'native', interaction: 'native' })).toBe(
      true
    );
  });
  test('only an explicit action and advertised support request a provider refresh', () => {
    expect(agentSnapshotRefreshQuery(true, ['agent_session_refresh_v1'])).toBe('?refresh=true');
    expect(agentSnapshotRefreshQuery(false, ['agent_session_refresh_v1'])).toBe('');
    expect(agentSnapshotRefreshQuery(true, [])).toBe('');
    expect(agentSnapshotRefreshQuery(true, undefined)).toBe('');
  });
});

describe('opening the linked terminal', () => {
  const agent = { pane_id: 'pane', instance_id: 'opaque-instance' };
  test('requires the exact process instance in the scoped session', () => {
    expect(matchesRuntimeTerminal(terminal, [agent])).toBe(true);
    expect(matchesRuntimeTerminal(terminal, [{ ...agent, session_id: 'other-session' }])).toBe(
      false
    );
    expect(matchesRuntimeTerminal(terminal, [{ ...agent, instance_id: 'replacement' }])).toBe(
      false
    );
    expect(matchesRuntimeTerminal(terminal, [{ ...agent, pane_id: 'other-pane' }])).toBe(false);
    expect(matchesRuntimeTerminal(terminal, [])).toBe(false);
  });
  test('ambiguous same-pane observations do not choose a target', () => {
    expect(matchesRuntimeTerminal(terminal, [agent, agent])).toBe(false);
    expect(
      matchesRuntimeTerminal(terminal, [agent, { ...agent, instance_id: 'replacement' }])
    ).toBe(false);
  });
});

test('transcript observation is independent of terminal interaction', () => {
  for (const transcript of ['live', 'persisted'] as const) {
    const runtime = parseAgentSessionRuntime({ ...external, transcript });
    expect(runtime?.transcript).toBe(transcript);
    expect(replaceAgentTranscript('silent', runtime)).toBe(true);
    expect(nativeAgentInteraction(runtime)).toBe(false);
  }
  expect(
    replaceAgentTranscript('silent', {
      source: 'native',
      interaction: 'native',
      transcript: 'snapshot',
    })
  ).toBe(false);
  expect(replaceAgentTranscript('refresh', { ...external, transcript: 'snapshot' })).toBe(true);
});

import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import {
  declaration,
  productionSource,
  transpile,
  walk,
} from '../../test-support/production-source';
import { canMutateAgentSession } from '../agent-runtime-controls';
import {
  defaultAgentFeatures,
  parseAgentSessionInfo,
  type AgentSessionInfo,
} from '../agent-protocol';
import { recoverWith, settleAfter } from '../compiler-safe-control-flow';
import { modelPickerChoice } from '../agent-session-defaults';

test('model selection keeps explicit effort and never guesses high or the first catalog variant', () => {
  const model = {
    id: 'shared-name',
    provider_id: 'provider',
    name: 'Model',
    enabled: true,
    variants: [{ id: 'low' }, { id: 'high' }],
  };
  expect(modelPickerChoice(model)).toEqual({ provider_id: 'provider', model_id: 'shared-name' });
  const current = { provider_id: 'provider', model_id: 'shared-name', variant: 'low' };
  expect(modelPickerChoice(model, current)).toEqual(current);
  expect(modelPickerChoice(model, undefined, current)).toEqual(current);
  expect(modelPickerChoice(model, { ...current, provider_id: 'other' }).variant).toBeUndefined();
  expect(
    modelPickerChoice(model, { ...current, variant: undefined }, current).variant
  ).toBeUndefined();
});

function callback(name: string, environment: Record<string, unknown>) {
  const source = productionSource('src/components/agent-workbench.tsx');
  let code = '';
  walk(source.program, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === name
    ) {
      code = source.code(node.init!);
    }
  });
  expect(code).not.toBe('');
  return runInNewContext(transpile(code), { useCallback: (fn: unknown) => fn, ...environment });
}

const native = { source: 'native', interaction: 'native', transcript: 'live' } as const;
const source = {
  asid: 'source',
  agent_id: 'arbitrary-provider',
  runtime: native,
} as AgentSessionInfo;
const forked = { ...source, asid: 'forked' };

test('session mutations follow advertised actions and runtime authority for any provider', () => {
  const features = defaultAgentFeatures();
  const capabilities = ['agent_session_fork_v1'];
  expect(canMutateAgentSession('rename', {}, features)).toBe(true);
  expect(canMutateAgentSession('delete', {}, features)).toBe(true);
  expect(canMutateAgentSession('fork', source, features, capabilities)).toBe(false);
  features.extra = { sessionFork: true, sessionRename: false, sessionDelete: false };
  expect(canMutateAgentSession('rename', source, features)).toBe(false);
  expect(canMutateAgentSession('delete', source, features)).toBe(false);
  expect(canMutateAgentSession('fork', source, features)).toBe(false);
  expect(canMutateAgentSession('fork', source, features, capabilities)).toBe(true);
  for (const action of ['rename', 'delete', 'fork'] as const) {
    features.extra = { sessionRename: true, sessionDelete: true, sessionFork: true };
    expect(
      canMutateAgentSession(
        action,
        { runtime: { source: 'terminal', interaction: 'terminal' } },
        features,
        capabilities
      )
    ).toBe(false);
    expect(
      canMutateAgentSession(
        action,
        { runtime: { source: 'unobserved', interaction: 'unavailable' } },
        features,
        capabilities
      )
    ).toBe(false);
  }
});

test('whole-session fork encodes exact provider identity and requires readable accepted info', async () => {
  const calls: unknown[][] = [];
  let response: unknown = forked;
  const fork = runInNewContext(
    transpile(`(${declaration('src/lib/agent-session.ts', 'forkAgentSession')})`),
    {
      parseAgentSessionInfo,
      sessionRoute: (asid: string, tail: string) =>
        `/api/agent-sessions/${encodeURIComponent(asid)}${tail}`,
      writeJson: async (...args: unknown[]) => {
        calls.push(args);
        return response;
      },
    }
  );
  expect(await fork('same/id', 'provider/name')).toMatchObject({ asid: 'forked' });
  expect(calls[0]).toEqual([
    '/api/agents/provider%2Fname/sessions/same%2Fid/fork',
    'Failed to fork session',
    {},
  ]);
  await fork('legacy/id');
  expect(calls[1]?.[0]).toBe('/api/agent-sessions/legacy%2Fid/fork');
  response = {};
  await expect(fork('source', 'provider')).rejects.toThrow('unreadable response');
});

test('fork navigates only after acceptance and does not replace the reader on failure or owner change', async () => {
  for (const outcome of ['accepted', 'rejected', 'switched', 'unsupported', 'in-flight'] as const) {
    let owned = true;
    let calls = 0;
    let rows = [source];
    const selected: string[] = [];
    const notices: unknown[] = [];
    const creation = { current: outcome === 'in-flight' };
    const handle = callback('handleForkSession', {
      newSessionCreationRef: creation,
      promptDispatchRef: { current: false },
      canMutateSession: () => outcome !== 'unsupported',
      captureWorkbenchOwner: () => ({}),
      ownsWorkbench: () => owned,
      activeAsidRef: { current: 'source' },
      activeDirectoryRef: { current: '/workspace' },
      setCreatingSession: () => {},
      settleAfter,
      forkAgentSession: async (asid: string, agentId: string) => {
        expect([asid, agentId]).toEqual(['source', 'arbitrary-provider']);
        calls++;
        if (outcome === 'rejected') throw new Error('timeout');
        if (outcome === 'switched') owned = false;
        return forked;
      },
      setSessions: (update: (previous: AgentSessionInfo[]) => AgentSessionInfo[]) => {
        rows = update(rows);
      },
      selectAsid: (asid: string) => selected.push(asid),
      showScreenNotice: (...notice: unknown[]) => notices.push(notice),
      agentErrorRef: { current: (error: Error) => error.message },
      t: (strings: TemplateStringsArray) => strings.join(''),
    });
    await handle(source);
    expect(calls).toBe(outcome === 'unsupported' || outcome === 'in-flight' ? 0 : 1);
    expect(selected).toEqual(outcome === 'accepted' ? ['forked'] : []);
    expect(rows).toEqual(outcome === 'accepted' ? [forked, source] : [source]);
    expect(notices.length).toBe(outcome === 'rejected' ? 1 : 0);
  }
});

test('unsupported background and inbox capabilities never issue badge requests', async () => {
  for (const enabled of [false, true]) {
    const reads: string[] = [];
    const environment = {
      agentFeatures: { backgroundShells: enabled, inbox: enabled },
      badgeLoads: true,
      activeDirectory: '/workspace',
      activeDirectoryRef: { current: '/workspace' },
      shellRequestRef: { current: 0 },
      activeAsid: 'source',
      setShells: () => {},
      setInbox: () => {},
      listAgentShells: async () => {
        reads.push('shells');
        return [];
      },
      listAgentInbox: async () => {
        reads.push('inbox');
        return [];
      },
    };
    await callback('refreshShells', environment)();
    await callback('refreshInbox', environment)();
    expect(reads).toEqual(enabled ? ['shells', 'inbox'] : []);
  }
});

test('Changes badge uses generic Git files even when legacy adapter diff is unsupported', async () => {
  for (const mode of ['generic', 'legacy', 'unsupported', 'switched'] as const) {
    const reads: string[] = [];
    let hasDiffs = false;
    const activeAsidRef = { current: 'source' };
    const refresh = callback('refreshDiffs', {
      recoverWith,
      activeAsid: 'source',
      activeAsidRef,
      sessionId: 'gateway',
      serverId: 'server',
      badgeLoads: true,
      agentFeatures: { extra: { legacyVcsDiff: mode === 'legacy' } },
      useServerCapabilities: {
        getState: () => ({ byServer: { server: mode === 'legacy' ? [] : ['agent_vcs_files'] } }),
      },
      getAgentVcsFiles: async () => {
        reads.push('files');
        if (mode === 'switched') activeAsidRef.current = 'another';
        return mode === 'unsupported' ? null : { files: [{ path: 'changed.ts' }] };
      },
      getAgentVcsDiff: async () => {
        reads.push('legacy');
        return { files: [{ path: 'changed.ts' }] };
      },
      noteWorkspaceMissing: () => {},
      setHasDiffs: (value: boolean) => {
        hasDiffs = value;
      },
    });
    await refresh();
    expect(reads).toEqual(mode === 'legacy' ? ['legacy'] : ['files']);
    expect(hasDiffs).toBe(mode === 'generic' || mode === 'legacy');
  }
});

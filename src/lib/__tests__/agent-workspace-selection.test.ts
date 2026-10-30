import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { productionSource, transpile, walk } from '../../test-support/production-source';
import type { AgentSessionInfo } from '../agent-protocol';
import { sameDirectory } from '../agent-protocol';
import { pickSessionToOpen } from '../agent-session-pick';
import {
  agentWorkbenchOwnerMatches,
  shouldPreserveNewSessionDraft,
  type AgentWorkbenchOwner,
} from '../agent-workbench-ownership';
import { recoverWith } from '../compiler-safe-control-flow';

const source = productionSource('src/components/agent-workbench.tsx');

/** Execute the real callbacks without mounting their native UI imports. */
function selectionCallbackSource() {
  let callback = '';
  walk(source.program, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === 'handleSelectWorkspace' &&
      node.init?.type === 'CallExpression'
    ) {
      const argument = node.init.arguments[0];
      if (argument?.type === 'ArrowFunctionExpression') callback = source.code(argument);
    }
  });
  if (!callback) throw new Error('Missing workspace selection callback');
  return callback;
}

function memoryCallbackSource() {
  let callback = '';
  walk(source.program, (node) => {
    if (
      node.type !== 'CallExpression' ||
      node.callee.type !== 'Identifier' ||
      node.callee.name !== 'useEffect'
    )
      return;
    const argument = node.arguments[0];
    if (argument?.type !== 'ArrowFunctionExpression') return;
    walk(argument, (child) => {
      if (
        child.type === 'CallExpression' &&
        child.callee.type === 'Identifier' &&
        child.callee.name === 'rememberOpenedAgentSession'
      )
        callback = source.code(argument);
    });
  });
  if (!callback) throw new Error('Missing settled-session memory effect');
  return callback;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

function session(asid: string, directory: string, agent_id = 'fx', updated_ms = 1) {
  return { asid, directory, agent_id, updated_ms } as AgentSessionInfo;
}

function harness() {
  const memory = new Map<string, string>([
    ['/a', 'source'],
    ['/b', 'remembered-b'],
    ['/c', 'remembered-c'],
  ]);
  const lists: { directory: string; reply: ReturnType<typeof deferred<AgentSessionInfo[]>> }[] = [];
  const creates: { directory: string; reply: ReturnType<typeof deferred<AgentSessionInfo>> }[] = [];
  const creationStarted = deferred<void>();
  const activeAsidRef = { current: 'source' };
  const activeDirectoryRef = { current: '/a' };
  let refreshes = 0;
  const context = {
    serverId: 'computer',
    sessionId: 'route',
    activeAsid: 'source',
    activeDirectory: '/a',
    sessionInfo: session('source', '/a'),
    sessions: [session('source', '/a')],
    activeAsidRef,
    activeDirectoryRef,
    workspaceSelectionRef: { current: 0 },
    freshSessionRef: { current: undefined as string | undefined },
    ownerGenerationRef: { current: 1 },
    initialIntent: undefined,
    syncRef: { current: {} },
    CATCH_UP_START: {},
    sameDirectory,
    shouldPreserveNewSessionDraft,
    pickSessionToOpen,
    recoverWith,
    isHomeRelativePath: (path: string) => path.startsWith('~/'),
    settledWorkspaceDirectory: (requested: string, returned?: string) => returned ?? requested,
    loadRememberedAgentSession: (_route: string, directory: string) => memory.get(directory),
    rememberOpenedAgentSession: (_route: string, directory: string, asid: string) =>
      memory.set(directory, asid),
    ownsWorkbench: (owner: AgentWorkbenchOwner) =>
      agentWorkbenchOwnerMatches(owner, {
        serverId: 'computer',
        sessionId: 'route',
        generation: 1,
        asid: activeAsidRef.current,
        directory: activeDirectoryRef.current,
      }),
    setActiveDirectory: (directory: string) => {
      context.activeDirectory = directory;
    },
    setActiveAsid: (asid: string) => {
      context.activeAsid = asid;
    },
    setSessionInfo: (info: AgentSessionInfo) => {
      context.sessionInfo = info;
    },
    setSessions: (
      update: AgentSessionInfo[] | ((previous: AgentSessionInfo[]) => AgentSessionInfo[])
    ) => {
      context.sessions = typeof update === 'function' ? update(context.sessions) : update;
    },
    newSessionParams: (directory: string) => ({ directory }),
    listAgentSessions: (_route: string, query: { directory: string }) => {
      const reply = deferred<AgentSessionInfo[]>();
      lists.push({ directory: query.directory, reply });
      return reply.promise;
    },
    createAgentSession: (_route: string, params: { directory: string }) => {
      const reply = deferred<AgentSessionInfo>();
      creates.push({ directory: params.directory, reply });
      creationStarted.resolve();
      return reply.promise;
    },
    setTimeline: () => {},
    setWindowStart: () => {},
    setPermissions: () => {},
    setForms: () => {},
    refreshSessions: () => {
      refreshes++;
    },
  };
  const select = runInNewContext(transpile(`(${selectionCallbackSource()})`), context) as (
    directory: string
  ) => Promise<void>;
  const remember = runInNewContext(transpile(`(${memoryCallbackSource()})`), context) as () => void;
  return {
    context,
    memory,
    lists,
    creates,
    creationStarted: creationStarted.promise,
    select,
    remember,
    refreshes: () => refreshes,
  };
}

test('a pending workspace selection cannot store the source session under its destination', async () => {
  const h = harness();
  const switching = h.select('/b');
  h.remember();
  expect(h.memory.get('/b')).toBe('remembered-b');
  // A later memory write cannot change the intent this selection captured.
  h.memory.set('/b', 'later-pick');
  h.lists[0].reply.resolve([
    session('newest-b', '/b', 'pi', 10),
    session('remembered-b', '/b', 'qoder', 2),
  ]);
  await switching;
  h.remember();
  expect(h.context.activeAsidRef.current).toBe('remembered-b');
  expect(h.context.sessionInfo.agent_id).toBe('qoder');
  expect(h.memory.get('/b')).toBe('remembered-b');
  expect(h.memory.get('/a')).toBe('source');
  expect(h.refreshes()).toBe(0);
});

test('out-of-order workspace lists cannot create or select an abandoned destination', async () => {
  const h = harness();
  const older = h.select('/b');
  h.remember();
  const current = h.select('/c');
  h.remember();
  h.lists[0].reply.resolve([]);
  await older;
  expect(h.creates).toHaveLength(0);
  expect(h.memory.get('/b')).toBe('remembered-b');
  expect(h.memory.get('/c')).toBe('remembered-c');
  h.lists[1].reply.resolve([session('remembered-c', '/c', 'pi')]);
  await current;
  h.remember();
  expect(h.context.activeAsidRef.current).toBe('remembered-c');
  expect(h.context.sessions.some((item) => item.asid === 'created-b')).toBe(false);
  expect(h.context.freshSessionRef.current).toBeUndefined();
  expect(h.memory.get('/c')).toBe('remembered-c');
});

test('an accepted creation from an older selection cannot replace the newer workspace', async () => {
  const h = harness();
  const older = h.select('/b');
  h.lists[0].reply.resolve([]);
  await h.creationStarted;
  expect(h.creates).toHaveLength(1);
  const current = h.select('/c');
  h.lists[1].reply.resolve([session('remembered-c', '/c', 'pi')]);
  await current;
  h.creates[0].reply.resolve(session('created-b', '/b'));
  await older;
  h.remember();
  expect(h.context.activeAsidRef.current).toBe('remembered-c');
  expect(h.context.sessions.some((item) => item.asid === 'created-b')).toBe(false);
  expect(h.context.freshSessionRef.current).toBeUndefined();
  expect(h.memory.get('/b')).toBe('remembered-b');
  expect(h.memory.get('/c')).toBe('remembered-c');
});

test('a missing remembered session still selects newest activity across agents', async () => {
  const h = harness();
  const switching = h.select('/b');
  h.lists[0].reply.resolve([
    session('older-fx', '/b', 'fx', 2),
    session('newest-pi', '/b', 'pi', 10),
  ]);
  await switching;
  h.remember();
  expect(h.context.activeAsidRef.current).toBe('newest-pi');
  expect(h.memory.get('/b')).toBe('newest-pi');
  expect(h.creates).toHaveLength(0);
});

test('a workspace list that settles empty before creation cannot hide the accepted new session', async () => {
  const h = harness();
  const switching = h.select('/b');
  // The directory effect's scoped list finishes before the handler's create.
  h.context.setSessions([]);
  h.lists[0].reply.resolve([]);
  await h.creationStarted;
  const created = session('created-b', '/b');
  h.creates[0].reply.resolve(created);
  await switching;
  h.remember();
  expect(h.context.activeAsidRef.current).toBe('created-b');
  expect(h.context.sessions).toEqual([created]);
  expect(h.context.freshSessionRef.current).toBe('created-b');
  expect(h.memory.get('/b')).toBe('created-b');
  expect(h.refreshes()).toBe(0);
});

test.each([false, true])(
  'current empty workspace creation merges once (event already received: %s)',
  async (received) => {
    const h = harness();
    h.context.setSessions([]);
    const switching = h.select('/a');
    h.lists[0].reply.resolve([]);
    await h.creationStarted;
    const created = session('created-a', '/a');
    // A native event can already have inserted the same row before its receipt.
    if (received) h.context.setSessions([created]);
    h.creates[0].reply.resolve(created);
    await switching;
    h.remember();
    expect(h.context.activeDirectoryRef.current).toBe('/a');
    expect(h.context.activeAsidRef.current).toBe('created-a');
    expect(h.context.sessions).toEqual([created]);
    expect(h.context.freshSessionRef.current).toBe('created-a');
    expect(h.memory.get('/a')).toBe('created-a');
    expect(h.refreshes()).toBe(0);
  }
);

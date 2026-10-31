import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { productionSource, transpile, walk } from '../../test-support/production-source';
import { classifyAgentSessionGone } from '../agent-request-error';
import { recoverWith, rethrow, settleAfter } from '../compiler-safe-control-flow';
import { isPreparingSessionHistory, SessionReadFeedback } from '../session-read-feedback';

const parked = new Error(
  'Failed to get snapshot: 502 {"error":{"code":"agent_error","message":"Agent not available: Explicitly open this conversation to load its native history"}}'
);
const changed = new Error(
  'Failed to get snapshot: 502 {"error":{"code":"agent_error","message":"ACP session changed while loading; refresh again"}}'
);
const source = productionSource('src/components/agent-workbench.tsx');

test('switching the foreground session dismisses its old failure before showing the next one', () => {
  let next = 0;
  const active = new Map<string, string>();
  const feedback = new SessionReadFeedback(
    (notice) => {
      const id = String(++next);
      active.set(id, notice.message);
      return id;
    },
    (id) => active.delete(id)
  );
  const notice = { variant: 'danger' as const, title: 'Read failed', message: 'refused' };
  const leaveA = feedback.activate('source/a/history');
  feedback.failed('source/a/history', notice);
  // The new screen can mount before the old retained screen cleans up.
  const leaveB = feedback.activate('source/b/history');
  feedback.failed('source/b/history', notice);
  leaveA();
  expect([...active.values()]).toEqual(['refused']);
  expect([...active.keys()]).toEqual(['2']);
  leaveB();
  expect(active.size).toBe(0);
});

test('late cleanup of the same session cannot dismiss its new foreground owner', () => {
  const dismissed: string[] = [];
  const feedback = new SessionReadFeedback(
    () => 'notice',
    (id) => dismissed.push(id)
  );
  const leaveOld = feedback.activate('source/a/history');
  const leaveNew = feedback.activate('source/a/history');
  feedback.failed('source/a/history', {
    variant: 'danger',
    title: 'Read failed',
    message: 'refused',
  });
  leaveOld();
  expect(dismissed).toEqual([]);
  leaveNew();
  leaveNew();
  expect(dismissed).toEqual(['notice']);
});

function callback(name: string): string {
  let found = '';
  walk(source.program, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === name &&
      node.init?.type === 'CallExpression'
    ) {
      const argument = node.init.arguments[0];
      if (argument?.type === 'ArrowFunctionExpression') found = source.code(argument);
    }
  });
  if (!found) throw new Error(`Missing production callback ${name}`);
  return found;
}

/** Execute the actual entry and rejected snapshot path, without mounting native UI. */
function reader() {
  let reads = 0;
  let now = 0;
  let failure = parked;
  let snapshotFailure: { source: string | null; asid: string; error: unknown } | null = null;
  const shown: { title: string; message: string }[] = [];
  const dismissed: string[] = [];
  const promises: Promise<void>[] = [];
  const context = {
    activeAsid: 'session-a',
    serverId: 'computer-a',
    sessionId: 'terminal-a',
    entrySource: 'pairing-a/restart-0',
    globalOwnerRef: { current: { id: 1 } },
    entryIntentRef: { current: null },
    openedAsidRef: { current: undefined as string | undefined },
    initialCheckDoneRef: { current: true },
    mountedRef: { current: true },
    ownerGenerationRef: { current: 1 },
    activeAsidRef: { current: 'session-a' },
    freshSessionRef: { current: undefined },
    historyCursorRef: { current: undefined },
    snapshotReadRef: { current: 0 },
    preparationBindings: null,
    visible: true,
    preparing: false,
    owner: true,
    readPreparationSource: () => context.entrySource,
    isGlobalOwner: () => context.owner,
    useGatewayConnectionStore: { getState: () => ({ record: { serverId: 'computer-a' } }) },
    useGatewayGeneration: { getState: () => ({ restarts: {} }) },
    useHomeAttention: { getState: () => ({ reserve: () => 1 }) },
    useServerCapabilities: { getState: () => ({ byServer: {} }) },
    getAgentSessionSnapshot: async (): Promise<unknown> => {
      reads++;
      throw failure;
    },
    recoverWith,
    settleAfter,
    rethrow,
    classifyAgentSessionGone,
    foregroundSessionAgent: () => 'native-agent',
    isAgentSessionPreparingAt: () => context.preparing,
    isPreparingSessionHistory,
    setLoading: (_value: boolean) => {},
    setSnapshotFailure: (value: typeof snapshotFailure) => {
      snapshotFailure = value;
    },
    setEarlierExhausted: () => {},
    transcriptStore: { getState: () => ({ timeline: [] }) },
    reconcileAgentSnapshotPending: () => [],
    setInbox: () => {},
    setCompaction: () => {},
    setStagedRevert: () => {},
    replaceAgentTranscript: () => false,
    readRuntime: () => undefined,
    permissionReplies: { replace: () => [] },
    readAutoPermission: () => ({ owner: null, enabled: false }),
    setPermissions: () => {},
    setForms: () => {},
    syncRef: { current: {} },
    snapshotSettled: () => ({ state: {}, from: null }),
    askCatchUp: () => ({ state: {}, from: null }),
    requestIdleCallback: () => {},
    readFeedback: new SessionReadFeedback(
      (notice) => {
        shown.push(notice);
        return `toast-${shown.length}`;
      },
      (id) => dismissed.push(id),
      () => now
    ),
    agentErrorRef: { current: (error: Error) => error.message },
    t: (strings: TemplateStringsArray) => strings.join(''),
    console: { warn: () => {} },
    loadSnapshot: (_mode: string, _current?: () => boolean): Promise<void> => Promise.resolve(),
  };
  const load = runInNewContext(transpile(callback('loadSnapshot')), context) as (
    mode: string,
    current?: () => boolean
  ) => Promise<void>;
  context.loadSnapshot = (mode, current) => {
    const promise = load(mode, current);
    promises.push(promise);
    return promise;
  };
  const enter = runInNewContext(transpile(callback('enterSnapshot')), context) as () => void;
  return {
    context,
    shown,
    dismissed,
    enter,
    load,
    catchUp: () => runInNewContext(transpile(callback('catchUp')), context)(),
    reads: () => reads,
    snapshotFailure: () => snapshotFailure,
    settle: () => Promise.allSettled(promises),
    failWith: (error: Error) => (failure = error),
    expire: () => (now = 10_000),
  };
}

test('a rejected entry cannot replay on loader identity updates, but new open/source/session intents read', async () => {
  const f = reader();
  for (let index = 0; index < 3; index++) {
    f.enter();
    await f.settle();
  }
  expect(f.reads()).toBe(1);
  expect(f.shown).toHaveLength(1);
  // An explicit refresh is a new attempt even while its previous toast is visible.
  await f.load('refresh');
  expect(f.reads()).toBe(2);
  expect(f.shown).toHaveLength(2);
  expect(f.dismissed).toEqual(['toast-1']);
  f.context.globalOwnerRef.current.id++;
  f.enter();
  await f.settle();
  expect(f.reads()).toBe(3);
  f.context.entrySource = 'pairing-b/restart-0';
  f.enter();
  await f.settle();
  expect(f.reads()).toBe(4);
  expect(f.shown).toHaveLength(3);
  f.context.entrySource = 'pairing-b/restart-1';
  f.enter();
  await f.settle();
  expect(f.reads()).toBe(5);
  f.context.activeAsid = 'session-b';
  f.context.activeAsidRef.current = 'session-b';
  f.enter();
  await f.settle();
  expect(f.reads()).toBe(6);
  f.context.owner = false;
  f.context.globalOwnerRef.current.id++;
  f.enter();
  await f.settle();
  expect(f.reads()).toBe(6);
});

test('only parked-history refusal during actual preparation is transient; failed prepared refresh stays retryable', async () => {
  const f = reader();
  f.context.preparing = true;
  f.enter();
  await f.settle();
  expect(f.shown).toHaveLength(0);
  expect(f.context.openedAsidRef.current).toBe('session-a');
  expect(f.snapshotFailure()).toBeNull();
  f.catchUp();
  await f.settle();
  expect(f.reads()).toBe(1);
  // A CAS failure during prepare is a different, real failure.
  f.failWith(changed);
  await f.load('silent');
  expect(f.shown).toHaveLength(1);
  f.context.preparing = false;
  // A real restore/CAS refusal remains readable in the existing retry notice.
  await expect(f.load('silent', () => true)).rejects.toThrow(changed.message);
  expect(f.shown).toHaveLength(1);
  f.failWith(parked);
  // After an acknowledged prepare, propagate to the activation notice/Retry.
  await expect(f.load('silent', () => true)).rejects.toThrow(parked.message);
  expect(f.shown).toHaveLength(1);
  await f.load('silent');
  expect(f.shown).toHaveLength(2);
});

test('concurrent resync failures share one notice, later retries and different scopes remain visible', async () => {
  const f = reader();
  await Promise.all([f.load('silent'), f.load('silent'), f.load('silent')]);
  expect(f.shown).toHaveLength(1);
  f.expire();
  await f.load('silent');
  expect(f.shown).toHaveLength(2);
  f.context.entrySource = 'another-pairing';
  await f.load('silent');
  expect(f.shown).toHaveLength(3);
  f.context.owner = false;
  f.failWith(changed);
  await f.load('silent');
  expect(f.shown).toHaveLength(3);
});

test('distinct operations and changed errors are not swallowed; successful reads clear their own notice', () => {
  let next = 0;
  const shown: string[] = [];
  const dismissed: string[] = [];
  const feedback = new SessionReadFeedback(
    (notice) => {
      shown.push(notice.message);
      return String(++next);
    },
    (id) => dismissed.push(id)
  );
  const notice = { variant: 'danger' as const, title: 'Read failed', message: 'refused' };
  feedback.failed('source/session/history', notice);
  feedback.failed('source/session/history', notice);
  feedback.failed('source/session/catalog', notice);
  feedback.failed('source/session/history', { ...notice, message: 'changed' });
  expect(shown).toEqual(['refused', 'refused', 'changed']);
  expect(dismissed).toEqual(['1']);
  feedback.clear('source/session/history');
  feedback.failed('source/session/history', notice);
  expect(shown).toHaveLength(4);
  expect(dismissed).toEqual(['1', '3']);
});

test('late failures from another pairing or an earlier foreground open cannot notify the new owner', async () => {
  for (const change of ['pairing', 'owner']) {
    const f = reader();
    const reply = Promise.withResolvers<never>();
    f.context.getAgentSessionSnapshot = () => reply.promise;
    const pending = f.load('silent');
    if (change === 'pairing') f.context.entrySource = 'replacement-pairing';
    else f.context.globalOwnerRef.current = { id: 2 };
    reply.reject(parked);
    await pending;
    expect(f.shown).toHaveLength(0);
  }
});

test('late initial NotLoaded cannot overwrite a successful prepared read or release its entry guard', async () => {
  const f = reader();
  const initial = Promise.withResolvers<unknown>();
  let request = 0;
  const loading: boolean[] = [];
  f.context.setLoading = (value) => loading.push(value);
  f.context.getAgentSessionSnapshot = () => {
    if (++request === 1) return initial.promise;
    return Promise.resolve({
      history_cursor: null,
      info: null,
      timeline: [],
      permissions: [],
      forms: [],
      inbox: [],
      seq: 1,
    });
  };
  f.context.preparing = true;
  f.enter();
  // The foreground prepare acknowledges, then reads the newly available history.
  f.context.preparing = false;
  await f.load('silent', () => true);
  expect(loading).toEqual([true, false]);
  initial.reject(parked);
  await f.settle();
  expect(f.shown).toHaveLength(0);
  expect(f.context.openedAsidRef.current).toBe('session-a');
  expect(loading).toEqual([true, false]);
});

test('an older cached success cannot dismiss a newer real failure notice', async () => {
  const f = reader();
  const older = Promise.withResolvers<unknown>();
  let request = 0;
  f.context.getAgentSessionSnapshot = () => {
    if (++request === 1) return older.promise;
    return Promise.reject(changed);
  };
  const stale = f.load('silent');
  await f.load('silent');
  expect(f.shown).toHaveLength(1);
  expect(f.snapshotFailure()?.error).toBe(changed);
  older.resolve({
    history_cursor: null,
    info: null,
    timeline: [],
    permissions: [],
    forms: [],
    inbox: [],
    seq: 1,
  });
  await stale;
  expect(f.dismissed).toEqual([]);
  expect(f.shown).toHaveLength(1);
  expect(f.snapshotFailure()?.error).toBe(changed);
});

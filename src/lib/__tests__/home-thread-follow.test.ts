import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';

import { declaration, transpile } from '../../test-support/production-source';
import { agentRequestErrorDetail } from '../agent-request-error';
import type { AgentDomainEvent, AgentSessionSnapshot } from '../agent-protocol';
import type { GatewayRecord } from '../gateway-storage';
import type { GatewaySocketListener } from '../gateway-socket';
import type { followHomeSession } from '../../components/home-thread';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function snapshot(seq = 1): AgentSessionSnapshot {
  return { info: null, timeline: [], permissions: [], forms: [], inbox: [], seq };
}

function fixture() {
  const record: GatewayRecord = {
    serverId: 'computer-a',
    label: 'Computer A',
    url: 'https://a.invalid',
    token: 'token-a',
    deviceId: 'phone-a',
    transportKey: 'key-a',
    pairedAt: 1,
  };
  const connection = { record };
  const reads: {
    sessionId: string;
    asid: string;
    resolve: (value: AgentSessionSnapshot) => void;
    reject: (failure: Error) => void;
  }[] = [];
  const snapshots: AgentSessionSnapshot[] = [];
  const events: AgentDomainEvent[] = [];
  let watcher: GatewaySocketListener = {};
  let errors = 0;
  let missing = 0;
  let streams = 0;
  const follow = runInNewContext(
    transpile(
      declaration('src/components/home-thread.tsx', 'followHomeSession') +
        '\n' +
        declaration('src/lib/home-composer.ts', 'sameComputer') +
        '\n followHomeSession'
    ),
    {
      Date,
      setTimeout,
      clearTimeout,
      queueMicrotask,
      agentRequestErrorDetail,
      HOME_THREAD_SUBSCRIBE_READ_FRESH_MS: 5000,
      HOME_THREAD_STREAM_RETRY_MS: 5000,
      WS_EVENTS_CAPABILITY: 'ws_events',
      useGatewayConnectionStore: { getState: () => connection },
      useServerCapabilities: { getState: () => ({ byServer: { 'computer-a': ['ws_events'] } }) },
      getAgentSessionSnapshot: (sessionId: string, asid: string) => {
        const pending = Promise.withResolvers<AgentSessionSnapshot>();
        reads.push({ sessionId, asid, resolve: pending.resolve, reject: pending.reject });
        return pending.promise;
      },
      gatewaySocketFor: () => ({
        watch: (_asid: string, listener: GatewaySocketListener) => {
          watcher = listener;
          return () => {};
        },
      }),
      openAgentSessionStream: () => {
        streams++;
        return () => {};
      },
    }
  ) as typeof followHomeSession;
  const stop = follow({
    serverId: 'computer-a',
    sessionId: 'terminal-a',
    asid: 'agent-session-a',
    onSnapshot: (value) => snapshots.push(value),
    onEvent: (event) => events.push(event),
    onNotFound: () => missing++,
    onError: () => errors++,
  });
  return {
    connection,
    reads,
    snapshots,
    events,
    stop,
    watcher,
    errors: () => errors,
    missing: () => missing,
    streams: () => streams,
    switchComputer: () => {
      connection.record = { ...record, serverId: 'computer-b', url: 'https://b.invalid' };
    },
  };
}

test('a rejected snapshot reports a read failure and resync can recover the session', async () => {
  const f = fixture();
  try {
    expect(f.reads).toHaveLength(1);
    expect(f.reads[0]).toMatchObject({ sessionId: 'terminal-a', asid: 'agent-session-a' });
    f.reads[0].reject(new Error('Network request failed'));
    await tick();
    expect(f.errors()).toBe(1);
    expect(f.missing()).toBe(0);
    expect(f.snapshots).toEqual([]);
    f.watcher.onResync?.();
    expect(f.reads).toHaveLength(2);
    const recovered = snapshot(2);
    f.reads[1].resolve(recovered);
    await tick();
    expect(f.snapshots).toEqual([recovered]);
    expect(f.errors()).toBe(1);
    expect(f.missing()).toBe(0);
  } finally {
    f.stop();
  }
});

test('an asynchronous 404 marks the session missing instead of reporting a connection failure', async () => {
  const f = fixture();
  try {
    f.reads[0].reject(new Error('Snapshot: 404 {"error":{"code":"session_not_found"}}'));
    await tick();
    expect(f.missing()).toBe(1);
    expect(f.errors()).toBe(0);
    expect(f.snapshots).toEqual([]);
    expect(f.reads).toHaveLength(1);
  } finally {
    f.stop();
  }
});

test('switching computers discards pending answers and prevents queued or later session reads', async () => {
  for (const result of ['snapshot', 'missing', 'failure']) {
    const f = fixture();
    try {
      f.watcher.onResync?.();
      expect(f.reads).toHaveLength(1);
      f.switchComputer();
      f.watcher.onResync?.();
      f.watcher.onEvent?.({ type: 'agent.resync', asid: 'agent-session-a', seq: 1 });
      f.watcher.onEvent?.({
        type: 'agent.status.changed',
        asid: 'agent-session-a',
        seq: 2,
        status: 'idle',
      });
      if (result === 'snapshot') f.reads[0].resolve(snapshot());
      else f.reads[0].reject(new Error(result === 'missing' ? 'Snapshot: 404 missing' : 'offline'));
      await tick();
      f.watcher.onResync?.();
      expect(f.reads).toHaveLength(1);
      expect(f.snapshots).toEqual([]);
      expect(f.events).toEqual([]);
      expect(f.errors()).toBe(0);
      expect(f.missing()).toBe(0);
    } finally {
      f.stop();
    }
  }
});

test('switching computers before socket fallback prevents opening the previous session stream', async () => {
  const f = fixture();
  try {
    f.watcher.onUnavailable?.();
    f.switchComputer();
    f.reads[0].resolve(snapshot());
    await tick();
    expect(f.streams()).toBe(0);
    expect(f.reads).toHaveLength(1);
    expect(f.snapshots).toEqual([]);
  } finally {
    f.stop();
  }
});

test('foreground activation refresh queues behind history and stops with its reader', async () => {
  const f = fixture();
  f.stop.refresh();
  f.stop.refresh();
  expect(f.reads).toHaveLength(1);
  f.reads[0].resolve(snapshot(1));
  await tick();
  expect(f.reads).toHaveLength(2);
  f.reads[1].resolve(snapshot(2));
  await tick();
  expect(f.snapshots.map((value) => value.seq)).toEqual([1, 2]);
  f.stop();
  f.stop.refresh();
  expect(f.reads).toHaveLength(2);
});

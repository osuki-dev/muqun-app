import { expect, test } from 'bun:test';
import * as crypto from 'node:crypto';
import { runInNewContext } from 'node:vm';

import { declaration, transpile } from '../../test-support/production-source';
import type { createHomeLedgerTask } from '../home-ledger-delivery';
import {
  deliverLedgerTask,
  isLedgerTaskRejection,
  ledgerTaskBody,
  parseCreatedLedgerTask,
  type CreatedLedgerTask,
  type LedgerTaskRequest,
  type TaskView,
} from '../task-ledger';

test('stable references reach the wire; only known gateway validation errors allow a new send', () => {
  expect(ledgerTaskBody({ goal: 'Read the date', clientRef: 'home-ref' })).toEqual({
    goal: 'Read the date',
    client_ref: 'home-ref',
  });
  expect(
    isLedgerTaskRejection(new Error('Open task: 400 {"error":{"code":"unknown_model"}}'))
  ).toBe(true);
  for (const failure of [
    'Open task: 408 {"error":{"code":"invalid_request"}}',
    'Open task: 409 {"error":{"code":"already_accepted"}}',
    'Open task: 400 <html>proxy timeout</html>',
    'Open task: 504 {"error":{"code":"invalid_request"}}',
    'Open task: 503 {"error":{"code":"agent_error"}}',
    'Open task: 502 {"error":{"code":"agent_unavailable"}}',
    'Open task: 503 <html>service unavailable</html>',
  ])
    expect(isLedgerTaskRejection(new Error(failure))).toBe(false);
});

test('a pre-creation readiness refusal allows the same goal after the computer recovers', async () => {
  for (const code of ['agent_unavailable', 'no_terminal']) {
    let posts = 0;
    const home = caller({
      create: async (request) => {
        posts++;
        if (posts === 1) throw new Error(`Open task: 503 ${JSON.stringify({ error: { code } })}`);
        return task(request.clientRef!);
      },
    });
    expect((await home.send()).kind).toBe('rejected');
    expect(home.pending()).toEqual([]);
    expect(posts).toBe(1);
    expect((await home.send()).kind).toBe('accepted');
    expect(posts).toBe(2);
  }
});

test('a future Gateway preflight refusal remains actionable without automatically resending', async () => {
  let posts = 0;
  const home = caller({
    create: async () => {
      posts++;
      throw new Error(
        'Open task: 503 {"error":{"code":"future_provider_not_ready","delivery":"not_sent"}}'
      );
    },
  });
  expect((await home.send()).kind).toBe('rejected');
  expect(home.pending()).toEqual([]);
  expect(posts).toBe(1);
  for (const delivery of [undefined, 'unknown', 'accepted', false, { status: 'not_sent' }]) {
    expect(
      isLedgerTaskRejection(
        new Error(`Open task: 503 ${JSON.stringify({ error: { code: 'future', delivery } })}`)
      )
    ).toBe(false);
  }
});

const task = (clientRef: string, state = 'working', deviceId = 'phone-a'): CreatedLedgerTask => {
  const created = parseCreatedLedgerTask({
    task_id: 'task-a',
    state,
    origin: 'device',
    client_ref: clientRef,
    requested_by: { id: deviceId, name: 'Phone', kind: 'device' },
    goal: 'Read the date',
    binding: { kind: 'none' },
    updated_ms: 1,
  });
  if (!created) throw new Error('Invalid fixture');
  return created;
};

function caller(options: {
  stored?: Map<string, string>;
  create: (request: LedgerTaskRequest) => Promise<CreatedLedgerTask | null>;
  read?: () => Promise<TaskView[] | null>;
  writable?: boolean;
}) {
  const stored = options.stored ?? new Map<string, string>();
  const source = [
    'deliveryKey',
    'loadUnconfirmedHomeTasks',
    'saveUnconfirmedHomeTasks',
    'forgetHomeLedgerTask',
    'forgetHomeLedgerDeliveries',
    'taskForHomeDelivery',
    'reconcileHomeLedgerTask',
    'createHomeLedgerTask',
  ]
    .map((name) => declaration('src/lib/home-ledger-delivery.ts', name))
    .join('\n');
  const api = runInNewContext(
    transpile(
      `let storage; const KEY_PREFIX = 'home-task-delivery.v1:';\n${source}\n({createHomeLedgerTask, loadUnconfirmedHomeTasks, forgetHomeLedgerDeliveries})`
    ),
    {
      QuickCrypto: crypto,
      createMMKV: () => ({
        getString: (key: string) => stored.get(key),
        set: (key: string, value: string) => {
          if (options.writable === false) throw new Error('storage unavailable');
          stored.set(key, value);
        },
        remove: (key: string) => stored.delete(key),
        getAllKeys: () => Array.from(stored.keys()),
      }),
      createLedgerTask: options.create,
      fetchTaskList: options.read ?? (async () => []),
      deliverLedgerTask,
    }
  ) as {
    createHomeLedgerTask: typeof createHomeLedgerTask;
    loadUnconfirmedHomeTasks: typeof import('../home-ledger-delivery').loadUnconfirmedHomeTasks;
    forgetHomeLedgerDeliveries: typeof import('../home-ledger-delivery').forgetHomeLedgerDeliveries;
  };
  return {
    stored,
    pending: (deviceId = 'phone-a') =>
      api.loadUnconfirmedHomeTasks({ serverId: 'computer-a', deviceId }),
    forgetServer: (serverId: string) => api.forgetHomeLedgerDeliveries(serverId),
    send: (goal = 'Read the date', deviceId = 'phone-a') =>
      api.createHomeLedgerTask({
        serverId: 'computer-a',
        deviceId,
        request: { goal, agentId: 'codex' },
        isCurrent: () => true,
        knownTasks: () => [],
      }),
  };
}

test('a lost success reply is recovered by client reference, even before binding exists', async () => {
  let accepted: CreatedLedgerTask | null = null;
  let posts = 0;
  const home = caller({
    create: async (request) => {
      posts++;
      accepted = task(request.clientRef ?? '', 'queued');
      throw new Error('response lost');
    },
    read: async () => (accepted ? [accepted.task] : []),
  });
  const result = await home.send();
  expect(result.kind).toBe('accepted');
  if (result.kind === 'accepted') expect(result.created.task.state).toBe('queued');
  expect(posts).toBe(1);
  expect(home.stored.size).toBe(0);
});

test('manual retry after restart only reconciles the original reference; empty reads never repost', async () => {
  const posts: LedgerTaskRequest[] = [];
  const stored = new Map<string, string>();
  const create = async (request: LedgerTaskRequest) => {
    posts.push(request);
    throw new Error('timeout');
  };
  expect((await caller({ stored, create }).send()).kind).toBe('unknown');
  const restarted = caller({ stored, create });
  expect(restarted.pending()).toEqual([
    { goal: 'Read the date', clientRef: posts[0]?.clientRef ?? '' },
  ]);
  expect((await restarted.send()).kind).toBe('unknown');
  expect((await restarted.send('  Read the date  ')).kind).toBe('unknown');
  expect(posts).toHaveLength(1);
  const reference = posts[0]?.clientRef ?? '';
  const recovered = caller({
    stored,
    create,
    read: async () => [task(reference).task],
  });
  expect((await recovered.send()).kind).toBe('accepted');
  expect(posts).toHaveLength(1);
  expect(stored.size).toBe(0);
});

test('a definitive rejection permits a new manual send', async () => {
  let posts = 0;
  const home = caller({
    create: async (request) => {
      posts++;
      if (posts === 1) throw new Error('Open task: 400 {"error":{"code":"unknown_model"}}');
      return task(request.clientRef ?? '');
    },
  });
  expect((await home.send()).kind).toBe('rejected');
  expect(home.stored.size).toBe(0);
  expect((await home.send()).kind).toBe('accepted');
  expect(posts).toBe(2);
});

test('server errors, malformed success and failed reconciliation reads stay unknown', async () => {
  for (const failure of ['Open task: 500 {}', 'Open task: 408 {}', null]) {
    let posts = 0;
    const home = caller({
      create: async () => {
        posts++;
        if (failure) throw new Error(failure);
        return null;
      },
      read: async () => {
        throw new Error('read failed');
      },
    });
    expect((await home.send()).kind).toBe('unknown');
    expect((await home.send()).kind).toBe('unknown');
    expect(posts).toBe(1);
  }
});

test('reconciliation cannot accept another device task with the same reference', async () => {
  let reference = '';
  const home = caller({
    create: async (request) => {
      reference = request.clientRef ?? '';
      throw new Error('response lost');
    },
    read: async () => [task(reference, 'working', 'phone-b').task],
  });
  expect((await home.send()).kind).toBe('unknown');
});

test('durable storage failure stops before a mutation', async () => {
  let posts = 0;
  const home = caller({
    writable: false,
    create: async () => {
      posts++;
      return null;
    },
  });
  await expect(home.send()).rejects.toThrow('storage unavailable');
  expect(posts).toBe(0);
});

test('cleanup failure never turns a known acceptance back into an uncertain or unsent goal', async () => {
  const accepted = task('home-1234567890abcdef1234567890abcdef', 'queued');
  for (const previousRef of [undefined, accepted.task.clientRef]) {
    let posts = 0;
    const result = await deliverLedgerTask({
      previousRef,
      newRef: () => accepted.task.clientRef ?? '',
      remember: () => {},
      forget: () => {
        throw new Error('cleanup unavailable');
      },
      create: async () => {
        posts++;
        return accepted;
      },
      find: async () => accepted,
    });
    expect(result).toEqual({ kind: 'accepted', created: accepted });
    expect(posts).toBe(previousRef ? 0 : 1);
  }
});

test('changed device identities have separate visible uncertainty; unpair clears only its computer', async () => {
  const home = caller({
    create: async () => {
      throw new Error('response lost');
    },
  });
  expect((await home.send()).kind).toBe('unknown');
  expect(home.pending('phone-b')).toEqual([]);
  expect((await home.send('Another goal', 'phone-b')).kind).toBe('unknown');
  expect(home.pending('phone-b')).toHaveLength(1);
  home.forgetServer('other-computer');
  expect(home.pending()).toHaveLength(1);
  home.forgetServer('computer-a');
  expect(home.pending()).toEqual([]);
  expect(home.pending('phone-b')).toEqual([]);
});

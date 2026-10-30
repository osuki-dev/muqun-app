import { expect, test } from 'bun:test';
import {
  ForegroundSessionActivation,
  SessionPreparationFlights,
  bindForegroundSessionAgents,
  foregroundSessionAgent,
} from '../foreground-session-activation';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const capabilities = ['agent_session_resume_v1'];

test('an explicitly bound foreground session prepares before its first snapshot succeeds', async () => {
  // The route identity remains usable when the first history GET fails.
  const bindings = bindForegroundSessionAgents(null, 'pairing-A/workspace-1', [
    { asid: 'parked', agent_id: 'qoder-instance' },
  ]);
  const sent: string[] = [];
  const agent = foregroundSessionAgent(bindings, 'pairing-A/workspace-1', 'parked');
  new ForegroundSessionActivation().start({
    foreground: true,
    capabilities,
    current: () => true,
    prepare: async () => {
      if (agent) sent.push(agent + '/parked');
    },
    prepared: () => {},
    failed: () => {},
  });
  await Promise.resolve();
  expect(sent).toEqual(['qoder-instance/parked']);
  expect(foregroundSessionAgent(bindings, 'pairing-A/workspace-1', 'other')).toBeUndefined();
});

test('same-asid bindings cannot cross pairing, workspace or server scopes', () => {
  const bindings = bindForegroundSessionAgents(null, 'server-A/pairing-A/workspace-1', [
    { asid: 'same', agent_id: 'pi-instance' },
  ]);
  for (const source of [
    null,
    'server-B/pairing-A/workspace-1',
    'server-A/pairing-B/workspace-1',
    'server-A/pairing-A/workspace-2',
  ])
    expect(foregroundSessionAgent(bindings, source, 'same')).toBeUndefined();
  const next = bindForegroundSessionAgents(bindings, 'server-B/pairing-A/workspace-1', [
    { asid: 'same', agent_id: 'fx-instance' },
  ]);
  expect(foregroundSessionAgent(next, bindings!.source, 'same')).toBeUndefined();
  expect(foregroundSessionAgent(next, next!.source, 'same')).toBe('fx-instance');
});

test('session-list observations bind exact opaque identities without activating the list', () => {
  let bindings = bindForegroundSessionAgents(null, 'current-source', [
    { asid: 'first', agent_id: 'qoder-instance' },
    { asid: '__proto__', agent_id: 'pi-instance' },
    { asid: 'unreported' },
  ]);
  bindings = bindForegroundSessionAgents(bindings, 'current-source', [
    { asid: 'second', agent_id: 'fx-instance' },
  ]);
  expect(foregroundSessionAgent(bindings, 'current-source', 'first')).toBe('qoder-instance');
  expect(foregroundSessionAgent(bindings, 'current-source', '__proto__')).toBe('pi-instance');
  expect(foregroundSessionAgent(bindings, 'current-source', 'second')).toBe('fx-instance');
  expect(foregroundSessionAgent(bindings, 'current-source', 'unreported')).toBeUndefined();
  expect(foregroundSessionAgent(bindings, 'current-source', 'constructor')).toBeUndefined();
});

test('conflicting provider claims and deleted bindings never choose a preparation target', () => {
  let bindings = bindForegroundSessionAgents(null, 'source', [
    { asid: 'same', agent_id: 'pi-instance' },
  ]);
  bindings = bindForegroundSessionAgents(bindings, 'source', [
    { asid: 'same', agent_id: 'fx-instance' },
  ]);
  expect(foregroundSessionAgent(bindings, 'source', 'same')).toBeUndefined();
  bindings = bindForegroundSessionAgents(bindings, 'source', [
    { asid: 'same', agent_id: 'pi-instance' },
    { asid: 'deleted', agent_id: 'pi-instance', deleted: true },
  ]);
  expect(foregroundSessionAgent(bindings, 'source', 'same')).toBeUndefined();
  expect(foregroundSessionAgent(bindings, 'source', 'deleted')).toBeUndefined();
});

test('background reads and absent capabilities never activate a process', () => {
  let sends = 0;
  for (const config of [
    { foreground: false, capabilities },
    { foreground: true, capabilities: undefined },
    { foreground: true, capabilities: [] },
  ]) {
    new ForegroundSessionActivation().start({
      ...config,
      current: () => true,
      prepare: async () => {
        sends++;
      },
      prepared: () => {},
      failed: () => {},
    });
  }
  expect(sends).toBe(0);
});

test('a stale owner cannot dispatch even before the first activation starts', () => {
  let sends = 0;
  new ForegroundSessionActivation().start({
    foreground: true,
    capabilities,
    current: () => false,
    prepare: async () => {
      sends++;
    },
    prepared: () => {},
    failed: () => {},
  });
  expect(sends).toBe(0);
});

test('session switches, lost foreground and changed pairing reject late activation results', async () => {
  for (const stale of ['selection', 'foreground', 'pairing']) {
    const activation = new ForegroundSessionActivation();
    const first = deferred();
    let owner = true;
    const events: string[] = [];
    const cancel = activation.start({
      foreground: true,
      capabilities,
      current: () => owner,
      prepare: () => first.promise,
      prepared: () => events.push('old'),
      failed: () => events.push('old-error'),
    });
    if (stale === 'pairing') owner = false;
    else cancel();
    if (stale === 'selection')
      activation.start({
        foreground: true,
        capabilities,
        current: () => true,
        prepare: async () => {},
        prepared: () => events.push('new'),
        failed: () => {},
      });
    first.resolve();
    await first.promise;
    await Promise.resolve();
    expect(events).toEqual(stale === 'selection' ? ['new'] : []);
  }
});

test('canceling an old effect cannot cancel the newer open intent', async () => {
  const activation = new ForegroundSessionActivation();
  const first = deferred();
  const second = deferred();
  const events: string[] = [];
  const start = (work: Promise<void>, label: string) =>
    activation.start({
      foreground: true,
      capabilities,
      current: () => true,
      prepare: () => work,
      prepared: () => events.push(label),
      failed: () => events.push(label + '-error'),
    });
  const cancel = start(first.promise, 'first');
  start(second.promise, 'second');
  cancel();
  first.reject(new Error('late failure'));
  second.resolve();
  await Promise.allSettled([first.promise, second.promise]);
  await Promise.resolve();
  expect(events).toEqual(['second']);
});

test('surfaces coalesce in flight by captured owner, without caching success or retrying failure', async () => {
  const flights = new SessionPreparationFlights();
  const work = deferred();
  let sends = 0;
  const send = () => {
    sends++;
    return work.promise;
  };
  const first = flights.run('pairing/agent/asid', send);
  const joined = flights.run('pairing/agent/asid', send);
  const other = flights.run('other-pairing/agent/asid', async () => {
    sends++;
  });
  expect(first).toBe(joined);
  expect(sends).toBe(2);
  work.reject(new Error('unavailable'));
  await Promise.allSettled([first, joined, other]);
  await Promise.resolve();
  expect(sends).toBe(2);
  await flights.run('pairing/agent/asid', async () => {
    sends++;
  });
  expect(sends).toBe(3);
});

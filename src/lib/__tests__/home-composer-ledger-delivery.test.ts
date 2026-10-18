import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';

import {
  declaration,
  productionSource,
  transpile,
  walk,
} from '../../test-support/production-source';
import { recoverWith, recoverWithSync, settleAfter } from '../compiler-safe-control-flow';
import { parseCreatedLedgerTask, type LedgerTaskDelivery } from '../task-ledger';

function dock(
  delivery: LedgerTaskDelivery,
  cleanupFails = false,
  move?: { serverId: string; deviceId: string; targetOnly?: boolean }
) {
  const settled: string[] = [];
  const errors: (string | null)[] = [];
  const tasks: string[] = [];
  const unknown: unknown[] = [];
  const record = { serverId: 'computer-a', deviceId: 'phone-a' };
  let currentRecord = record;
  let visibleScope = record;
  const production = productionSource('src/components/home-composer-dock.tsx');
  let scopeCallback = '';
  walk(production.program, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === 'isCurrentDeliveryScope'
    )
      scopeCallback = `const ${production.code(node)};`;
  });
  if (!scopeCallback) throw new Error('Missing delivery scope guard');
  const source = ['sendHomeLedger', 'openLedgerTask', 'startTerminalAgent']
    .map((name) => declaration('src/components/home-composer-dock.tsx', name))
    .join('\n');
  const api = runInNewContext(
    transpile(`${scopeCallback}\n${source}\n({openLedgerTask,startTerminalAgent})`),
    {
      useCallback: (callback: unknown) => callback,
      recoverWith,
      recoverWithSync,
      settleAfter,
      createHomeLedgerTask: async () => {
        if (move) {
          visibleScope = move;
          if (!move.targetOnly) currentRecord = move;
        }
        await Promise.resolve();
        return delivery;
      },
      readDeliveryScope: () => visibleScope,
      loadUnconfirmedHomeTasks: () => {
        if (cleanupFails) throw new Error('storage unavailable');
        return [];
      },
      useGatewayConnectionStore: { getState: () => ({ record: currentRecord, records: [record] }) },
      useHomeTaskCards: {
        getState: () => ({
          dispatched: () => 'pending-a',
          settle: (id: string) => settled.push(id),
        }),
      },
      useServerTasksStore: {
        getState: () => ({
          index: {},
          upsert: (_server: string, task: { taskId: string }) => tasks.push(task.taskId),
        }),
      },
      inFlightRef: { current: false },
      unknownDelivery: null,
      setUnknownDelivery: (value: unknown) => unknown.push(value),
      setError: (value: string | null) => errors.push(value),
      sendTarget: async () => record.serverId,
      mentionsIn: async () => [],
      sessionParams: {},
      folder: undefined,
      markAgentUsed: () => {},
      markPromptedSession: () => {},
      recordEndpoint: () => ({}),
      sameComputer: (a: unknown, b: unknown) => a === b,
      checkAgentServer: async () => ({}),
      homeGuideParams: () => null,
      router: { push: () => {} },
      describeFailure: () => 'Refused',
      describeGatewayFailure: () => ({ message: 'Refused' }),
      t: (strings: TemplateStringsArray) => strings.join(''),
      console: { warn: () => {} },
    }
  ) as {
    openLedgerTask: (text: string) => Promise<boolean>;
    startTerminalAgent: (
      kind: string,
      name: string,
      confirmed: boolean,
      text: string,
      viaLedger: boolean,
      cwd?: string
    ) => Promise<boolean>;
  };
  return { ...api, settled, errors, tasks, unknown };
}

function accepted(state: 'queued' | 'failed'): LedgerTaskDelivery {
  const created = parseCreatedLedgerTask({
    task_id: 'task-a',
    state,
    goal: 'Read the date',
    binding: { kind: 'none' },
  });
  if (!created) throw new Error('Invalid fixture');
  return { kind: 'accepted', created };
}

for (const path of ['session', 'terminal'] as const) {
  const send = (home: ReturnType<typeof dock>) =>
    path === 'session'
      ? home.openLedgerTask('Read the date')
      : home.startTerminalAgent('codex', 'Codex', true, 'Read the date', true);

  test(`${path}: unknown send keeps pending and consumes the draft without calling it unsent`, async () => {
    const home = dock({ kind: 'unknown', clientRef: 'home-ref' });
    expect(await send(home)).toBe(true);
    expect(home.settled).toEqual([]);
    expect(home.unknown).toHaveLength(1);
    expect(home.errors).toEqual([null]);
  });

  test(`${path}: accepted queued or failed task stays accepted without a session binding`, async () => {
    for (const state of ['queued', 'failed'] as const) {
      const home = dock(accepted(state));
      expect(await send(home)).toBe(true);
      expect(home.tasks).toEqual(['task-a']);
      expect(home.settled).toEqual(['pending-a']);
    }
  });

  test(`${path}: cleanup read failure never restores an accepted draft`, async () => {
    const home = dock(accepted('queued'), true);
    expect(await send(home)).toBe(true);
    expect(home.tasks).toEqual(['task-a']);
    expect(home.errors.at(-1)).toBe('Task accepted. Send status could not be saved.');
  });

  test(`${path}: definitive rejection restores the draft through the existing false result`, async () => {
    const home = dock({ kind: 'rejected', failure: new Error('Open task: 400 invalid_request') });
    expect(await send(home)).toBe(false);
    expect(home.settled).toEqual(['pending-a']);
    expect(home.tasks).toEqual([]);
  });

  test(`${path}: late delivery cannot replace another computer or device's visible status`, async () => {
    for (const move of [
      { serverId: 'computer-b', deviceId: 'phone-b' },
      { serverId: 'computer-a', deviceId: 'phone-b' },
      { serverId: 'computer-b', deviceId: 'phone-a', targetOnly: true },
    ]) {
      for (const delivery of [
        { kind: 'unknown' as const, clientRef: 'home-ref' },
        accepted('queued'),
      ]) {
        const home = dock(delivery, true, move);
        expect(await send(home)).toBe(true);
        expect(home.unknown).toEqual([]);
        expect(home.errors).toEqual([null]);
        expect(home.tasks).toEqual(delivery.kind === 'accepted' ? ['task-a'] : []);
      }
    }
  });
}

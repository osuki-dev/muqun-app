import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { create } from 'zustand';
import { productionSource, transpile } from '../../test-support/production-source';
import * as cards from '../../lib/home-computer-cards';
import type { PendingDispatch, PendingResend } from '../../lib/home-computer-cards';

type State = {
  pending: PendingDispatch[];
  dispatched: (serverId: string, goal: string, draft?: PendingResend) => string;
  failed: (id: string, reason: string, resend: PendingResend) => void;
  unconfirmed: (id: string, asid: string, resend: PendingResend) => void;
  replied: (id: string, state: 'working' | 'done' | 'failed', atMs: number) => void;
  settle: (id: string) => void;
};

/** Actual store and persistence parser, with only the native key-value boundary replaced. */
function restoredStore(values: Map<string, string>, storageFailure = false) {
  const source = productionSource('src/stores/home-task-cards.ts');
  const body = source.program.body
    .filter((node) => node.type !== 'ImportDeclaration')
    .map((node) =>
      node.type === 'ExportNamedDeclaration'
        ? node.declaration
          ? source.code(node.declaration)
          : ''
        : source.code(node)
    )
    .join('\n');
  return runInNewContext(transpile(`${body}\nuseHomeTaskCards`), {
    ...cards,
    create,
    TextEncoder,
    createMMKV: () => ({
      getString: (key: string) => values.get(key),
      set: (key: string, value: string) => {
        if (storageFailure) throw new Error('fixture disk full');
        values.set(key, value);
      },
    }),
    useServerTasksStore: { getState: () => ({ index: {} }), subscribe: () => () => {} },
  }) as { getState: () => State };
}

test('a full byte budget or unavailable persistence refuses only the new draft before staging', () => {
  const values = new Map<string, string>();
  const store = restoredStore(values);
  const previous = store.getState().dispatched('qa', 'keep', draft(1));
  const huge = { ...draft(2), attachments: ['x'.repeat(9 * 1024 * 1024)] };
  expect(() => store.getState().dispatched('qa', 'new', huge)).toThrow();
  expect(store.getState().pending.map((item) => item.id)).toEqual([previous]);
  expect(restoredStore(values).getState().pending[0].resend).toEqual(draft(1));
  const unavailable = restoredStore(values, true);
  expect(() => unavailable.getState().dispatched('qa', 'new', draft(2))).toThrow();
  expect(unavailable.getState().pending.map((item) => item.id)).toEqual([previous]);
  expect(
    restoredStore(values)
      .getState()
      .pending.map((item) => item.id)
  ).toEqual([previous]);
});

function draft(n: number): PendingResend {
  return { text: `draft ${n}`, attachments: [`/uploads/${n}.webp`], params: {} };
}

test('all unsettled and failed submissions survive restart beyond prior cache cutoffs', () => {
  const values = new Map<string, string>();
  const store = restoredStore(values);
  const ids = Array.from({ length: 66 }, (_, n) => {
    const id = store.getState().dispatched('qa', `draft ${n}`);
    if (n < 12) store.getState().failed(id, 'refused', draft(n));
    return id;
  });
  store.getState().unconfirmed(ids[12], 'known-session', draft(12));
  const restored = restoredStore(values);
  expect(restored.getState().pending.map((item) => item.id)).toEqual(ids);
  expect(
    restored
      .getState()
      .pending.slice(0, 12)
      .map((item) => item.resend)
  ).toEqual(Array.from({ length: 12 }, (_, n) => draft(n)));
  expect(restored.getState().pending[12]).toMatchObject({
    unconfirmed: true,
    asid: 'known-session',
    resend: draft(12),
  });
  restored.getState().settle(ids[0]);
  expect(
    restoredStore(values)
      .getState()
      .pending.map((item) => item.id)
  ).toEqual(ids.slice(1));
});

test('equal body text cannot replace a different failed attachment submission', () => {
  const store = restoredStore(new Map());
  const first = store.getState().dispatched('qa', 'review these');
  store.getState().failed(first, 'refused', { ...draft(1), text: 'review these' });
  const second = store.getState().dispatched('qa', 'review these');
  store.getState().failed(second, 'refused', { ...draft(2), text: 'review these' });
  expect(store.getState().pending.map((item) => item.resend?.attachments)).toEqual([
    ['/uploads/1.webp'],
    ['/uploads/2.webp'],
  ]);
});

test('unknown receipts stay unknown until the bound session supplies an authoritative reply', () => {
  const values = new Map<string, string>();
  const store = restoredStore(values);
  const id = store.getState().dispatched('qa', 'draft 0');
  store.getState().unconfirmed(id, 'known-session', draft(0));
  const unknown = store.getState().pending[0];
  expect(cards.pendingUnconfirmed(unknown, unknown.atMs)).toBe(true);
  expect(cards.pendingWorking(unknown, unknown.atMs)).toBe(false);
  expect(unknown.failed).toBeUndefined();
  store.getState().replied(id, 'working', Date.now());
  const readBack = restoredStore(values).getState().pending[0];
  expect(readBack.unconfirmed).toBeUndefined();
  expect(readBack.reply?.state).toBe('working');
  expect(cards.pendingWorking(readBack, readBack.atMs)).toBe(true);
});

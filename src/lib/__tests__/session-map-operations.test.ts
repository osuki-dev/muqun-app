import { expect, test } from 'bun:test';

import {
  beginSessionMapOperation,
  clearSessionMapOutcome,
  finishSessionMapOperation,
  hasSessionMapOutcome,
  markSessionMapOutcomeUnknown,
  ownsSessionMapGateway,
  ownsSessionMapOperation,
  subscribeSessionMapOutcome,
  type SessionMapOperation,
} from '../session-map-operations';

const scope = { scope: 'server\u0000session', generation: 3 };

test('a structural action does not dispatch through a different live server', () => {
  let dispatched = 0;
  if (ownsSessionMapGateway('server-a', 'server-b')) dispatched += 1;
  expect(dispatched).toBe(0);
  expect(ownsSessionMapGateway('server-a', 'server-a')).toBe(true);
  expect(ownsSessionMapGateway('server-a', undefined)).toBe(false);
});

test('a second press in the same scope cannot start another mutation', () => {
  const first = beginSessionMapOperation(scope);
  expect(first).not.toBeNull();

  const duplicate = beginSessionMapOperation(scope);
  expect(duplicate).toBeNull();
  finishSessionMapOperation(first!);
});

test('a different server/session scope has an independent mutation slot', () => {
  const first = beginSessionMapOperation(scope) as SessionMapOperation;
  const nextScope = { scope: 'server\u0000other-session', generation: 4 };
  const next = beginSessionMapOperation(nextScope) as SessionMapOperation;

  expect(next).toMatchObject(nextScope);
  expect(ownsSessionMapOperation(first, scope)).toBe(true);
  expect(ownsSessionMapOperation(next, nextScope)).toBe(true);
  finishSessionMapOperation(first);
  finishSessionMapOperation(next);
});

test('a remounted picker cannot begin until the first owner settles', () => {
  const first = beginSessionMapOperation(scope) as SessionMapOperation;
  expect(beginSessionMapOperation(scope)).toBeNull();
  finishSessionMapOperation(first);

  const remount = beginSessionMapOperation(scope) as SessionMapOperation;
  expect(remount.id).not.toBe(first.id);
  finishSessionMapOperation(remount);
});

test('a late completion from an earlier owner cannot clear a newer owner', () => {
  const first = beginSessionMapOperation(scope) as SessionMapOperation;
  finishSessionMapOperation(first);
  const next = beginSessionMapOperation(scope) as SessionMapOperation;

  finishSessionMapOperation(first);
  expect(ownsSessionMapOperation(next, scope)).toBe(true);
  expect(beginSessionMapOperation(scope)).toBeNull();
  finishSessionMapOperation(next);
});

test('a stale generation cannot own its operation after the scope changes', () => {
  const first = beginSessionMapOperation(scope) as SessionMapOperation;
  expect(
    ownsSessionMapOperation(first, { scope: scope.scope, generation: scope.generation + 1 })
  ).toBe(false);
  finishSessionMapOperation(first);
});

test('an unknown create outcome survives picker remounts and blocks another create', () => {
  const unknown = { scope: 'server-unknown\u0000session', generation: 1 };
  markSessionMapOutcomeUnknown(unknown);

  // A remounted picker has a fresh generation but the same server/session scope.
  expect(hasSessionMapOutcome({ ...unknown, generation: 2 })).toBe(true);
  expect(beginSessionMapOperation({ ...unknown, generation: 2 }, 'create')).toBeNull();

  // Non-create work remains available while the reader checks the list.
  const rename = beginSessionMapOperation({ ...unknown, generation: 2 });
  expect(rename).not.toBeNull();
  finishSessionMapOperation(rename!);

  expect(clearSessionMapOutcome({ ...unknown, generation: 2 })).toBe(true);
  const create = beginSessionMapOperation({ ...unknown, generation: 2 }, 'create');
  expect(create).not.toBeNull();
  finishSessionMapOperation(create!);
});

test('a replacement picker hears a late unknown outcome from its old request', () => {
  const unknown = { scope: 'server-late-outcome\u0000session', generation: 1 };
  const first = beginSessionMapOperation(unknown, 'create');
  expect(first).not.toBeNull();

  let notifications = 0;
  const unsubscribe = subscribeSessionMapOutcome(unknown.scope, () => {
    notifications += 1;
  });
  // The replacement picker is mounted while the first request is still pending.
  markSessionMapOutcomeUnknown(unknown);

  expect(notifications).toBe(1);
  finishSessionMapOperation(first!);
  expect(hasSessionMapOutcome({ ...unknown, generation: 2 })).toBe(true);
  expect(beginSessionMapOperation({ ...unknown, generation: 2 }, 'create')).toBeNull();

  unsubscribe();
  expect(clearSessionMapOutcome(unknown)).toBe(true);
});

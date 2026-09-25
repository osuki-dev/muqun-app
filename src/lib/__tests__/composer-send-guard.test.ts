import { expect, test } from 'bun:test';
import { ComposerSendGuard } from '../composer-send-guard';

test('composer send is synchronously exclusive until its delivery settles', () => {
  const guard = new ComposerSendGuard();
  const first = guard.acquire();
  expect(first).not.toBeNull();
  expect(guard.acquire()).toBeNull();
  expect(guard.release(Symbol('unrelated'))).toBe(false);
  expect(guard.acquire()).toBeNull();
  expect(guard.release(first!)).toBe(true);
  expect(guard.acquire()).not.toBeNull();
});

test('a completion from before session reset cannot release a newer send', () => {
  const guard = new ComposerSendGuard();
  const old = guard.acquire()!;
  guard.reset();
  const current = guard.acquire()!;
  expect(guard.owns(old)).toBe(false);
  expect(guard.release(old)).toBe(false);
  expect(guard.owns(current)).toBe(true);
  expect(guard.acquire()).toBeNull();
  expect(guard.release(current)).toBe(true);
});

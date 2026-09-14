import { expect, test } from 'bun:test';
import { consumeWorkOutputRefresh } from '../work-output-refresh';
import {
  createCollaborationRequestGuard,
  observeCollaborationOutput,
} from '../collaboration-presentation';

const refresh = { attemptId: 'attempt', nonce: 1 };
const pinned = { text: 'Reading', signature: 'old', hasNewOutput: false };
const newer = { text: 'New output', signature: 'new' };

test('failed explicit refresh cannot authorize a later polling replacement', async () => {
  const consumed = new Map<string, number>();
  expect(consumeWorkOutputRefresh(consumed, 'attempt', refresh)).toBe(true);
  await Promise.reject(new Error('Disconnected')).catch(() => {});
  const replace = consumeWorkOutputRefresh(consumed, 'attempt', refresh);
  expect(observeCollaborationOutput(pinned, newer, replace)).toEqual({
    ...pinned,
    hasNewOutput: true,
  });
  expect(consumeWorkOutputRefresh(consumed, 'attempt', { ...refresh, nonce: 2 })).toBe(true);
});

test('leaving during refresh invalidates completion and does not rearm on reentry', () => {
  const consumed = new Map<string, number>();
  const guard = createCollaborationRequestGuard();
  const pending = guard.capture();
  expect(consumeWorkOutputRefresh(consumed, 'attempt', refresh)).toBe(true);
  guard.invalidate();
  consumeWorkOutputRefresh(consumed, 'attempt', refresh);
  expect(pending()).toBe(false);
  expect(consumeWorkOutputRefresh(consumed, 'attempt', refresh)).toBe(false);
  expect(guard.capture()()).toBe(true);
});

test('background invalidates output and navigation even after foreground resumes', async () => {
  const guard = createCollaborationRequestGuard();
  let active = true;
  const valid = guard.capture();
  const isCurrent = () => active && valid();
  let release!: () => void;
  const response = new Promise<void>((resolve) => {
    release = resolve;
  });
  let published = false;
  const completion = response.then(() => {
    if (isCurrent()) published = true;
  });
  active = false;
  guard.invalidate();
  active = true;
  release();
  await completion;
  expect(published).toBe(false);
  expect(isCurrent()).toBe(false);
  expect(guard.capture()()).toBe(true);
});

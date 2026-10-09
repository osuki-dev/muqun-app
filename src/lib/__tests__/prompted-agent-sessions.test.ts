import { expect, test } from 'bun:test';

import {
  PROMPTED_SESSION_WAIT_MS,
  markPromptedSession,
  promptedSessionWaitMs,
} from '../prompted-agent-sessions';

test('a session the dock just prompted waits for its first row, briefly', () => {
  markPromptedSession('studio', 'as-1', 1_000);
  expect(promptedSessionWaitMs('studio', 'as-1', 1_000)).toBe(PROMPTED_SESSION_WAIT_MS);
  expect(promptedSessionWaitMs('studio', 'as-1', 6_000)).toBe(PROMPTED_SESSION_WAIT_MS - 5_000);
  expect(promptedSessionWaitMs('studio', 'as-1', 1_000 + PROMPTED_SESSION_WAIT_MS)).toBe(0);
  // Spent: a later visit is an ordinary one.
  expect(promptedSessionWaitMs('studio', 'as-1', 1_000)).toBe(0);
});

test('any other session, computer or no session at all does not wait', () => {
  markPromptedSession('studio', 'as-2', 1_000);
  expect(promptedSessionWaitMs('laptop', 'as-2', 1_000)).toBe(0);
  expect(promptedSessionWaitMs('studio', 'as-3', 1_000)).toBe(0);
  expect(promptedSessionWaitMs('studio', undefined, 1_000)).toBe(0);
});

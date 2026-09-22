import { expect, test } from 'bun:test';

import { isShellNotFoundError } from '../agent-shell-errors';

test('recognizes structured and wrapped ShellNotFound errors', () => {
  expect(isShellNotFoundError({ _tag: 'ShellNotFoundError', id: 'sh_done' })).toBe(true);
  expect(
    isShellNotFoundError({
      error: {
        code: 'agent_engine_error',
        message:
          'Agent request failed: HTTP 404 Not Found: {"_tag":"ShellNotFoundError","id":"sh_done"}',
      },
    })
  ).toBe(true);
  expect(
    isShellNotFoundError(
      new Error(
        'Failed to stop shell: 502 {"error":{"code":"agent_engine_error","message":"Agent request failed: HTTP 404 Not Found: {\\"_tag\\":\\"ShellNotFoundError\\",\\"id\\":\\"sh_done\\"}"}}'
      )
    )
  ).toBe(true);
});

test('does not hide unrelated stop failures', () => {
  for (const error of [
    new Error('Failed to stop shell: 404 Not Found'),
    new Error('Failed to stop shell: 502 agent engine offline'),
    new Error('{"_tag":"PermissionDeniedError"}'),
    { error: { code: 'agent_engine_error', message: 'Shell command not found' } },
    null,
    undefined,
  ]) {
    expect(isShellNotFoundError(error)).toBe(false);
  }
});

import { describe, expect, test } from 'bun:test';

import { sshCancelledError, waitUnlessAborted } from '@/lib/ssh-cancel';
import { describeSshFailure } from '@/lib/ssh-client';

describe('sshCancelledError', () => {
  test("reads as the library's CANCELLED", () => {
    const failure = describeSshFailure(sshCancelledError());
    expect(failure.code).toBe('CANCELLED');
    expect(failure.message).toContain('cancelled');
  });
});

describe('waitUnlessAborted', () => {
  test('resolves after the delay when nothing aborts', async () => {
    const started = Date.now();
    await waitUnlessAborted(30, new AbortController().signal);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  test('a signal already aborted rejects at once', async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await waitUnlessAborted(10_000, controller.signal).catch(
      (reason: unknown) => reason
    );
    expect(describeSshFailure(error).code).toBe('CANCELLED');
  });

  test('an abort during the wait rejects then, not after the delay', async () => {
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 20);
    const error = await waitUnlessAborted(10_000, controller.signal).catch(
      (reason: unknown) => reason
    );
    expect(error instanceof Error && error.name).toBe('SshError');
    expect(describeSshFailure(error).code).toBe('CANCELLED');
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('works without a signal at all', async () => {
    expect(await waitUnlessAborted(5)).toBeUndefined();
  });
});

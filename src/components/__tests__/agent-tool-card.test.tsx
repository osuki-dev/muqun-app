import { expect, test } from 'bun:test';

import { shellIdFromMetadata, shellTimedOutFromMetadata } from '@/lib/agent-tool-output';

test('a command that was cut off says so, beside its exit code', () => {
  const success = { status: 'completed', truncated: false, exit: 0 };
  expect(shellTimedOutFromMetadata({ ...success, exit: 143, timeout: true })).toBe(true);
  expect(shellTimedOutFromMetadata({ status: 'timeout' })).toBe(true);
  expect(shellTimedOutFromMetadata(success)).toBe(false);
  // A configured timeout is not evidence that the command timed out.
  expect(shellTimedOutFromMetadata({ ...success, timeout: 120000 })).toBe(false);
});

test('the shell is identified from progress metadata and absent from a plain completion', () => {
  expect(shellIdFromMetadata({ shellID: 'sh_example' })).toBe('sh_example');
  expect(shellIdFromMetadata({ status: 'completed', truncated: false, exit: 0 })).toBe('');
});

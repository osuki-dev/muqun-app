import { expect, test } from 'bun:test';
import { summarizeBuildFailure } from '../../scripts/build-failure-summary';

test('only fixed phase and category labels escape a failed signing job log', () => {
  const secret = 'private-keystore-payload-and-password';
  const result = summarizeBuildFailure(
    `[INSTALL_DEPENDENCIES] done\n[RUN_GRADLEW] Java heap space\nError: ${secret}\n{"keystore":"${secret}"}`
  );
  expect(result).toEqual({ phase: 'RUN_GRADLEW', category: 'MEMORY_LIMIT' });
  expect(JSON.stringify(result).includes(secret)).toBe(false);
});

test('unknown errors and injected phase names never become diagnostic output', () => {
  expect(summarizeBuildFailure('[SECRET_VALUE] Error: secret-value')).toEqual({
    phase: 'INITIALIZATION',
    category: 'BUILD_FAILED',
  });
});

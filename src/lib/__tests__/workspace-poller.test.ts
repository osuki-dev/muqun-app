import { expect, test } from 'bun:test';
import { startWorkspacePoller } from '../workspace-poller';

function harness() {
  const pending: ((result: string | null) => void)[] = [];
  const results: string[] = [];
  const timers: { task: () => void; delay: number; cancelled: boolean }[] = [];
  const reads: boolean[] = [];
  const stop = startWorkspacePoller<string>({
    initial: true,
    refresh: (initial) => {
      reads.push(initial);
      return new Promise((resolve) => pending.push(resolve));
    },
    onResult: (result) => {
      results.push(result);
      return result === 'fatal' ? null : result === 'connected' ? 12000 : 2000;
    },
    schedule: (task, delay) => {
      const timer = { task, delay, cancelled: false };
      timers.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  return { pending, results, timers, reads, stop };
}

test('a superseded read keeps polling without reporting a false connection failure', async () => {
  const h = harness();
  h.pending.shift()!(null);
  await Promise.resolve();
  expect(h.results).toEqual([]);
  expect(h.timers[0].delay).toBe(1000);
  expect(h.reads).toEqual([true]);
  h.timers[0].task();
  h.pending.shift()!('connected');
  await Promise.resolve();
  expect(h.reads).toEqual([true, false]);
  expect(h.results).toEqual(['connected']);
  expect(h.timers[1].delay).toBe(12000);
  h.stop();
});

test('repeated supersession remains delayed and eventually resumes normal results', async () => {
  const h = harness();
  for (let i = 0; i < 3; i++) {
    h.pending.shift()!(null);
    await Promise.resolve();
    expect(h.timers[i].delay).toBe(1000);
    expect(h.results).toEqual([]);
    h.timers[i].task();
  }
  h.pending.shift()!('retryable');
  await Promise.resolve();
  expect(h.results).toEqual(['retryable']);
  expect(h.timers[3].delay).toBe(2000);
  h.stop();
});

test('a stopped poll cannot publish a late result or restart after supersession', async () => {
  for (const result of [null, 'connected', 'retryable']) {
    const h = harness();
    h.stop();
    h.pending.shift()!(result);
    await Promise.resolve();
    expect(h.results).toEqual([]);
    expect(h.timers).toEqual([]);
  }
});

test('stopping cancels the scheduled retry and fatal results do not retry', async () => {
  const h = harness();
  h.pending.shift()!(null);
  await Promise.resolve();
  h.stop();
  expect(h.timers[0].cancelled).toBe(true);
  h.timers[0].task();
  expect(h.reads).toEqual([true]);
  const fatal = harness();
  fatal.pending.shift()!('fatal');
  await Promise.resolve();
  expect(fatal.results).toEqual(['fatal']);
  expect(fatal.timers).toEqual([]);
  fatal.stop();
});

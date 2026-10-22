import { describe, expect, test } from 'bun:test';

import { createStageCompilation } from './stage-compilation';

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('stage compilation', () => {
  test('compiles once and draws only after completion', async () => {
    const gate = createStageCompilation();
    const work = deferred();
    let calls = 0;
    let wakes = 0;
    const compile = () => {
      calls += 1;
      return work.promise;
    };
    const wake = () => {
      wakes += 1;
    };
    const fail = () => {
      throw new Error('unexpected failure');
    };
    expect(gate.ready(compile, wake, fail)).toBe(false);
    expect(gate.ready(compile, wake, fail)).toBe(false);
    await flush();
    expect(calls).toBe(1);
    work.resolve();
    await flush();
    expect(wakes).toBe(1);
    expect(gate.ready(compile, wake, fail)).toBe(true);
    expect(gate.ready(compile, wake, fail)).toBe(true);
    expect(calls).toBe(1);
  });

  test('coalesces changes during compilation and serializes the latest scene', async () => {
    const gate = createStageCompilation();
    const first = deferred();
    const second = deferred();
    let calls = 0;
    const compile = () => (++calls === 1 ? first.promise : second.promise);
    const noop = () => {};
    gate.ready(compile, noop, noop);
    await flush();
    gate.changed();
    gate.changed();
    expect(gate.ready(compile, noop, noop)).toBe(false);
    expect(calls).toBe(1);
    first.resolve();
    await flush();
    expect(gate.ready(compile, noop, noop)).toBe(false);
    await flush();
    expect(calls).toBe(2);
    second.resolve();
    await flush();
    expect(gate.ready(compile, noop, noop)).toBe(true);
  });

  test('blur suppresses presentation wake but retains compiled scene for resume', async () => {
    const gate = createStageCompilation();
    const work = deferred();
    let paused = false;
    let wakes = 0;
    const wake = () => {
      if (!paused) wakes += 1;
    };
    const compile = () => work.promise;
    const noop = () => {};
    gate.ready(compile, wake, noop);
    paused = true;
    work.resolve();
    await flush();
    expect(wakes).toBe(0);
    paused = false;
    expect(gate.ready(compile, wake, noop)).toBe(true);
  });

  test('unmount waits for compiler before releasing resources and never wakes', async () => {
    const gate = createStageCompilation();
    const work = deferred();
    let released = false;
    let wakes = 0;
    const compile = () => work.promise;
    const wake = () => {
      wakes += 1;
    };
    const noop = () => {};
    gate.ready(compile, wake, noop);
    const closing = gate.close().then(() => {
      released = true;
    });
    await flush();
    expect(released).toBe(false);
    work.resolve();
    await closing;
    expect(released).toBe(true);
    expect(wakes).toBe(0);
    expect(gate.ready(compile, wake, noop)).toBe(false);
  });

  test('compilation failure reports once without retrying or acknowledging', async () => {
    const gate = createStageCompilation();
    let failures = 0;
    let wakes = 0;
    const compile = () => Promise.reject(new Error('compile failed'));
    const wake = () => {
      wakes += 1;
    };
    const fail = () => {
      failures += 1;
    };
    gate.ready(compile, wake, fail);
    await flush();
    gate.changed();
    expect(gate.ready(compile, wake, fail)).toBe(false);
    expect(failures).toBe(1);
    expect(wakes).toBe(0);
    await gate.close();
  });
});

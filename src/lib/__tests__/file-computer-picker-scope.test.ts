import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';

const source = 'src/components/file-computer-picker.tsx';
class Selection extends Error {
  path = '/fixture/report.txt';
}
type Choice = {
  scopeKey: string;
  path: string;
  finish: (id: string | null) => void;
};
type Read = (...args: unknown[]) => Promise<unknown>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

/** Execute the actual async resolver and cancellation, without rendering native UI. */
function harness(options: { direct?: Read; gateways?: Read; selected?: Read } = {}) {
  let current = 'child-a';
  let choice: Choice | null = null;
  const pending = new Map<() => void, string>();
  const waiting = new Map<string, (value: Choice) => void>();
  const directReads: unknown[][] = [];
  const selectedReads: unknown[][] = [];
  const factory = runInNewContext(
    transpile(`
    ${declaration(source, 'requireFileSelectionScope')}
    ${declaration(source, 'cancelFileSelections')}
    (scopeKey) => {
      ${declaration(source, 'resolve')}
      return { resolve, cancel: () => cancelFileSelections(pending, scopeKey) };
    }
  `),
    {
      pending,
      readScope: () => current,
      setChoice: (next: Choice | null | ((previous: Choice | null) => Choice | null)) => {
        choice = typeof next === 'function' ? next(choice) : next;
        if (choice) {
          waiting.get(choice.scopeKey)?.(choice);
          waiting.delete(choice.scopeKey);
        }
      },
      resolveAgentFileAsset: async (...args: unknown[]) => {
        directReads.push(args);
        if (options.direct) return options.direct(...args);
        throw new Selection();
      },
      loadGateways:
        options.gateways ??
        (async () => [
          { serverId: 'origin', label: 'Origin' },
          { serverId: 'other', label: 'Other' },
        ]),
      resolveComputerFile: async (...args: unknown[]) => {
        selectedReads.push(args);
        return options.selected ? options.selected(...args) : { id: 'selected-asset' };
      },
      FileComputerSelection: Selection,
      t: (strings: TemplateStringsArray) => strings[0],
    }
  ) as (scope: string) => {
    resolve: (asid: string, uri: string, signal: AbortSignal, serverId: string) => Promise<unknown>;
    cancel: () => void;
  };
  return {
    factory,
    directReads,
    selectedReads,
    changeScope: (value: string) => {
      current = value;
    },
    choice: () => choice,
    waitChoice: (scope: string) =>
      choice?.scopeKey === scope
        ? Promise.resolve(choice)
        : new Promise<Choice>((accept) => waiting.set(scope, accept)),
  };
}

const read = (
  run: ReturnType<typeof harness>,
  scope = 'child-a',
  signal = new AbortController().signal
) => run.factory(scope).resolve(scope, '/fixture/report.txt', signal, 'origin');

test('current direct and selected file reads preserve captured arguments and ordinary default scope', async () => {
  const asset = { id: 'direct-asset' };
  const direct = harness({ direct: async () => asset });
  const signal = new AbortController().signal;
  expect(await read(direct, 'child-a', signal)).toBe(asset);
  expect(direct.directReads).toEqual([['child-a', '/fixture/report.txt', signal, 'origin']]);

  const selected = harness();
  selected.changeScope('');
  const result = read(selected, '', signal);
  const choice = await selected.waitChoice('');
  choice.finish('other');
  expect(await result).toEqual({ id: 'selected-asset' });
  expect(selected.selectedReads).toEqual([['/fixture/report.txt', 'other', signal]]);
});

test('a stale resolver rejects before starting a host read', async () => {
  const run = harness();
  run.changeScope('child-b');
  await expect(read(run)).rejects.toThrow('Operation cancelled');
  expect(run.directReads).toHaveLength(0);
});

test('a child change during a direct read refuses the old result', async () => {
  const response = deferred<unknown>();
  const run = harness({ direct: () => response.promise });
  const result = read(run);
  run.changeScope('child-b');
  response.resolve({ id: 'old-asset' });
  await expect(result).rejects.toThrow('Operation cancelled');
  expect(run.choice()).toBeNull();
  expect(run.selectedReads).toHaveLength(0);
});

test('a child change while loading computers never publishes an old picker', async () => {
  const started = deferred<void>();
  const gateways = deferred<unknown>();
  const run = harness({
    gateways: () => {
      started.resolve();
      return gateways.promise;
    },
  });
  const result = read(run);
  await started.promise;
  run.changeScope('child-b');
  gateways.resolve([{ serverId: 'other', label: 'Other' }]);
  await expect(result).rejects.toThrow('Operation cancelled');
  expect(run.choice()).toBeNull();
});

test('a stale native choice callback cannot start the selected computer read', async () => {
  const run = harness();
  const result = read(run);
  const choice = await run.waitChoice('child-a');
  run.changeScope('child-b');
  choice.finish('other');
  await expect(result).rejects.toThrow('Operation cancelled');
  expect(run.selectedReads).toHaveLength(0);
});

test('a child change after selection but before continuation cannot start another read', async () => {
  const run = harness();
  const result = read(run);
  const choice = await run.waitChoice('child-a');
  choice.finish('other');
  run.changeScope('child-b');
  await expect(result).rejects.toThrow('Operation cancelled');
  expect(run.selectedReads).toHaveLength(0);
});

test('a selected read that completes after a child change cannot return its asset', async () => {
  const started = deferred<void>();
  const response = deferred<unknown>();
  const run = harness({
    selected: () => {
      started.resolve();
      return response.promise;
    },
  });
  const result = read(run);
  (await run.waitChoice('child-a')).finish('other');
  await started.promise;
  run.changeScope('child-b');
  response.resolve({ id: 'old-selected-asset' });
  await expect(result).rejects.toThrow('Operation cancelled');
});

test('aborting an old caller prevents ABA scope return from reviving its direct result', async () => {
  const response = deferred<unknown>();
  const controller = new AbortController();
  const run = harness({ direct: () => response.promise });
  const result = read(run, 'child-a', controller.signal);
  run.changeScope('child-b');
  controller.abort();
  run.changeScope('child-a');
  response.resolve({ id: 'old-asset' });
  await expect(result).rejects.toThrow('Operation cancelled');
});

test('old scope cleanup and late callbacks cannot cancel or clear a new child choice', async () => {
  const run = harness();
  const oldOwner = run.factory('child-a');
  const oldResult = oldOwner.resolve(
    'child-a',
    '/fixture/report.txt',
    new AbortController().signal,
    'origin'
  );
  const oldRejected = oldResult.then(
    () => null,
    (error: Error) => error
  );
  const oldChoice = await run.waitChoice('child-a');
  run.changeScope('child-b');
  const newResult = read(run, 'child-b');
  const newChoice = await run.waitChoice('child-b');
  oldOwner.cancel();
  oldChoice.finish('other');
  expect((await oldRejected)?.message).toBe('Operation cancelled');
  expect(run.choice()).toBe(newChoice);
  newChoice.finish('other');
  expect(await newResult).toEqual({ id: 'selected-asset' });
  expect(run.selectedReads).toHaveLength(1);
});

test('an aborted native choice stays cancelled after returning to the same child', async () => {
  const controller = new AbortController();
  const run = harness();
  const result = read(run, 'child-a', controller.signal);
  const choice = await run.waitChoice('child-a');
  run.changeScope('child-b');
  controller.abort();
  run.changeScope('child-a');
  choice.finish('other');
  await expect(result).rejects.toThrow('Operation cancelled');
  expect(run.selectedReads).toHaveLength(0);
});

test('a captured Gateway refusal cannot become a picker fallback or selected read', async () => {
  const run = harness({
    direct: async () => {
      throw new Error('Gateway source changed');
    },
  });
  await expect(read(run)).rejects.toThrow('Gateway source changed');
  expect(run.choice()).toBeNull();
  expect(run.selectedReads).toHaveLength(0);
});

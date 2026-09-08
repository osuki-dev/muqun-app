import { expect, test } from 'bun:test';
import { resolvePanelPick } from '../resolve-panel-pick';

test('waits for a slow first response without overlapping or consuming retries', async () => {
  let finish!: (value: string) => void;
  let calls = 0;
  const pending = resolvePanelPick(
    () => {
      calls++;
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    },
    () => false
  );
  await new Promise((resolve) => setTimeout(resolve, 650));
  expect(calls).toBe(1);
  finish('new-pane');
  expect(await pending).toBe('new-pane');
});

test('retries completed missing reads, with no delay before the first read', async () => {
  const events: string[] = [];
  const result = await resolvePanelPick(
    async () => {
      events.push('read');
      return events.length === 5 ? 'pane' : null;
    },
    () => false,
    async () => {
      events.push('pause');
    }
  );
  expect(result).toBe('pane');
  expect(events).toEqual(['read', 'pause', 'read', 'pause', 'read']);
});

test('does not apply a response after navigation changes', async () => {
  let cancelled = false;
  expect(
    await resolvePanelPick(
      async () => {
        cancelled = true;
        return 'old-pane';
      },
      () => cancelled
    )
  ).toBeNull();
});

test('bounds missing reads and preserves network failures', async () => {
  let calls = 0;
  expect(
    await resolvePanelPick(
      async () => {
        calls++;
        return null;
      },
      () => false,
      async () => {}
    )
  ).toBeNull();
  expect(calls).toBe(3);
  const failure = new Error('offline');
  await expect(
    resolvePanelPick(
      async () => {
        throw failure;
      },
      () => false
    )
  ).rejects.toThrow('offline');
});

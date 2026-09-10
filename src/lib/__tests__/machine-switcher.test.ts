import { describe, expect, test } from 'bun:test';
import { inspectMachine, machineSessionTarget } from '../machine-switcher';

const one = [{ id: 'default', label: 'Development', kind: 'herdr' }];
const two = [...one, { id: 'shell', label: 'Shell', kind: 'tmux' }];

describe('machine and session selection', () => {
  test('one session is a single tap; multiple sessions require a choice', () => {
    expect(machineSessionTarget(one)).toBe('default');
    expect(machineSessionTarget(two)).toBeNull();
    expect(machineSessionTarget(two, 'shell')).toBe('shell');
    expect(machineSessionTarget(one, 'removed')).toBeNull();
    expect(machineSessionTarget([])).toBeNull();
  });
  test('a failed connection leaves the active machine untouched', async () => {
    let switched = false;
    await expect(
      inspectMachine({
        load: async () => {
          throw new Error('offline');
        },
        current: () => true,
        choose: async () => {
          switched = true;
        },
      })
    ).rejects.toThrow('offline');
    expect(switched).toBe(false);
  });
  test('closing during a slow load discards the result', async () => {
    let switched = false;
    expect(
      await inspectMachine({
        load: async () => one,
        current: () => false,
        choose: async () => {
          switched = true;
        },
      })
    ).toBeNull();
    expect(switched).toBe(false);
  });
  test('a successful load selects only a verified session', async () => {
    const selected: string[] = [];
    await inspectMachine({
      load: async () => two,
      requested: 'shell',
      current: () => true,
      choose: async (id) => {
        selected.push(id);
      },
    });
    expect(selected).toEqual(['shell']);
  });
});

import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import { SYSTEM_FONT_SLOT, type FontSlot } from '../user-font-file';

const old: FontSlot = { kind: 'file', file: 'fonts/old.ttf', source: 'old.ttf', label: 'Old' };
const newer: FontSlot = { kind: 'file', file: 'fonts/new.ttf', source: 'new.ttf', label: 'New' };

// Execute the actual async file-ownership boundary without mounting React or native views.
function fixture(initial: FontSlot = old) {
  let current = initial;
  let resets = 0;
  let commit: () => void = () => {};
  const deleted: FontSlot[] = [];
  const pending = Promise.withResolvers<void>();
  const clear = runInNewContext(
    transpile(declaration('src/components/settings-font-sheet.tsx', 'clearSlot') + '\nclearSlot'),
    {
      SLOT_SETTING: { interface: 'interfaceFont' },
      SYSTEM_FONT_SLOT,
      useAppSettings: {
        getState: () => ({
          interfaceFont: current,
          update: (change: { interfaceFont: FontSlot }) => {
            current = change.interfaceFont;
          },
        }),
      },
      feedback: async () => {},
      reskin: {
        run: async ({ apply }: { apply: () => void }) => {
          resets++;
          commit = apply;
          await pending.promise;
        },
      },
      removeUserFontFile: (slot: FontSlot) => deleted.push(slot),
      setSlotError: () => {},
    }
  ) as (id: 'interface') => Promise<void>;
  return {
    clear,
    pending,
    deleted,
    resets: () => resets,
    current: () => current,
    select: (slot: FontSlot) => {
      current = slot;
    },
    commit: () => commit(),
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('reset of the already-selected system font does not start another transition', async () => {
  const f = fixture(SYSTEM_FONT_SLOT);
  await f.clear('interface');
  expect(f.resets()).toBe(0);
  expect(f.deleted).toEqual([]);
});

test('a canceled transition retaining the selected custom font never deletes its file', async () => {
  const f = fixture();
  const run = f.clear('interface');
  await tick();
  expect(f.deleted).toEqual([]);
  f.pending.resolve();
  await run;
  expect(f.deleted).toEqual([]);
  expect(f.current()).toBe(old);
});

test('a failed settings write leaves the selected custom file intact', async () => {
  const f = fixture();
  const run = f.clear('interface');
  await tick();
  f.pending.reject(new Error('write refused'));
  await expect(run).rejects.toThrow('write refused');
  expect(f.deleted).toEqual([]);
  expect(f.current()).toBe(old);
});

test('only a committed reset releases the old file after the transition completes', async () => {
  const f = fixture();
  const run = f.clear('interface');
  await tick();
  f.commit();
  expect(f.deleted).toEqual([]);
  f.pending.resolve();
  await run;
  expect(f.deleted).toEqual([old]);
  expect(f.current()).toBe(SYSTEM_FONT_SLOT);
});

test('a newer font selected during the reset survives the late completion', async () => {
  const f = fixture();
  const run = f.clear('interface');
  await tick();
  f.select(newer);
  f.pending.resolve();
  await run;
  expect(f.deleted).toEqual([old]);
  expect(f.current()).toBe(newer);
});

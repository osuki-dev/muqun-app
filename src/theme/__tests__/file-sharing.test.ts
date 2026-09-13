import { expect, test } from 'bun:test';
import { createThemeFileSharer } from '../file-sharing';

test('same-name exports stay immutable and live until their own share completes', async () => {
  const files = new Map<string, string | Uint8Array>();
  const opened: string[] = [];
  const finish: (() => void)[] = [];
  let sequence = 0;
  const share = createThemeFileSharer({
    available: async () => true,
    create(name, data) {
      const uri = `${++sequence}/${name}`;
      files.set(uri, data);
      return {
        uri,
        dispose: () => {
          files.delete(uri);
        },
      };
    },
    share: (uri) => {
      opened.push(uri);
      return new Promise<void>((resolve) => finish.push(resolve));
    },
  });
  const bytes = new Uint8Array([1, 2]);
  const first = share({ name: 'same', data: bytes, packaged: true });
  const second = share({ name: 'same', data: 'second', packaged: false });
  bytes.fill(9);
  await Promise.resolve();
  await Promise.resolve();
  expect(opened).toEqual(['1/same']);
  expect(files.get('1/same')).toEqual(new Uint8Array([1, 2]));
  finish[0]();
  await first;
  await Promise.resolve();
  await Promise.resolve();
  expect(opened).toEqual(['1/same', '2/same']);
  expect(files.has('1/same')).toBe(false);
  expect(files.get('2/same')).toBe('second');
  finish[1]();
  await second;
  expect(files.size).toBe(0);
});

test('unavailable, write and share failures release the queue and cleanup only owned files', async () => {
  let available = false;
  let writeFails = false;
  let shareFails = false;
  let cleaned = 0;
  const share = createThemeFileSharer({
    available: async () => available,
    create() {
      if (writeFails) throw new Error('write failed');
      return {
        uri: 'owned',
        dispose: () => {
          cleaned++;
        },
      };
    },
    share: async () => {
      if (shareFails) throw new Error('share failed');
    },
  });
  const request = { name: 'a', data: 'data', packaged: false };
  await expect(share(request)).rejects.toThrow('unavailable');
  expect(cleaned).toBe(0);
  available = true;
  writeFails = true;
  await expect(share(request)).rejects.toThrow('write failed');
  expect(cleaned).toBe(0);
  writeFails = false;
  shareFails = true;
  await expect(share(request)).rejects.toThrow('share failed');
  expect(cleaned).toBe(1);
  shareFails = false;
  await share(request);
  expect(cleaned).toBe(2);
});

test('cleanup failure neither masks sharing failure nor poisons later requests', async () => {
  let fail = true;
  const share = createThemeFileSharer({
    available: async () => true,
    create: () => ({
      uri: 'own',
      dispose: () => {
        throw new Error('cleanup');
      },
    }),
    share: async () => {
      if (fail) throw new Error('original share');
    },
  });
  await expect(share({ name: 'a', data: '', packaged: false })).rejects.toThrow('original share');
  fail = false;
  await share({ name: 'b', data: '', packaged: false });
});

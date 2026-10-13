import { describe, expect, test } from 'bun:test';
import { FILE_CONTENT_LIMIT } from '../media-limits';
import { PdfPreviewSession } from '../pdf-preview-session';

function fixture(
  read: (signal: AbortSignal, limit: number) => Promise<Uint8Array> = async () =>
    new Uint8Array([37, 80, 68, 70])
) {
  let exists = false;
  const calls: string[] = [];
  const runtime = {
    uri: 'file:///cache/owned.pdf',
    read: async (signal: AbortSignal, limit: number) => {
      calls.push('read');
      expect(limit).toBe(FILE_CONTENT_LIMIT);
      return read(signal, limit);
    },
    write: (_bytes: Uint8Array) => {
      calls.push('write');
      exists = true;
    },
    remove: () => {
      if (exists) calls.push('delete');
      exists = false;
    },
  };
  return { runtime, calls, exists: () => exists };
}

describe('PDF preview ownership', () => {
  test('keeps a private file until the viewer closes, then cleans up idempotently', async () => {
    const f = fixture();
    const session = new PdfPreviewSession(f.runtime, 4);
    expect(await session.prepare()).toBe('file:///cache/owned.pdf');
    expect(f.exists()).toBe(true);
    session.close();
    session.close();
    expect(f.calls).toEqual(['read', 'write', 'delete']);
  });

  test('rejects an oversized declared file before requesting any bytes', async () => {
    const f = fixture();
    await expect(
      new PdfPreviewSession(f.runtime, FILE_CONTENT_LIMIT + 1).prepare()
    ).rejects.toThrow();
    expect(f.calls).toEqual([]);
  });

  test('bounds an unknown-size response before writing it', async () => {
    const f = fixture(async () => new Uint8Array(FILE_CONTENT_LIMIT + 1));
    await expect(new PdfPreviewSession(f.runtime, 0).prepare()).rejects.toThrow(
      'PDF exceeds the preview limit'
    );
    expect(f.calls).toEqual(['read']);
  });

  test('a late download after back/close cannot recreate the cache file', async () => {
    let finish!: (bytes: Uint8Array) => void;
    let signal!: AbortSignal;
    const f = fixture((nextSignal) => {
      signal = nextSignal;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const session = new PdfPreviewSession(f.runtime, 0);
    const pending = session.prepare();
    session.close();
    expect(signal.aborted).toBe(true);
    finish(new Uint8Array([37, 80, 68, 70]));
    await expect(pending).rejects.toThrow();
    expect(f.calls).toEqual(['read']);
    expect(f.exists()).toBe(false);
  });

  test('a partial cache write is removed when storage fails', async () => {
    const f = fixture();
    const write = f.runtime.write;
    f.runtime.write = (bytes) => {
      write(bytes);
      throw new Error('Storage full');
    };
    await expect(new PdfPreviewSession(f.runtime, 4).prepare()).rejects.toThrow('Storage full');
    expect(f.calls).toEqual(['read', 'write', 'delete']);
    expect(f.exists()).toBe(false);
  });
});

test('cleanup failure preserves the original error and does not escape unmount', async () => {
  const f = fixture(async () => {
    throw new Error('Download failed');
  });
  f.runtime.remove = () => {
    throw new Error('Cache unavailable');
  };
  const session = new PdfPreviewSession(f.runtime, 0);
  await expect(session.prepare()).rejects.toThrow('Download failed');
  expect(() => session.close()).not.toThrow();
});

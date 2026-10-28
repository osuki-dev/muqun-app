import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import {
  AttachmentTooLargeError,
  AttachmentPreparationError,
  type PickedFile,
} from '../attachment-queue';

const original: PickedFile = {
  uri: 'file:///scan.png',
  name: 'scan.png',
  mime: 'image/png',
  size: 30 * 1024 * 1024,
};
const prepared: PickedFile = {
  uri: 'file:///prepared.webp',
  name: 'scan.webp',
  mime: 'image/webp',
};

function preparation(result: PickedFile, actualSize: number, exists = true) {
  const readUris: string[] = [];
  const prepare = runInNewContext(
    transpile(
      `${declaration('src/lib/attachments.ts', 'preparePickedAttachment')}\npreparePickedAttachment`
    ),
    {
      compressPickedImage: async () => result,
      AttachmentTooLargeError,
      AttachmentPreparationError,
      Number,
      File: class {
        exists = exists;
        size = actualSize;
        constructor(uri: string) {
          readUris.push(uri);
        }
      },
    }
  ) as (file: PickedFile, limitBytes: number) => Promise<PickedFile>;
  return { prepare, readUris };
}

test('a large original is admitted using the actual transformed bytes', async () => {
  const h = preparation(prepared, 1024);
  expect(await h.prepare(original, 2048)).toEqual({ ...prepared, size: 1024 });
  expect(h.readUris).toEqual([prepared.uri]);
});

test('codec fallback and oversized transformed bytes are both refused before upload', async () => {
  for (const source of [original, prepared]) {
    const h = preparation(source, 2049);
    const failure: unknown = await h.prepare(original, 2048).then(
      () => null,
      (error: unknown) => error
    );
    expect(failure instanceof AttachmentTooLargeError).toBe(true);
    expect(h.readUris).toEqual([source.uri]);
  }
});

test('missing or unmeasurable prepared files cannot bypass the byte cap', async () => {
  for (const [size, exists] of [
    [0, false],
    [NaN, true],
    [-1, true],
  ] as const) {
    await expect(preparation(prepared, size, exists).prepare(original, 2048)).rejects.toThrow();
  }
  expect(await preparation(prepared, 2048).prepare(original, 2048)).toEqual({
    ...prepared,
    size: 2048,
  });
});

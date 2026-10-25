import { describe, expect, test } from 'bun:test';

import { pickedFilesFromDocuments, safePickedFileName } from '../picked-files';

describe('document picks', () => {
  test('keeps the local URI and metadata the upload queue needs', () => {
    expect(
      pickedFilesFromDocuments([
        {
          uri: 'file:///cache/report.pdf',
          name: 'report.pdf',
          mimeType: 'application/pdf',
          size: 4096,
        },
      ])
    ).toEqual([
      {
        uri: 'file:///cache/report.pdf',
        name: 'report.pdf',
        mime: 'application/pdf',
        size: 4096,
      },
    ]);
  });

  test('uses a useful extension when a provider only reports octet-stream', () => {
    const files = pickedFilesFromDocuments([
      { uri: 'content://provider/42', name: 'notes.md', mimeType: 'application/octet-stream' },
      { uri: 'content://provider/43', name: 'report.docx', mimeType: 'application/octet-stream' },
      { uri: 'content://provider/44', name: 'sheet.xlsx', mimeType: 'application/octet-stream' },
    ]);
    expect(files.map((file) => file.mime)).toEqual([
      'text/markdown',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ]);
  });

  test('media uploads retain declared types and infer video only for unambiguous opaque names', () => {
    expect(
      pickedFilesFromDocuments([
        { uri: 'content://provider/1', name: 'clip.webm' },
        { uri: 'content://provider/2', name: 'clip.mkv', mimeType: 'application/octet-stream' },
        { uri: 'content://provider/3', name: 'clip.future', mimeType: 'video/x-future-container' },
        { uri: 'content://provider/4', name: 'main.ts' },
        { uri: 'content://provider/5', name: 'clip.webm', mimeType: 'text/plain' },
      ]).map((file) => file.mime)
    ).toEqual([
      'video/webm',
      'video/x-matroska',
      'video/x-future-container',
      'application/octet-stream',
      'text/plain',
    ]);
  });

  test('scrubs provider-controlled names before they reach UI or multipart', () => {
    expect(safePickedFileName('../../report\n.pdf')).toBe('report.pdf');
    expect(safePickedFileName('..\\..\\secret.txt')).toBe('secret.txt');
    expect(safePickedFileName('   ')).toBe('file');
    expect(safePickedFileName('.')).toBe('file');
    expect(Array.from(safePickedFileName('界'.repeat(140)))).toHaveLength(120);
  });
});

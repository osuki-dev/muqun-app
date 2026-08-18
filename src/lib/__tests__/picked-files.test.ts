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

  test('scrubs provider-controlled names before they reach UI or multipart', () => {
    expect(safePickedFileName('../../report\n.pdf')).toBe('report.pdf');
    expect(safePickedFileName('..\\..\\secret.txt')).toBe('secret.txt');
    expect(safePickedFileName('   ')).toBe('file');
    expect(safePickedFileName('.')).toBe('file');
    expect(Array.from(safePickedFileName('界'.repeat(140)))).toHaveLength(120);
  });
});

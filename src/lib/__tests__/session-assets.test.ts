import { describe, expect, test } from 'bun:test';

import {
  assertAssetGateway,
  assetFromLocalPdf,
  assetFromUploadedPdf,
  assetFromToolFile,
  isPdfFile,
  assetFromContentHeaders,
  assetKindQuery,
  findAssetById,
  findAssetByPath,
  sessionAssetsFromResponse,
  type SessionAsset,
} from '@/lib/session-assets';

function asset(overrides: Partial<SessionAsset> & { id: string; path: string }): SessionAsset {
  return {
    name: overrides.path.slice(overrides.path.lastIndexOf('/') + 1),
    kind: 'image',
    mime: 'image/png',
    size: 10,
    modified_unix_ms: 1,
    previewable: true,
    ...overrides,
  };
}

function headersFrom(entries: Record<string, string>) {
  const lower = new Map(Object.entries(entries).map(([key, value]) => [key.toLowerCase(), value]));
  return (name: string) => lower.get(name.toLowerCase()) ?? null;
}

describe('sessionAssetsFromResponse', () => {
  test('reads the envelope the gateway sends and orders newest first', () => {
    const assets = sessionAssetsFromResponse({
      capabilities: { assets: true },
      data: {
        assets: [
          { id: 'as_old', path: '/ws/old.png', kind: 'image', modified_unix_ms: 10 },
          { id: 'as_new', path: '/ws/new.png', kind: 'image', modified_unix_ms: 20 },
        ],
      },
    });

    expect(assets.map((entry) => entry.id)).toEqual(['as_new', 'as_old']);
  });

  test('accepts a bare array and a result envelope alike', () => {
    const bare = sessionAssetsFromResponse([{ id: 'as_1', path: '/ws/a.md' }]);
    const wrapped = sessionAssetsFromResponse({
      result: { assets: [{ id: 'as_1', path: '/ws/a.md' }] },
    });

    expect(bare).toEqual(wrapped);
    expect(bare).toHaveLength(1);
  });

  test('drops an entry with nothing to fetch or nothing to name', () => {
    const assets = sessionAssetsFromResponse({
      data: {
        assets: [
          { id: '', path: '/ws/a.png' },
          { id: 'as_2', path: '' },
          { id: 'as_3', path: '/ws/c.png' },
        ],
      },
    });

    expect(assets.map((entry) => entry.id)).toEqual(['as_3']);
  });

  test('fills in what an older gateway leaves out', () => {
    const [entry] = sessionAssetsFromResponse([
      { id: 'as_1', path: '/ws/notes/report.md', kind: 'markdown' },
    ]);

    expect(entry.name).toBe('report.md');
    expect(entry.mime).toBe('application/octet-stream');
    expect(entry.size).toBe(0);
    // No flag on the wire: anything but an opaque binary is worth rendering.
    expect(entry.previewable).toBe(true);
  });

  test('an unknown kind is treated as an opaque binary, not rendered', () => {
    const [entry] = sessionAssetsFromResponse([
      { id: 'as_1', path: '/ws/thing.xyz', kind: 'hologram' },
    ]);

    expect(entry.kind).toBe('binary');
    expect(entry.previewable).toBe(false);
  });
});

describe('findAssetByPath', () => {
  const assets = [
    asset({ id: 'as_1', path: '/Users/me/ws/out/chart.png' }),
    asset({ id: 'as_2', path: '/Users/me/other/chart.png' }),
  ];

  test('prefers the exact path over any tail match', () => {
    expect(findAssetByPath(assets, '/Users/me/other/chart.png')?.id).toBe('as_2');
  });

  test('ignores a trailing slash', () => {
    expect(findAssetByPath(assets, '/Users/me/ws/out/chart.png/')?.id).toBe('as_1');
  });

  test('falls back to a tail match for a path this side cannot expand', () => {
    expect(findAssetByPath(assets, '~/ws/out/chart.png')?.id).toBe('as_1');
  });

  test('answers nothing rather than guessing when no path matches', () => {
    expect(findAssetByPath(assets, '/Users/me/ws/out/missing.png')).toBeNull();
  });
});

describe('findAssetById', () => {
  test('matches on the id and nothing else', () => {
    const assets = [asset({ id: 'as_1', path: '/ws/a.png' })];

    expect(findAssetById(assets, 'as_1')?.path).toBe('/ws/a.png');
    expect(findAssetById(assets, 'as_2')).toBeNull();
  });
});

describe('assetFromContentHeaders', () => {
  test('describes an asset the listing no longer knows', () => {
    const entry = assetFromContentHeaders(
      'as_9',
      headersFrom({
        'content-type': 'image/png',
        'content-length': '2048',
        'content-disposition': 'inline; filename="chart.png"',
        'x-asset-kind': 'image',
      })
    );

    expect(entry).toMatchObject({
      id: 'as_9',
      name: 'chart.png',
      kind: 'image',
      mime: 'image/png',
      size: 2048,
      previewable: true,
    });
    // Nothing on the wire says when it was written, and the viewer reads zero
    // as "unknown" rather than printing a made-up time.
    expect(entry.modified_unix_ms).toBe(0);
  });

  test('falls back to the media type when the gateway names no kind', () => {
    expect(
      assetFromContentHeaders(
        'as_1',
        headersFrom({ 'content-type': 'text/markdown; charset=utf-8' })
      ).kind
    ).toBe('markdown');
    expect(
      assetFromContentHeaders('as_2', headersFrom({ 'content-type': 'application/pdf' })).kind
    ).toBe('pdf');
    expect(
      assetFromContentHeaders('as_3', headersFrom({ 'content-type': 'text/plain; charset=utf-8' }))
        .kind
    ).toBe('text');
    expect(
      assetFromContentHeaders('as_4', headersFrom({ 'content-type': 'application/zip' })).kind
    ).toBe('binary');
  });

  test('a header carrying a path can only ever name a file', () => {
    const entry = assetFromContentHeaders(
      'as_1',
      headersFrom({ 'content-disposition': 'inline; filename="../../etc/passwd"' })
    );

    expect(entry.name).toBe('passwd');
    expect(entry.path).toBe('passwd');
  });

  test('survives a response that says nothing useful', () => {
    const entry = assetFromContentHeaders('as_1', () => null);

    expect(entry).toMatchObject({
      id: 'as_1',
      name: 'as_1',
      kind: 'binary',
      mime: 'application/octet-stream',
      size: 0,
      previewable: false,
    });
  });

  test('honours the caller when the gateway said "no preview"', () => {
    const entry = assetFromContentHeaders(
      'as_1',
      headersFrom({ 'content-type': 'image/png', 'x-asset-kind': 'image' }),
      { previewable: false }
    );

    expect(entry.kind).toBe('image');
    expect(entry.previewable).toBe(false);
  });
});

describe('assetKindQuery', () => {
  test('asks for nothing when the filter is every kind', () => {
    expect(assetKindQuery(undefined)).toBeNull();
    expect(assetKindQuery([])).toBeNull();
  });

  test('spans the kinds a single chip stands for', () => {
    // "Docs" is two kinds, and it is one request rather than two lists merged:
    // the gateway keeps one "newest first" across both.
    expect(assetKindQuery(['markdown', 'pdf'])).toBe('markdown,pdf');
  });

  test('is the same string however the caller ordered or repeated it', () => {
    expect(assetKindQuery(['pdf', 'markdown'])).toBe('markdown,pdf');
    expect(assetKindQuery(['image', 'image'])).toBe('image');
  });

  test('asks for a kind it does not know rather than widening back to everything', () => {
    // The gateway matches nothing for an unknown kind. Dropping it here would
    // leave an empty allow-list, and an empty allow-list is no filter at all --
    // so a narrow question would come back answered with the whole listing.
    expect(assetKindQuery(['nonsense' as never])).toBe('nonsense');
    expect(assetKindQuery(['nonsense' as never, 'image'])).toBe('image,nonsense');
  });
});

describe('PDF entry points', () => {
  test('recognizes missing-MIME output and picker files by extension', () => {
    expect(isPdfFile({ uri: './out/report.PDF' })).toBe(true);
    expect(isPdfFile({ mime: 'application/pdf; charset=binary' })).toBe(true);
    expect(isPdfFile({ name: 'report.pdf.zip' })).toBe(false);
    expect(assetFromToolFile({ uri: '/workspace/report.pdf' })?.kind).toBe('pdf');
  });

  test('only explicit device-picked file/content URIs become local assets', () => {
    const picked = { id: 'picked', name: 'report.pdf', mime: 'application/octet-stream', size: 4 };
    for (const localUri of ['file:///cache/report.pdf', 'content://documents/42']) {
      expect(assetFromLocalPdf({ ...picked, localUri })?.localUri).toBe(localUri);
    }
    for (const localUri of ['/workspace/report.pdf', 'https://host/report.pdf']) {
      expect(assetFromLocalPdf({ ...picked, localUri })).toBeNull();
    }
    const [remote] = sessionAssetsFromResponse([
      {
        id: 'remote',
        path: '/workspace/report.pdf',
        localUri: 'file:///private/report.pdf',
        uploadName: 'secret.pdf',
        gatewayServerId: 'forged',
      },
    ]);
    expect(remote?.localUri).toBeUndefined();
    expect(remote?.uploadName).toBeUndefined();
    expect(remote?.gatewayServerId).toBeUndefined();
  });

  test('resolves uploaded PDFs independently of the workspace without accepting URLs or traversal', () => {
    const upload = assetFromUploadedPdf(
      '/home/test/.local/share/muqun-gateway/uploads/abc-123.pdf',
      'owner'
    );
    expect(upload?.uploadName).toBe('abc-123.pdf');
    expect(upload?.localUri).toBeUndefined();
    expect(upload?.gatewayServerId).toBe('owner');
    for (const path of [
      'https://host/muqun-gateway/uploads/abc.pdf',
      '//host/muqun-gateway/uploads/abc.pdf',
      '/muqun-gateway/uploads/../secret.pdf',
      '/workspace/report.pdf',
    ]) {
      expect(assetFromUploadedPdf(path, 'owner')).toBeNull();
    }
  });

  test('a file listed or resolved on one Gateway cannot download from the next', () => {
    expect(() => assertAssetGateway({ gatewayServerId: 'owner' }, 'owner')).not.toThrow();
    expect(() => assertAssetGateway({ gatewayServerId: 'owner' }, 'other')).toThrow();
    expect(() => assertAssetGateway({ gatewayServerId: 'owner' }, null)).toThrow();
  });
});

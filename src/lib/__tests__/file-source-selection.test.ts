import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import { isHostPathSource } from '../message-images';
import { sessionAssetsFromResponse } from '../session-assets';
import { mcpFileAssets } from '../mcp-file-reference';

class Choice extends Error {
  constructor(readonly path: string) {
    super('choose');
  }
}

function resolver(status: number, selection: boolean, changed = false) {
  let owner = 'osk';
  const calls: string[] = [];
  const resolve = runInNewContext(
    transpile(
      `${declaration('src/lib/gateway-client.ts', 'resolveAgentFileAsset')}\nresolveAgentFileAsset`
    ),
    {
      isHostPathSource,
      sessionAssetsFromResponse,
      FileComputerSelection: Choice,
      configuredGatewayServerId: () => owner,
      assertFileGateway: (expected: string) => {
        if (expected !== owner) throw new Error('changed');
      },
      isDemoActive: () => false,
      assetFromUploadedFile: () => undefined,
      gatewayUrl: (path: string) => path,
      gatewayAuthHeaders: () => ({}),
      gatewayFetch: async (url: string) => {
        calls.push(url);
        if (url === '/health')
          return Response.json({
            capabilities: [
              'agent_file_assets',
              ...(selection ? ['agent_file_source_selection_v1'] : []),
            ],
          });
        if (changed) owner = 'other';
        return Response.json(
          { data: { file_source: { state: 'choose_computer', path: '/Users/me/movie.mp4' } } },
          { status }
        );
      },
    }
  ) as (asid: string, uri: string, signal: AbortSignal, owner: string) => Promise<unknown>;
  return {
    calls,
    run: () => resolve('session', '/Users/me/movie.mp4', new AbortController().signal, 'osk'),
  };
}

test('only a negotiated Gateway decision requests a file source choice', async () => {
  const current = resolver(200, true);
  const result = await current.run().then(
    () => null,
    (error: unknown) => error
  );
  expect(result).toMatchObject({ path: '/Users/me/movie.mp4' });
  expect(current.calls[1]).toContain('/file-source?');
  const legacy = resolver(200, false);
  await expect(legacy.run()).rejects.toThrow('File output unavailable');
  expect(legacy.calls[1]).toContain('/file-asset?');
});

test('authorization failures and ownership changes never become a source choice', async () => {
  for (const status of [401, 403, 404, 500]) {
    await expect(resolver(status, true).run()).rejects.toThrow(`HTTP ${status}`);
  }
  await expect(resolver(200, true, true).run()).rejects.toThrow('changed');
});

test('a chosen computer uses the existing paired-file reader without forwarding credentials', async () => {
  const calls: unknown[] = [];
  const resolve = runInNewContext(
    transpile(
      `${declaration('src/lib/gateway-client.ts', 'resolveComputerFile')}\nresolveComputerFile`
    ),
    {
      mcpFileAssets,
      resolveMcpFileAsset: async (asset: unknown) => {
        calls.push(asset);
        return asset;
      },
    }
  ) as (path: string, serverId: string, signal: AbortSignal) => Promise<unknown>;
  const signal = new AbortController().signal;
  await resolve('/Users/me/document.unknown', 'mini', signal);
  expect(calls[0]).toMatchObject({
    mcpFile: { serverId: 'mini', path: '/Users/me/document.unknown' },
  });
  await expect(resolve('//evil/secret', 'mini', signal)).rejects.toThrow('Invalid file reference');
  await expect(resolve('/tmp/file', 'https://evil', signal)).rejects.toThrow(
    'Invalid file reference'
  );
  expect(calls).toHaveLength(1);
});

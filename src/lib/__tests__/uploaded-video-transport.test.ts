import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { declaration, transpile } from '../../test-support/production-source';
import {
  assetFromUploadedFile,
  assertAssetGateway,
  sessionAssetsFromResponse,
  type SessionAsset,
} from '../session-assets';
import { isHostPathSource } from '../message-images';

const uri = '/state/muqun-gateway/uploads/11111111-2222-4333-8444-555555555555.mp4';

/** Execute the actual resolver/read path while isolating the native file-system imports. */
function harness(
  encrypted: boolean,
  metadata?: { status?: number; asset?: Partial<SessionAsset>; changedGateway?: boolean }
) {
  let serverId = 'owner';
  const metadataCalls: { uri: string; headers: Record<string, string> }[] = [];
  const calls: { uri: string; headers: Record<string, string>; encrypted: boolean }[] = [];
  const bytes = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]);
  const read = async (url: string, init: { headers: Record<string, string> }, sealed: boolean) => {
    calls.push({ uri: url, headers: init.headers, encrypted: sealed });
    return new Response(bytes);
  };
  const source = [
    'assertFileGateway',
    'resolveAgentFileAsset',
    'readAssetBytes',
    'uploadContentUrl',
  ]
    .map((name) => declaration('src/lib/gateway-client.ts', name))
    .join('\n');
  const api = runInNewContext(transpile(`${source}\n({resolveAgentFileAsset, readAssetBytes})`), {
    isHostPathSource,
    sessionAssetsFromResponse,
    AudioPlaybackError: Error,
    gatewayFetch: async (url: string, init: { headers: Record<string, string> }) => {
      metadataCalls.push({ uri: url, headers: init.headers });
      if (url.endsWith('/health')) return Response.json({ capabilities: ['agent_file_assets'] });
      if (metadata?.changedGateway) serverId = 'other';
      return Response.json(
        { data: { asset: metadata?.asset } },
        { status: metadata?.status ?? 200 }
      );
    },
    assetFromUploadedFile,
    assertAssetGateway,
    configuredGatewayServerId: () => serverId,
    isDemoActive: () => false,
    gatewayUrl: (path: string) => `https://gateway.invalid${path}`,
    gatewayAuthHeaders: () => ({ Authorization: 'Bearer fixture-device-token' }),
    currentTransport: encrypted ? 'sealed' : 'plain',
    GATEWAY_TRANSPORT: 'sealed',
    encryptedGatewayFetch: (url: string, init: { headers: Record<string, string> }) =>
      read(url, init, true),
    fetchWithin: (
      _timeout: number,
      _message: string,
      url: string,
      init: { headers: Record<string, string> }
    ) => read(url, init, false),
    assetTextTimeoutMs: () => 1000,
    Uint8Array,
    Number,
    encodeURIComponent,
  }) as {
    resolveAgentFileAsset: (
      asid: string,
      uri: string,
      signal: AbortSignal,
      serverId: string
    ) => Promise<SessionAsset>;
    readAssetBytes: (asset: SessionAsset, options: { maxBytes: number }) => Promise<Uint8Array>;
  };
  return {
    api,
    calls,
    metadataCalls,
    bytes,
    selectOtherGateway: () => {
      serverId = 'other';
    },
  };
}

test('uploaded videos resolve outside the workspace and read only the authenticated upload route on either transport', async () => {
  for (const encrypted of [false, true]) {
    const { api, calls, bytes } = harness(encrypted);
    const asset = await api.resolveAgentFileAsset(
      'isolated-session',
      uri,
      new AbortController().signal,
      'owner'
    );
    expect(asset.kind).toBe('video');
    expect(calls).toEqual([]); // Mounting/resolution cannot download or autoplay.
    expect(await api.readAssetBytes(asset, { maxBytes: 32 })).toEqual(bytes);
    expect(calls).toEqual([
      {
        uri: 'https://gateway.invalid/api/uploads/11111111-2222-4333-8444-555555555555.mp4',
        headers: { Authorization: 'Bearer fixture-device-token' },
        encrypted,
      },
    ]);
  }
});

test('a captured video source cannot resolve or read bytes after the selected Gateway changes', async () => {
  const { api, calls, selectOtherGateway } = harness(true);
  const asset = await api.resolveAgentFileAsset(
    'isolated-session',
    uri,
    new AbortController().signal,
    'owner'
  );
  selectOtherGateway();
  await expect(
    api.resolveAgentFileAsset('isolated-session', uri, new AbortController().signal, 'owner')
  ).rejects.toThrow('different Gateway');
  await expect(api.readAssetBytes(asset, { maxBytes: 32 })).rejects.toThrow('different Gateway');
  expect(calls).toEqual([]);
});

test('an explicit open can classify an ambiguous upload using authenticated metadata without changing its byte route', async () => {
  for (const encrypted of [false, true]) {
    const unknown = uri.replace(/mp4$/, 'ts');
    const { api, calls, metadataCalls } = harness(encrypted, {
      asset: {
        id: 'sniffed',
        path: unknown,
        name: 'clip.ts',
        kind: 'video',
        mime: 'video/mp2t',
        previewable: true,
      },
    });
    const asset = await api.resolveAgentFileAsset(
      'isolated-session',
      unknown,
      new AbortController().signal,
      'owner'
    );
    expect(asset).toMatchObject({
      kind: 'video',
      mime: 'video/mp2t',
      gatewayServerId: 'owner',
      uploadName: '11111111-2222-4333-8444-555555555555.ts',
    });
    expect(calls).toEqual([]);
    expect(metadataCalls.map((call) => call.uri)).toEqual([
      'https://gateway.invalid/health',
      `https://gateway.invalid/api/agent-sessions/isolated-session/file-asset?uri=${encodeURIComponent(unknown)}`,
    ]);
    expect(
      metadataCalls.every((call) => call.headers.Authorization === 'Bearer fixture-device-token')
    ).toBe(true);
    await api.readAssetBytes(asset, { maxBytes: 32 });
    expect(calls[0].uri).toBe(
      'https://gateway.invalid/api/uploads/11111111-2222-4333-8444-555555555555.ts'
    );
    expect(calls[0].encrypted).toBe(encrypted);
  }
});

test('unavailable upload metadata preserves generic download while cancellation and Gateway switches still fail', async () => {
  const unknown = uri.replace(/mp4$/, 'bin');
  for (const status of [403, 404, 500]) {
    const { api, calls } = harness(true, { status });
    const asset = await api.resolveAgentFileAsset(
      'isolated-session',
      unknown,
      new AbortController().signal,
      'owner'
    );
    expect(asset).toMatchObject({
      kind: 'binary',
      previewable: false,
      uploadName: '11111111-2222-4333-8444-555555555555.bin',
    });
    expect(calls).toEqual([]);
    await api.readAssetBytes(asset, { maxBytes: 32 });
    expect(calls[0].uri.endsWith('.bin')).toBe(true);
  }
  const switched = harness(true, { status: 404, changedGateway: true });
  await expect(
    switched.api.resolveAgentFileAsset(
      'isolated-session',
      unknown,
      new AbortController().signal,
      'owner'
    )
  ).rejects.toThrow('different Gateway');
  expect(switched.calls).toEqual([]);
  const cancelled = harness(true, { status: 404 });
  const controller = new AbortController();
  controller.abort();
  await expect(
    cancelled.api.resolveAgentFileAsset('isolated-session', unknown, controller.signal, 'owner')
  ).rejects.toThrow('HTTP 404');
  expect(cancelled.calls).toEqual([]);
});

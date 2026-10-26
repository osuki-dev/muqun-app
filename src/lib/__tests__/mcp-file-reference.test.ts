import { expect, test } from 'bun:test';
import { mcpFileAssets } from '../mcp-file-reference';
import { muqunToolPresentation } from '../muqun-tool-presentation';
import type { ToolPart } from '../agent-protocol';

const file = {
  upload_name: '11111111-2222-4333-8444-555555555555.jpg',
  name: 'Screenshot.jpg',
  mime: 'image/jpeg',
  size: 1234,
  expires_at_ms: 1900000000000,
};
const result = { state: 'done', server_id: 'mini-unique-id', machine: 'mini', files: [file] };

test('file references retain the source identity and discard caller-controlled URLs and credentials', () => {
  const [asset] = mcpFileAssets({
    ...result,
    files: [
      {
        ...file,
        url: 'https://evil.example',
        token: 'secret',
        localUri: 'file:///private/key',
        gatewayServerId: 'osk',
      },
    ],
  });
  expect(asset.mcpFile?.serverId).toBe('mini-unique-id');
  expect(asset.kind).toBe('image');
  expect(asset.gatewayServerId).toBeUndefined();
  expect(asset.localUri).toBeUndefined();
  expect(JSON.stringify(asset)).not.toContain('evil');
  expect(JSON.stringify(asset)).not.toContain('secret');
});

test('malformed and unbounded file references cannot become reads', () => {
  for (const patch of [
    { upload_name: '../key.jpg' },
    { upload_name: 'https://example.com/a' },
    { upload_name: 'a%2fb.jpg' },
    { size: -1 },
    { size: 26 * 1024 * 1024 },
    { expires_at_ms: 'tomorrow' },
    { name: '\u0000bad' },
  ]) {
    expect(mcpFileAssets({ ...result, files: [{ ...file, ...patch }] })).toEqual([]);
  }
  expect(mcpFileAssets({ ...result, server_id: '../osk' })).toEqual([]);
  expect(mcpFileAssets({ ...result, server_id: undefined })).toEqual([]);
});

test('only a completed explicit file handoff creates file cards', () => {
  const tool: ToolPart = {
    type: 'tool',
    id: 'export',
    name: 'mcp__muqun__files_present',
    input: {},
    output: { content: [{ type: 'text', text: JSON.stringify(result) }] },
    content: [],
    metadata: {},
    state: 'completed',
  };
  expect(muqunToolPresentation(tool)?.files).toHaveLength(1);
  expect(muqunToolPresentation({ ...tool, state: 'running' })?.files).toEqual([]);
  expect(muqunToolPresentation({ ...tool, state: 'failed' })?.files).toEqual([]);
  expect(muqunToolPresentation({ ...tool, name: 'mcp__muqun__exec_run' })?.files).toEqual([]);
});

test('reading a file holds its source pairing across an asynchronous tunnel open', async () => {
  const { runInNewContext } = await import('node:vm');
  const { declaration, transpile } = await import('../../test-support/production-source');
  const { gatewayUploadName } = await import('../uploaded-attachments');
  const source = {
    serverId: 'mini-unique-id',
    url: 'https://mini.invalid',
    token: 'mini-token',
    transport: 'encrypted',
    sshTunnel: { host: 'mini' },
  };
  const calls: unknown[][] = [];
  const read = runInNewContext(
    transpile(`${declaration('src/lib/gateway-client.ts', 'readMcpFileBytes')}\nreadMcpFileBytes`),
    {
      loadGateways: async () => [source],
      gatewayUploadName,
      GATEWAY_TRANSPORT: 'encrypted',
      assetTextTimeoutMs: () => 100,
      withRecordBaseUrl: async (held: typeof source, run: (url: string) => Promise<unknown>) => {
        source.token = 'replacement-token';
        expect(held.token).toBe('mini-token');
        return run('http://127.0.0.1:9999');
      },
      encryptedGatewayFetch: async (...args: unknown[]) => {
        calls.push(args);
        return { ok: true, headers: new Headers({ 'content-type': 'image/jpeg' }) };
      },
      readLimitedImageBody: async () => new Uint8Array([1, 2]),
    }
  );
  const [asset] = mcpFileAssets(result);
  expect(await read(asset, { maxBytes: 2000 })).toEqual(new Uint8Array([1, 2]));
  expect(calls[0][0]).toBe(`http://127.0.0.1:9999/api/uploads/${file.upload_name}`);
  expect(calls[0][1]).toMatchObject({ headers: { Authorization: 'Bearer mini-token' } });
  expect(calls[0][3]).toMatchObject({ serverId: 'mini-unique-id', token: 'mini-token' });
});

test('expired and unpaired file references never open a transport', async () => {
  const { runInNewContext } = await import('node:vm');
  const { declaration, transpile } = await import('../../test-support/production-source');
  let opened = false;
  const read = runInNewContext(
    transpile(`${declaration('src/lib/gateway-client.ts', 'readMcpFileBytes')}\nreadMcpFileBytes`),
    {
      loadGateways: async () => [],
      withRecordBaseUrl: () => {
        opened = true;
      },
    }
  );
  const [asset] = mcpFileAssets(result);
  await expect(read(asset, { maxBytes: 2000 })).rejects.toThrow('Pair this computer');
  await expect(
    read({ ...asset, mcpFile: { ...asset.mcpFile, expiresAt: 1 } }, { maxBytes: 2000 })
  ).rejects.toThrow('expired');
  expect(opened).toBe(false);
});

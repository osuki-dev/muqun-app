import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertDeliveryCurrent } from '../bound-delivery';
import {
  loadWorkArtifactPreview,
  MAX_WORK_ARTIFACT_BYTES,
  readBoundedArtifactBody,
  workArtifactPath,
  type WorkArtifactTransport,
} from '../work-artifacts';
import type { GatewayRecord } from '../gateway-storage';

const record: GatewayRecord = {
  serverId: 'saved',
  label: 'Saved',
  url: 'https://saved.invalid',
  token: 'saved-token',
  pairedAt: 1,
};
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const text = new TextEncoder().encode('<script>alert("never execute")</script>');
const artifact = { path: '/repo/result.html', size_bytes: text.length, sha256: sha256(text) };
const context = { isCurrent: () => true };

test('immutable artifact scope encodes identifiers and never sends a filesystem path', async () => {
  const calls: unknown[][] = [];
  const preview = await loadWorkArtifactPreview(
    record,
    'session/a',
    'task?#',
    'saved-result',
    2,
    artifact,
    context,
    {
      transport: async (...args) => {
        calls.push(args);
        return text;
      },
      sha256,
      base64,
    }
  );
  expect(calls[0]?.[1]).toBe(
    '/api/sessions/session%2Fa/work/tasks/task%3F%23/results/saved-result/artifacts/2'
  );
  expect(calls[0]?.[0]).toEqual(record);
  expect(calls[0]?.[0]).not.toBe(record);
  expect(preview).toEqual({ kind: 'text', text: new TextDecoder().decode(text) });
  expect(() => workArtifactPath('s', 't', 'r', -1)).toThrow();
  expect(() => workArtifactPath('s', 't', 'r', 32)).toThrow();
});

test('size and digest mismatch prevent preview', async () => {
  for (const returned of [text.slice(1), new Uint8Array(text.length)]) {
    await expect(
      loadWorkArtifactPreview(record, 's', 't', 'r', 0, artifact, context, {
        transport: async () => returned,
        sha256,
        base64,
      })
    ).rejects.toThrow('does not match');
  }
});

test('verified raster bytes become a local data URI with submission-specific cache identity', async () => {
  const bytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVioAAAAASUVORK5CYII=',
    'base64'
  );
  const image = { path: '/repo/result.png', size_bytes: bytes.length, sha256: sha256(bytes) };
  const preview = await loadWorkArtifactPreview(
    record,
    's',
    't',
    'saved-result',
    0,
    image,
    context,
    {
      transport: async () => bytes,
      sha256,
      base64,
    }
  );
  expect(preview).toEqual({
    kind: 'image',
    uri: `data:image/png;base64,${base64(bytes)}`,
    cacheKey: `saved:/api/sessions/s/work/tasks/t/results/saved-result/artifacts/0:${image.sha256}`,
  });
});

test('ownership loss discards bytes and saved metadata cannot drift during a read', async () => {
  let current = true;
  await expect(
    loadWorkArtifactPreview(
      record,
      's',
      't',
      'r',
      0,
      artifact,
      { isCurrent: () => current },
      {
        transport: async () => {
          current = false;
          return text;
        },
        sha256,
        base64,
      }
    )
  ).rejects.toThrow();
  const changed = { ...artifact };
  const preview = await loadWorkArtifactPreview(record, 's', 't', 'r', 0, changed, context, {
    transport: async () => {
      changed.sha256 = '0'.repeat(64);
      changed.path = 'attack.png';
      return text;
    },
    sha256,
    base64,
  });
  expect(preview.kind).toBe('text');
});

test('unsupported types and oversized previews never fetch, and image names cannot enable markup', async () => {
  let calls = 0;
  const dependencies = {
    transport: async () => {
      calls++;
      return text;
    },
    sha256,
    base64,
  };
  expect(
    await loadWorkArtifactPreview(
      record,
      's',
      't',
      'r',
      0,
      { ...artifact, path: 'program.exe' },
      context,
      dependencies
    )
  ).toEqual({ kind: 'unsupported' });
  expect(
    await loadWorkArtifactPreview(
      record,
      's',
      't',
      'r',
      0,
      { ...artifact, size_bytes: 3 * 1024 * 1024 },
      context,
      dependencies
    )
  ).toEqual({ kind: 'unsupported' });
  expect(calls).toBe(0);
  await expect(
    loadWorkArtifactPreview(
      record,
      's',
      't',
      'r',
      0,
      { ...artifact, path: 'fake.png' },
      context,
      dependencies
    )
  ).rejects.toThrow('not a supported image');
});

test('bounded binary reader supports artifacts above the task JSON limit and stops oversized streams', async () => {
  const bytes = new Uint8Array(17 * 1024 * 1024);
  bytes[0] = 255;
  expect(
    (await readBoundedArtifactBody(new Response(bytes), MAX_WORK_ARTIFACT_BYTES, () => true)).length
  ).toBe(bytes.length);
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(5));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(readBoundedArtifactBody(new Response(stream), 4, () => true)).rejects.toThrow(
    'supported size'
  );
  expect(cancelled).toBe(true);
  await expect(
    readBoundedArtifactBody(
      new Response('x', { headers: { 'content-length': '51' } }),
      50,
      () => true
    )
  ).rejects.toThrow();
});

test('production binary transport uses captured encryption/tunnel credentials and never the JSON request adapter', async () => {
  const source = ts.createSourceFile(
    'gateway-client.ts',
    readFileSync('src/lib/gateway-client.ts', 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const statement = source.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) => declaration.name.getText(source) === 'readBoundWorkArtifactBytes'
      )
  );
  if (!statement) throw new Error('Missing binary transport');
  const compiled = ts.transpileModule(
    statement.getText(source).replace(/^export /, '') +
      '\nglobalThis.reader=readBoundWorkArtifactBytes;',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
  ).outputText;
  const calls: unknown[][] = [];
  const bytes = new Uint8Array(17 * 1024 * 1024);
  const sandbox = {
    isDemoRecord: () => false,
    assertDeliveryCurrent,
    MAX_WORK_ARTIFACT_BYTES,
    readBoundedArtifactBody,
    GATEWAY_TRANSPORT: 'muqun-aes-256-gcm-v1',
    activeLocaleHeaders: () => ({}),
    withRecordBaseUrl: async (captured: GatewayRecord, run: (url: string) => Promise<unknown>) => {
      expect(captured.serverId).toBe('saved');
      return run('http://captured-tunnel');
    },
    encryptedGatewayFetch: async (...args: unknown[]) => {
      calls.push(args);
      return new Response(bytes);
    },
    fetchWithin: () => {
      throw new Error('Unexpected plaintext fallback');
    },
    reader: undefined as WorkArtifactTransport | undefined,
  };
  runInNewContext(compiled, sandbox);
  if (!sandbox.reader) throw new Error('Missing initialized transport');
  const path = workArtifactPath('s', 't', 'r', 0);
  const result = await sandbox.reader(
    { ...record, transport: 'muqun-aes-256-gcm-v1' },
    path,
    bytes.length,
    context
  );
  expect(result.length).toBe(bytes.length);
  expect(calls[0]?.[0]).toBe('http://captured-tunnel' + path);
  expect(calls[0]?.[3]).toMatchObject({
    serverId: 'saved',
    token: 'saved-token',
    url: 'http://captured-tunnel',
  });
  expect(calls[0]?.[5]).toBe(bytes.length);
  await expect(sandbox.reader(record, path, 1, { isCurrent: () => false })).rejects.toThrow();
  expect(calls).toHaveLength(1);
});

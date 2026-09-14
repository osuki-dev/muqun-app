import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { assertDeliveryCurrent } from '../bound-delivery';
import { MAX_UPLOAD_BYTES, annotateEntry } from '../attachment-queue';
import { readBoundedArtifactBody } from '../work-artifacts';
import {
  TaskInputOwnership,
  TaskInputProjectResolutionError,
  TaskInputUploadJournal,
  captureTaskInputEntries,
  sameTaskInputVersion,
  parseTaskInputReceipt,
  taskInputPath,
  taskInputScopeKey,
  taskInputReceiptPath,
  taskInputRefs,
  type TaskInputUpload,
  type TaskInputReceipt,
} from '../task-inputs';
import type { GatewayRecord } from '../gateway-storage';
const scope = { sessionId: 's', project: '/project', draftId: 'draft' };
const receipt = {
  input_id: '00000000-0000-4000-8000-000000000001',
  session_id: 's',
  repo_path: '/project',
  name: 'reference.png',
  mime: 'image/png',
  size_bytes: 20,
  sha256: 'a'.repeat(64),
  created_at_ms: 1,
  expires_at_ms: 172800001,
};

test('input receipts reject foreign scope, malformed content identity, oversize and expiry', () => {
  expect(parseTaskInputReceipt(receipt, scope)).toEqual(receipt);
  for (const patch of [
    { repo_path: '/other' },
    { session_id: 'other' },
    { size_bytes: MAX_UPLOAD_BYTES + 1 },
    { sha256: '../path' },
    { input_id: '/path' },
    { expires_at_ms: 0 },
  ])
    expect(() => parseTaskInputReceipt({ ...receipt, ...patch }, scope)).toThrow();
  expect(() => taskInputRefs([receipt], scope, receipt.expires_at_ms)).toThrow();
  expect(() => taskInputRefs([receipt, receipt], scope, 2)).toThrow();
  expect(taskInputRefs([receipt], scope, 2)).toEqual([
    { input_id: receipt.input_id, caption: '', use: 'reference-only' },
  ]);
});

test('input receipt paths encode scope and keys without a caller file path', () => {
  expect(taskInputPath('s/other')).toBe('/api/sessions/s%2Fother/work/inputs');
  expect(taskInputReceiptPath('s', 'key?x=1').endsWith('request_key=key%3Fx%3D1')).toBe(true);
  expect(() => taskInputReceiptPath('s', 'x'.repeat(129))).toThrow();
});

test('task scope loss stays invalid after returning to the same destination', () => {
  const owner = new TaskInputOwnership();
  owner.update(scope);
  const ticket = owner.capture(scope);
  owner.update({ ...scope, project: '/other' });
  owner.update(scope);
  expect(ticket()).toBe(false);
  const next = owner.capture(scope);
  expect(next()).toBe(true);
  owner.update({ ...scope, attemptId: '00000000-0000-4000-8000-000000000002' });
  expect(next()).toBe(false);
});

test('production input transport binds multipart and encrypted credentials before one upload', async () => {
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
        (d) => d.name.getText(source) === 'uploadBoundTaskInput'
      )
  );
  if (!statement) throw new Error('Missing input transport');
  const code = ts.transpileModule(
    statement.getText(source).replace(/^export /, '') +
      '\nglobalThis.upload = uploadBoundTaskInput;',
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }
  ).outputText;
  const calls: unknown[][] = [];
  const parts: unknown[][] = [];
  const sandbox = {
    taskInputPath,
    taskInputScopeKey,
    taskInputReceiptPath,
    parseTaskInputReceipt,
    assertDeliveryCurrent,
    MAX_INPUT_UPLOAD_BYTES: MAX_UPLOAD_BYTES,
    TextDecoder,
    JSON,
    readBoundedArtifactBody,
    UPLOAD_TIMEOUT_MS: 2000,
    GATEWAY_TRANSPORT: 'muqun-aes-256-gcm-v1',
    isDemoRecord: () => false,
    activeLocaleHeaders: () => ({}),
    localFilePath: (uri: string) => uri,
    FormData: class {
      append(...args: unknown[]) {
        parts.push(args);
      }
    },
    withRecordBaseUrl: async (captured: GatewayRecord, run: (url: string) => Promise<unknown>) => {
      expect(captured.token).toBe('saved-token');
      return run('http://saved-tunnel');
    },
    encryptedGatewayFetch: async (...args: unknown[]) => {
      calls.push(args);
      return new Response(JSON.stringify(receipt));
    },
    fetchWithin: () => {
      throw new Error('Unexpected plaintext request');
    },
    upload: undefined as TaskInputUpload | undefined,
  };
  runInNewContext(code, sandbox);
  const record = {
    serverId: 'saved',
    token: 'saved-token',
    transport: 'muqun-aes-256-gcm-v1',
  } as GatewayRecord;
  const file = { uri: 'file:///reference.png', name: 'reference.png', mime: 'image/png', size: 20 };
  const upload = sandbox.upload!;
  expect(await upload(record, scope, 'key', file, { isCurrent: () => true })).toEqual(receipt);
  expect(parts.map((part) => part[0])).toEqual(['request_key', 'repo_path', 'file']);
  expect(calls[0]?.[0]).toBe('http://saved-tunnel/api/sessions/s/work/inputs');
  expect(calls[0]?.[3]).toMatchObject({ serverId: 'saved', token: 'saved-token' });
  await expect(upload(record, scope, 'key', file, { isCurrent: () => false })).rejects.toThrow();
  await expect(
    upload(record, scope, 'key', { ...file, size: MAX_UPLOAD_BYTES + 1 }, { isCurrent: () => true })
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
});

test('canonical project resolution is explicit and never mutates captured ownership', () => {
  const alias = { ...scope, project: '/alias' };
  try {
    parseTaskInputReceipt(receipt, alias);
    throw new Error('Expected resolution');
  } catch (error) {
    expect(error instanceof TaskInputProjectResolutionError).toBe(true);
    expect((error as TaskInputProjectResolutionError).receipt.repo_path).toBe('/project');
    expect(alias.project).toBe('/alias');
  }
});

test('commit snapshots retain original annotations and protect later edits from clearing', () => {
  const entry = {
    id: 'file',
    localUri: 'file:///a',
    name: 'a',
    mime: 'text/plain',
    status: 'pending' as const,
    caption: 'first',
  };
  const [snapshot] = captureTaskInputEntries([entry]);
  const edited = annotateEntry([entry], entry.id, { caption: 'later' })[0];
  expect(snapshot.caption).toBe('first');
  expect(sameTaskInputVersion(snapshot, edited)).toBe(false);
  const reverted = annotateEntry([edited], entry.id, { caption: 'first' })[0];
  expect(sameTaskInputVersion(snapshot, reverted)).toBe(false);
  expect(sameTaskInputVersion(snapshot, { ...entry, status: 'done' })).toBe(true);
});

const uploadRecord = { serverId: 'saved', token: 'token' } as GatewayRecord;
const inputFile = {
  uri: 'file:///reference.png',
  name: 'reference.png',
  mime: 'image/png',
  size: 20,
};
const inputContext = { isCurrent: () => true };

test('uncertain upload retry reads its receipt and never repeats a confirmed POST', async () => {
  const calls: string[] = [];
  const journal = new TaskInputUploadJournal(
    () => 'key',
    async () => {
      calls.push('POST');
      throw new Error('ACK lost');
    },
    async (_r, _s, key) => {
      calls.push('GET:' + key);
      return receipt;
    },
    () => 2
  );
  await expect(journal.run('file', uploadRecord, scope, inputFile, inputContext)).rejects.toThrow();
  expect(await journal.run('file', uploadRecord, scope, inputFile, inputContext)).toEqual(receipt);
  expect(calls).toEqual(['POST', 'GET:key']);
});

test('failed receipt lookup prevents retry POST and invalidation during lookup prevents dispatch', async () => {
  let posts = 0;
  let current = true;
  const journal = new TaskInputUploadJournal(
    () => 'key',
    async () => {
      posts++;
      throw new Error('lost');
    },
    async () => {
      throw new Error('offline');
    }
  );
  await expect(journal.run('file', uploadRecord, scope, inputFile, inputContext)).rejects.toThrow();
  await expect(journal.run('file', uploadRecord, scope, inputFile, inputContext)).rejects.toThrow(
    'offline'
  );
  expect(posts).toBe(1);
  const changed = new TaskInputUploadJournal(
    () => 'key',
    async () => {
      posts++;
      throw new Error('lost');
    },
    async () => {
      current = false;
      return null;
    }
  );
  const context = { isCurrent: () => current };
  await expect(changed.run('file', uploadRecord, scope, inputFile, context)).rejects.toThrow();
  await expect(changed.run('file', uploadRecord, scope, inputFile, context)).rejects.toThrow(
    'destination'
  );
  expect(posts).toBe(2);
});

test('known expired input needs explicit renewal before a fresh upload key exists', async () => {
  const keys: string[] = [];
  let next = 0;
  const journal = new TaskInputUploadJournal(
    () => `key-${++next}`,
    async (_r, _s, key) => {
      keys.push(key);
      return keys.length === 1
        ? receipt
        : { ...receipt, expires_at_ms: receipt.expires_at_ms + 100 };
    },
    async () => receipt,
    () => receipt.expires_at_ms
  );
  await expect(journal.run('file', uploadRecord, scope, inputFile, inputContext)).rejects.toThrow(
    'expired'
  );
  await expect(journal.run('file', uploadRecord, scope, inputFile, inputContext)).rejects.toThrow(
    'expired'
  );
  expect(keys).toEqual(['key-1']);
  expect(journal.renewExpired('unknown')).toBe(false);
  expect(journal.renewExpired('file')).toBe(true);
  await journal.run('file', uploadRecord, scope, inputFile, inputContext);
  expect(keys).toEqual(['key-1', 'key-2']);
});

test('receipt recovery finishing after scope clear cannot retain receipt or canonical resolution', async () => {
  for (const canonical of [false, true]) {
    let finish: ((receipt: TaskInputReceipt) => void) | undefined;
    let reject: ((error: Error) => void) | undefined;
    const journal = new TaskInputUploadJournal(
      () => 'key',
      async () => {
        throw new Error('lost');
      },
      () =>
        new Promise((resolve, fail) => {
          finish = resolve;
          reject = fail;
        }),
      () => 2
    );
    await expect(
      journal.run('file', uploadRecord, scope, inputFile, inputContext)
    ).rejects.toThrow();
    const recovering = journal.run('file', uploadRecord, scope, inputFile, inputContext);
    journal.clear();
    if (canonical) reject?.(new TaskInputProjectResolutionError('/alias', receipt));
    else finish?.(receipt);
    await expect(recovering).rejects.toThrow();
    expect(journal.receipt('file')).toBeUndefined();
  }
});

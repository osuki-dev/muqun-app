import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import {
  assertDeliveryCurrent,
  DeliveryOwnership,
  DeliverySelection,
  deliverPasteAndEnter,
} from '../bound-delivery';
import { recallWorkspaceSelection, rememberWorkspaceSelection } from '../workspace-cycle';
import { recallTabPane, rememberTabPane } from '../tab-swipe';
import type { GatewayRecord } from '../gateway-storage';
import * as queue from '../attachment-queue';
import type { AttachmentUploads } from '../../hooks/use-attachment-uploads';

function declaration(path: string, name: string) {
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const node = source.statements.find(
    (item) => ts.isFunctionDeclaration(item) && item.name?.text === name
  );
  if (!node) throw new Error(`Missing production function ${name}`);
  return node.getText(source).replace(/^export /, '');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const a: GatewayRecord = {
  serverId: 'a',
  label: 'A',
  url: 'https://a.invalid',
  token: 'token-a',
  pairedAt: 1,
};
const b: GatewayRecord = { ...a, serverId: 'b', url: 'https://b.invalid', token: 'token-b' };
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

function client() {
  const calls: { url: string; token: string; endpoint?: GatewayRecord }[] = [];
  const ack = deferred<void>();
  let waitForAck = false;
  let releases = 0;
  let releaseFailure = false;
  let waitForTunnel = false;
  const tunnel = deferred<void>();
  const source = ['withRecordBaseUrl', 'localFilePath', 'uploadAttachment', 'sendBoundPaneText']
    .map((name) => declaration('src/lib/gateway-client.ts', name))
    .join('\n');
  const response = {
    ok: true,
    status: 200,
    text: async () => {
      if (waitForAck) await ack.promise;
      return '{}';
    },
    json: async () => ({ path: '/gateway-a/uploads/image.webp' }),
  };
  const globals = {
    assertDeliveryCurrent,
    deliverPasteAndEnter,
    currentBaseUrl: b.url,
    currentToken: b.token,
    GATEWAY_TRANSPORT: 'muqun-aes-256-gcm-v1',
    REQUEST_TIMEOUT_MS: 100,
    UPLOAD_TIMEOUT_MS: 100,
    isDemoRecord: () => false,
    activeLocaleHeaders: () => ({}),
    directGatewayBaseUrl: (record: GatewayRecord) => (record.sshTunnel ? null : record.url),
    tunnelSessionOpener: async () => {
      if (waitForTunnel) await tunnel.promise;
      return {
        baseUrl: 'http://fixture-tunnel.invalid',
        release: () => {
          releases++;
          if (releaseFailure) throw new Error('release failure');
        },
      };
    },
    FormData: class {
      append() {}
    },
    fetchWithin: async (
      _budget: number,
      _message: string,
      url: string,
      init: { headers: { Authorization: string } }
    ) => {
      calls.push({ url, token: init.headers.Authorization });
      return response;
    },
    encryptedGatewayFetch: async (
      url: string,
      _init: unknown,
      _budget: number,
      endpoint: GatewayRecord,
      valid: () => boolean
    ) => {
      assertDeliveryCurrent(valid);
      calls.push({ url, token: endpoint.token, endpoint });
      return response;
    },
  };
  const functions = runInNewContext(
    ts.transpileModule(`${source}\n({ uploadAttachment, sendBoundPaneText })`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText,
    globals
  ) as {
    uploadAttachment: (
      record: GatewayRecord,
      uri: string,
      name: string,
      mime: string,
      valid: () => boolean
    ) => Promise<{ path: string }>;
    sendBoundPaneText: (
      record: GatewayRecord,
      session: string,
      pane: string,
      text: string,
      submit: boolean,
      valid: () => boolean
    ) => Promise<void>;
  };
  return {
    ...functions,
    calls,
    ack,
    tunnel,
    waitForTunnel: () => {
      waitForTunnel = true;
    },
    wait: () => {
      waitForAck = true;
    },
    releases: () => releases,
    failRelease: () => {
      releaseFailure = true;
    },
  };
}

test('bound uploads use captured direct or encrypted credentials, never global B', async () => {
  for (const encrypted of [false, true]) {
    const c = client();
    const record = encrypted
      ? {
          ...a,
          transport: 'muqun-aes-256-gcm-v1' as const,
          deviceId: 'device-a',
          transportKey: 'key-a',
        }
      : a;
    const result = await c.uploadAttachment(
      record,
      'file:///fixture.webp',
      'fixture.webp',
      'image/webp',
      () => true
    );
    expect(result.path).toBe('/gateway-a/uploads/image.webp');
    expect(c.calls[0].url).toBe('https://a.invalid/api/uploads');
    expect(c.calls[0].token).toBe(encrypted ? 'token-a' : 'Bearer token-a');
    if (encrypted) {
      expect(c.calls[0].endpoint?.deviceId).toBe('device-a');
      expect(c.calls[0].endpoint?.transportKey).toBe('key-a');
    }
  }
});

test('switching A to B while A paste ACK is pending never sends Enter to B or A', async () => {
  const c = client();
  c.wait();
  const owner = new DeliveryOwnership();
  const valid = owner.capture();
  const result = c.sendBoundPaneText(a, 'same-session', 'same-pane', 'echo fixture', true, valid);
  await turn();
  expect(c.calls.length).toBe(1);
  owner.invalidate();
  c.ack.resolve();
  await expect(result).rejects.toThrow('no longer active');
  expect(c.calls.length).toBe(1);
  expect(c.calls[0].url).toContain('a.invalid');
});

test('tunnel lease remains held through ACK and Enter, then releases once', async () => {
  const c = client();
  c.wait();
  const record = {
    ...a,
    sshTunnel: { hostId: 'fixture', remoteHost: 'localhost', remotePort: 1234 },
  };
  const result = c.sendBoundPaneText(record, 's', 'p', 'echo fixture', true, () => true);
  await turn();
  expect(c.releases()).toBe(0);
  expect(c.calls.length).toBe(1);
  c.ack.resolve();
  await result;
  expect(c.calls.map((call) => call.url.split('/').pop())).toEqual(['send-text', 'send-keys']);
  expect(c.calls.every((call) => call.token === 'Bearer token-a')).toBe(true);
  expect(c.releases()).toBe(1);
});

test('failed ACK or failed tunnel cleanup never retries a delivery', async () => {
  const record = {
    ...a,
    sshTunnel: { hostId: 'fixture', remoteHost: 'localhost', remotePort: 1234 },
  };
  const failed = client();
  failed.wait();
  const result = failed.sendBoundPaneText(record, 's', 'p', 'fixture', true, () => true);
  await turn();
  failed.ack.reject(new Error('ambiguous ACK'));
  await expect(result).rejects.toThrow('ambiguous ACK');
  expect(failed.calls.length).toBe(1);
  expect(failed.releases()).toBe(1);
  const cleanup = client();
  cleanup.failRelease();
  await expect(
    cleanup.sendBoundPaneText(record, 's', 'p', 'fixture', false, () => true)
  ).rejects.toThrow('release failure');
  expect(cleanup.calls.length).toBe(1);
  expect(cleanup.releases()).toBe(1);
});

test('explicit incomplete encrypted credentials do not borrow global credentials', async () => {
  const source = declaration('src/lib/gateway-client.ts', 'encryptedGatewayFetch');
  const run = runInNewContext(
    ts.transpileModule(`${source}\nencryptedGatewayFetch`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText,
    { currentToken: 'b', currentDeviceId: 'b', currentTransportKey: 'b', REQUEST_TIMEOUT_MS: 1 }
  );
  await expect(run(a.url, {}, 1, { token: 'a' })).rejects.toThrow('Not connected');
});

test('ownership invalidation is permanent across switching away and back', () => {
  const owner = new DeliveryOwnership();
  const original = owner.capture();
  expect(original()).toBe(true);
  owner.invalidate();
  expect(original()).toBe(false);
  expect(owner.capture()()).toBe(true);
});

test('switching during tunnel resolution prevents upload and still releases the acquired lease', async () => {
  const c = client();
  c.waitForTunnel();
  const owner = new DeliveryOwnership();
  const record = {
    ...a,
    sshTunnel: { hostId: 'fixture', remoteHost: 'localhost', remotePort: 1234 },
  };
  const result = c.uploadAttachment(record, file.uri, file.name, file.mime, owner.capture());
  owner.invalidate();
  c.tunnel.resolve();
  await expect(result).rejects.toThrow('no longer active');
  expect(c.calls).toEqual([]);
  expect(c.releases()).toBe(1);
});

test('encrypted serialization rechecks ownership before any network transmission', async () => {
  const serialization = deferred<{ bytes: Uint8Array; contentType: string }>();
  const owner = new DeliveryOwnership();
  const source = declaration('src/lib/gateway-client.ts', 'encryptedGatewayFetch');
  const run = runInNewContext(
    ts.transpileModule(`${source}\nencryptedGatewayFetch`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText,
    {
      REQUEST_TIMEOUT_MS: 1,
      assertDeliveryCurrent,
      isStreamingRequest: () => false,
      requestAad: () => 'fixture',
      headerRecord: () => ({}),
      serializeBody: () => serialization.promise,
      // No crypto or network ports: reaching either would fail this fixture.
    }
  );
  const result = run(
    a.url,
    {},
    1,
    { token: 'a', deviceId: 'a', transportKey: 'a' },
    owner.capture()
  );
  owner.invalidate();
  serialization.resolve({ bytes: new Uint8Array(), contentType: 'image/webp' });
  await expect(result).rejects.toThrow('no longer active');
});

function uploads() {
  let uploadingId = '';
  let record: GatewayRecord | null = a;
  let listener:
    | ((next: { record: GatewayRecord | null }, previous: { record: GatewayRecord | null }) => void)
    | undefined;
  const compression = deferred<queue.PickedFile>();
  const upload = deferred<{ path: string }>();
  const calls: GatewayRecord[] = [];
  const cleanups: (() => void)[] = [];
  let blur: (() => void) | undefined;
  const source = declaration('src/hooks/use-attachment-uploads.ts', 'useAttachmentUploads');
  const hook = runInNewContext(
    ts.transpileModule(`${source}\nuseAttachmentUploads(record)`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText,
    {
      ...queue,
      DeliveryOwnership,
      record,
      markUploading: (entries: queue.PendingAttachment[], id: string) => {
        uploadingId = id;
        return queue.markUploading(entries, id);
      },
      useState: (initial: unknown) => [
        typeof initial === 'function' ? initial() : initial,
        () => {},
      ],
      useRef: (current: unknown) => ({ current }),
      useCallback: (fn: unknown) => fn,
      useEffect: (body: () => (() => void) | undefined) => {
        const cleanup = body();
        if (cleanup) cleanups.push(cleanup);
      },
      useFocusEffect: (body: () => () => void) => {
        blur = body();
      },
      useGatewayConnectionStore: {
        getState: () => ({ record }),
        subscribe: (fn: typeof listener) => {
          listener = fn;
          return () => {};
        },
      },
      compressPickedImage: () => compression.promise,
      uploadAttachment: (destination: GatewayRecord) => {
        calls.push(destination);
        return upload.promise;
      },
      describeUploadFailure: () => 'fixture failure',
    }
  ) as AttachmentUploads;
  return {
    hook,
    calls,
    compression,
    upload,
    remove: () => hook.removeAttachment(uploadingId),
    blur: () => blur?.(),
    unmount: () => cleanups.forEach((cleanup) => cleanup()),
    switchRecord: (next: GatewayRecord) => {
      const previous = record;
      record = next;
      listener?.({ record }, { record: previous });
    },
  };
}
const file: queue.PickedFile = {
  uri: 'file:///fixture.webp',
  name: 'fixture.webp',
  mime: 'image/webp',
};

test('actual hook drops picker results after navigation or A/B/A without unmount', async () => {
  for (const invalidate of ['blur', 'switch'] as const) {
    const h = uploads();
    const picker = h.hook.capturePicker();
    if (invalidate === 'blur') h.blur();
    else {
      h.switchRecord(b);
      h.switchRecord(a);
    }
    picker.addFiles([file]);
    h.compression.resolve(file);
    await turn();
    expect(picker.isCurrent()).toBe(false);
    expect(h.calls).toEqual([]);
    expect(await h.hook.awaitUploads()).toEqual([]);
  }
});

test('actual hook never transmits after removal, clear, unmount, blur or switch during compression', async () => {
  for (const action of ['remove', 'clear', 'unmount', 'blur', 'switch'] as const) {
    const h = uploads();
    h.hook.addFiles([file]);
    if (action === 'remove') {
      h.remove();
    } else if (action === 'clear') h.hook.clearAttachments();
    else if (action === 'unmount') h.unmount();
    else if (action === 'blur') h.blur();
    else h.switchRecord(b);
    h.compression.resolve(file);
    await turn();
    expect(h.calls).toEqual([]);
  }
});

test('actual hook binds successful upload to A and discards late completion after switching', async () => {
  const h = uploads();
  h.hook.addFiles([file]);
  h.compression.resolve(file);
  await turn();
  expect(h.calls.length).toBe(1);
  expect(h.calls[0].serverId).toBe('a');
  h.switchRecord(b);
  h.upload.resolve({ path: '/a/private-image.webp' });
  await turn();
  expect(await h.hook.awaitUploads()).toEqual([]);
});

function selectionPaths() {
  const path = 'src/components/server-terminal-workspace.tsx';
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const found: Record<string, string> = {};
  let route = '';
  let readiness = '';
  function visit(node: ts.Node) {
    if (
      ts.isFunctionDeclaration(node) &&
      ['selectWorkspace', 'sameSelection', 'reconcileSelection', 'selectionForPane'].includes(
        node.name?.text ?? ''
      )
    )
      found[node.name!.text] = node.getText(source);
    if (
      ts.isVariableDeclaration(node) &&
      ['setSelection', 'selectTab'].includes(node.name.getText(source))
    )
      found[node.name.getText(source)] = `const ${node.getText(source)};`;
    if (ts.isCallExpression(node) && node.arguments[0] && ts.isArrowFunction(node.arguments[0])) {
      const body = node.arguments[0].getText(source);
      if (node.expression.getText(source) === 'useEffect' && body.includes('const targetKey ='))
        route = body;
      if (
        node.expression.getText(source) === 'useLayoutEffect' &&
        body.includes('activeServerRef.current =')
      )
        readiness = body;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!route || !readiness || Object.keys(found).length !== 6)
    throw new Error('Production selection paths missing');
  const owner = new DeliveryOwnership();
  const initial = { workspaceId: 'wa', tabId: 'ta', paneId: 'pa' };
  const same = (a: typeof initial, b: typeof initial) =>
    a.workspaceId === b.workspaceId && a.tabId === b.tabId && a.paneId === b.paneId;
  const context = {
    selectionOwner: new DeliverySelection(initial, same, owner),
    deliveryOwnership: owner,
    useCallback: (fn: unknown) => fn,
    publishSelection: (value: unknown) => {
      expect(typeof value).toBe('object');
    },
    setError: () => {},
    field: (entry: { raw: Record<string, unknown> }, key: string) => String(entry.raw[key] ?? ''),
    rememberWorkspaceSelection,
    recallWorkspaceSelection,
    rememberTabPane,
    recallTabPane,
    workspaceMemoryRef: { current: {} },
    tabPaneMemoryRef: { current: {} },
    paneDirectionRef: { current: 0 },
    initialSelection: initial,
    appliedNotificationTargetRef: { current: null },
    serverId: 'a',
    requestedSessionId: 's',
    notificationId: null,
    requestedPaneId: 'pb',
    activeServerRef: { current: 'a' },
    activePaneRef: { current: 'pa' },
    ready: true,
    t: () => 'fixture',
    data: {
      health: {},
      sessionId: 's',
      workspaces: [
        { id: 'wa', raw: {} },
        { id: 'wb', raw: {} },
      ],
      tabs: [
        { id: 'ta', raw: { workspace_id: 'wa' } },
        { id: 'ta2', raw: { workspace_id: 'wa' } },
        { id: 'tb', raw: { workspace_id: 'wb' } },
      ],
      panes: [
        { id: 'pa', raw: { workspace_id: 'wa', tab_id: 'ta' } },
        { id: 'pa2', raw: { workspace_id: 'wa', tab_id: 'ta2' } },
        { id: 'pb', raw: { workspace_id: 'wb', tab_id: 'tb' } },
      ],
    },
    selection: initial,
  };
  const functions = runInNewContext(
    ts.transpileModule(
      `${Object.values(found).join('\n')}\n({selectWorkspace, selectTab, route:${route}, readiness:${readiness}})`,
      {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
      }
    ).outputText,
    context
  ) as {
    selectWorkspace: (id: string) => void;
    selectTab: (target: { tabId: string }, direction: string) => void;
    route: () => void;
    readiness: () => () => void;
  };
  return { ...functions, owner, context };
}

test('actual workspace, tab and route-target A/B/A transitions suppress pending Enter', async () => {
  for (const path of ['workspace', 'tab', 'route'] as const) {
    const p = selectionPaths();
    const ack = deferred<void>();
    let enters = 0;
    const pending = deliverPasteAndEnter(
      () => ack.promise,
      async () => {
        enters++;
      },
      p.owner.capture()
    );
    if (path === 'workspace') {
      p.selectWorkspace('wb');
      p.selectWorkspace('wa');
    } else if (path === 'tab') {
      p.selectTab({ tabId: 'ta2' }, 'next');
      p.selectTab({ tabId: 'ta' }, 'previous');
    } else {
      p.route();
      p.context.requestedPaneId = 'pa';
      p.route();
    }
    ack.resolve();
    await expect(pending).rejects.toThrow('no longer active');
    expect(enters).toBe(0);
  }
});

test('selection no-ops preserve delivery and updater callbacks run once against the latest selection', () => {
  const owner = new DeliveryOwnership();
  const selection = new DeliverySelection({ pane: 'a' }, (a, b) => a.pane === b.pane, owner);
  const current = owner.capture();
  selection.update({ pane: 'a' });
  expect(current()).toBe(true);
  let calls = 0;
  selection.update((previous) => {
    calls++;
    expect(previous.pane).toBe('a');
    return { pane: 'b' };
  });
  expect(current()).toBe(false);
  selection.update((previous) => {
    calls++;
    expect(previous.pane).toBe('b');
    return { pane: 'a' };
  });
  expect(calls).toBe(2);
});

test('actual readiness layout cleanup prevents tunnel reconnect or session change reviving Enter', async () => {
  for (const transition of ['reconnect', 'session'] as const) {
    const p = selectionPaths();
    const cleanup = p.readiness();
    const ack = deferred<void>();
    let enters = 0;
    const pending = deliverPasteAndEnter(
      () => ack.promise,
      async () => {
        enters++;
      },
      p.owner.capture()
    );
    cleanup();
    if (transition === 'reconnect') {
      p.context.ready = false;
      p.readiness()();
      p.context.ready = true;
    } else p.context.data.sessionId = 'new-session';
    p.readiness();
    ack.resolve();
    await expect(pending).rejects.toThrow('no longer active');
    expect(enters).toBe(0);
  }
});

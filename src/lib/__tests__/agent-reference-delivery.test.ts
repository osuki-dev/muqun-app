import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as collaboration from '../agent-collaboration';
import * as references from '../agent-command-references';
import { collaborationDraftScope, collaborationTaskText } from '../quick-command-collaboration';
import { assertDeliveryCurrent, DeliveryOwnership, DeliverySelection } from '../bound-delivery';

const context = { serverId: 'a', sessionId: 'herdr', paneId: 'source', commandId: 'custom' };
const scope = {
  serverId: 'a',
  sessionId: 'herdr',
  sourcePaneId: 'source',
  commandId: 'custom',
  connectionGeneration: 0,
};
const record = { serverId: 'a', label: 'Gateway A', token: 'a', url: 'https://a.invalid' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function productionStore(initial: Record<string, collaboration.CollaborationDraft>) {
  const path = 'src/stores/agent-collaboration.ts';
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const declaration = source.statements.find(
    (node) =>
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (item) => item.name.getText(source) === 'useAgentCollaboration'
      )
  );
  if (!declaration) throw new Error('Missing production store');
  type State = {
    drafts: Record<string, collaboration.CollaborationDraft>;
    draftOwners: Record<string, symbol>;
    tasks: collaboration.CollaborationTask[];
    claimDraft: (key: string, owner: symbol) => void;
    saveDraft: (key: string, draft: collaboration.CollaborationDraft | null) => void;
    saveOwnedDraft: (
      key: string,
      owner: symbol,
      draft: collaboration.CollaborationDraft | null
    ) => void;
    add: (task: collaboration.CollaborationTask) => void;
  };
  let current!: State;
  runInNewContext(
    ts.transpileModule(declaration.getText(source).replace(/^export /, ''), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
    }).outputText,
    {
      restore: () => [],
      save() {},
      ...collaboration,
      create: (initialize: (set: (update: (state: State) => Partial<State>) => void) => State) => {
        current = initialize((update) => Object.assign(current, update(current)));
        return current;
      },
    }
  );
  for (const [key, draft] of Object.entries(initial)) current.saveDraft(key, draft);
  return current;
}

/** Execute the production controller, replacing only native hooks/I/O. */
function harness() {
  const source = readFileSync('src/hooks/use-agent-collaboration.ts', 'utf8');
  const parsed = ts.createSourceFile('controller.ts', source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find(
    (node) =>
      ts.isFunctionDeclaration(node) && node.name?.text === 'useAgentCollaborationController'
  );
  if (!declaration) throw new Error('Missing controller');
  const imageDraft = references.addAgentImageReference(
    references.createAgentReferenceDraft(scope),
    'image',
    { uri: 'file:///phone/private.png', name: 'image.png', mime: 'image/png', size: 10 }
  );
  const ticket = references.beginAgentReferenceUpload(imageDraft, 'image', scope);
  const ready = references.finishAgentReferenceUpload(
    ticket.draft,
    ticket.ticket,
    { path: '/gateway-a/uploads/image.png' },
    scope
  );
  const state = { record: record as typeof record | null };
  const drafts: Record<string, collaboration.CollaborationDraft> = {
    [collaborationDraftScope(context)]: {
      context,
      prompt: 'Make something useful',
      command: { name: 'My skill', instructions: 'Generic custom instructions' },
      newAgent: true,
      target: '',
      kind: 'claude',
      recoveryPane: null,
      references: imageDraft,
    },
  };
  const listeners: ((a: typeof state, b: typeof state) => void)[] = [];
  const cleanups: (() => void)[] = [];
  const autosaves: (() => unknown)[] = [];
  let referenceRevision = Symbol();
  const control = {
    approve: true,
    reads: 0,
    uploads: 0,
    sends: 0,
    backs: 0,
    uploadGate: null as Promise<void> | null,
    healthGate: null as Promise<void> | null,
    spawnGate: null as Promise<void> | null,
    capabilities: ['agent_collaboration', 'agent_spawn', 'file_uploads'],
    sentText: '',
    sentRecord: null as unknown,
    result: {
      paneId: 'created',
      agentStarted: true,
      promptSubmitted: true,
      agentInstanceId: 'opaque-new',
    },
  };
  const store = productionStore(drafts);
  const globals = {
    ...collaboration,
    ...references,
    DeliveryOwnership,
    DeliverySelection,
    assertDeliveryCurrent,
    collaborationDraftScope,
    collaborationTaskText,
    useLingui: () => ({
      t: (parts: TemplateStringsArray, ...values: unknown[]) =>
        parts.reduce((text, part, index) => text + part + (values[index] ?? ''), ''),
    }),
    useRouter: () => ({
      back: () => {
        control.backs++;
      },
    }),
    useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial: unknown) => ({ current: initial }),
    useCallback: (fn: unknown) => fn,
    useLayoutEffect: (fn: () => (() => void) | undefined) => {
      const cleanup = fn();
      if (cleanup) cleanups.push(cleanup);
    },
    useFocusEffect: (fn: () => () => void) => cleanups.push(fn()),
    useEffect: (fn: () => unknown) => {
      if (String(fn).includes('subscribe')) fn();
      if (String(fn).includes('saveOwnedDraft')) {
        autosaves.push(fn);
        fn();
      }
    },
    useAgentCollaboration: Object.assign(
      (selector: (s: typeof store) => unknown) => selector(store),
      { getState: () => store }
    ),
    useGatewayConnectionStore: Object.assign(
      (selector: (s: typeof state) => unknown) => selector(state),
      {
        getState: () => state,
        subscribe: (fn: (typeof listeners)[number]) => {
          listeners.push(fn);
        },
      }
    ),
    useCollaborationOutput: () => ({}),
    useAgentReferences: () => ({
      draft: imageDraft,
      clear: () => {},
      snapshot: () => imageDraft,
      captureRevision: () => {
        const captured = referenceRevision;
        return () => referenceRevision === captured;
      },
      prepare: async (_record: unknown, isCurrent: () => boolean) => {
        control.uploads++;
        if (control.uploadGate) await control.uploadGate;
        assertDeliveryCurrent(isCurrent);
        return ready;
      },
    }),
    Alert: {
      alert: (_title: string, _body: string, actions: { onPress: () => void }[]) =>
        actions[control.approve ? 1 : 0].onPress(),
    },
    loadHealth: async () => {
      control.reads++;
      if (control.healthGate) await control.healthGate;
      return {
        capabilities: control.capabilities,
        backends: [{ sessionId: 'herdr', kind: 'herdr', version: '0.9.0', connected: true }],
      };
    },
    loadSessions: async () => ({ sessions: [{ id: 'herdr', backend: 'herdr' }] }),
    loadAgents: async () => [],
    spawnBoundAgent: async (
      destination: unknown,
      _session: string,
      request: { prompt: string },
      isCurrent: () => boolean
    ) => {
      assertDeliveryCurrent(isCurrent);
      control.sends++;
      control.sentRecord = destination;
      control.sentText = request.prompt;
      if (control.spawnGate) await control.spawnGate;
      return control.result;
    },
    Keyboard: { dismiss() {} },
    usePanelPickerStore: { getState: () => ({ choosePanel() {} }) },
    describeGatewayFailure: (failure: Error) => ({ message: failure.message }),
  };
  const controller = runInNewContext(
    ts.transpileModule(
      parsed.statements
        .filter((node) => ts.isFunctionDeclaration(node))
        .map((node) => node.getText(parsed).replace(/^export /, ''))
        .join('\n') + '\nuseAgentCollaborationController',
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
    ).outputText,
    globals
  )(context) as { assign: () => Promise<void>; setKind: (value: string) => void };
  return {
    ...control,
    control,
    controller,
    get tasks() {
      return store.tasks;
    },
    get drafts() {
      return store.drafts;
    },
    store,
    rerunAutosave: () => autosaves.forEach((effect) => effect()),
    editReference: () => {
      referenceRevision = Symbol();
    },
    cleanups,
    select(next: typeof state.record) {
      const previous = { ...state };
      state.record = next;
      for (const listener of listeners) listener(state, previous);
    },
  };
}
const turn = () => new Promise<void>((done) => setImmediate(done));

test('reference consent cancellation sends and uploads nothing and preserves the draft', async () => {
  const h = harness();
  h.control.approve = false;
  await h.controller.assign();
  expect(h.control.reads).toBe(0);
  expect(h.control.uploads).toBe(0);
  expect(h.control.sends).toBe(0);
  expect(Object.values(h.drafts)[0].references?.images).toHaveLength(1);
});
test('new assistants receive structured references through the bound destination, not persisted history', async () => {
  const h = harness();
  await h.controller.assign();
  expect(h.control.uploads).toBe(1);
  expect(h.control.sends).toBe(1);
  expect(h.control.sentRecord).toEqual(record);
  expect(h.control.sentText).toContain('/gateway-a/uploads/image.png');
  expect(h.control.sentText).toContain('Generic custom instructions');
  expect(h.control.sentText).not.toContain('file:///');
  expect(h.tasks).toHaveLength(1);
  expect(JSON.stringify(h.tasks)).not.toContain('/uploads/');
  expect(JSON.stringify(h.tasks)).not.toContain('file:///');
});
test('unsupported uploads never transmit bytes or start an assistant', async () => {
  const h = harness();
  h.control.capabilities = ['agent_collaboration', 'agent_spawn'];
  await h.controller.assign();
  expect(h.control.uploads).toBe(0);
  expect(h.control.sends).toBe(0);
  expect(Object.values(h.drafts)).toHaveLength(1);
});
test('Gateway A→B→A during preflight or upload never revives the old dispatch', async () => {
  for (const stage of ['healthGate', 'uploadGate'] as const) {
    const h = harness();
    const gate = deferred<void>();
    h.control[stage] = gate.promise;
    const request = h.controller.assign();
    await turn();
    h.select({ ...record, serverId: 'b' });
    h.select(record);
    gate.resolve();
    await request;
    expect(h.control.sends).toBe(0);
    expect(h.tasks).toHaveLength(0);
    expect(Object.values(h.drafts)).toHaveLength(1);
  }
});

test('queued native profile A→B→A changes invalidate the in-flight reference dispatch', async () => {
  const h = harness();
  const gate = deferred<void>();
  h.control.uploadGate = gate.promise;
  const request = h.controller.assign();
  await turn();
  h.controller.setKind('codex');
  h.controller.setKind('claude');
  gate.resolve();
  await request;
  expect(h.control.sends).toBe(0);
  expect(h.tasks).toHaveLength(0);
});
test('a successful spawn after leaving retains real history without stale navigation or retry', async () => {
  const h = harness();
  const gate = deferred<void>();
  h.control.spawnGate = gate.promise;
  const request = h.controller.assign();
  await turn();
  h.cleanups.forEach((cleanup) => cleanup());
  gate.resolve();
  await request;
  expect(h.control.sends).toBe(1);
  expect(h.tasks).toHaveLength(1);
  expect(h.control.backs).toBe(0);
  expect(Object.values(h.drafts)[0].newAgent).toBe(false);
  expect(Object.values(h.drafts)[0].recoveryPane).toBe('created');
});

test('late success or partial spawn never overwrites a newer same-scope editor draft', async () => {
  for (const delivered of [true, false]) {
    const h = harness();
    const gate = deferred<void>();
    h.control.spawnGate = gate.promise;
    h.control.result.promptSubmitted = delivered;
    const request = h.controller.assign();
    await turn();
    const key = collaborationDraftScope(context);
    const newer = {
      ...h.drafts[key],
      owner: Symbol('new-editor'),
      prompt: 'New task',
      recoveryPane: null,
      newAgent: true,
    };
    h.store.saveDraft(key, newer);
    h.cleanups.forEach((cleanup) => cleanup());
    gate.resolve();
    await request;
    expect(h.drafts[key]).toBe(newer);
    expect(h.tasks).toHaveLength(delivered ? 1 : 0);
    expect(h.control.sends).toBe(1);
  }
});

test('old mounted autosave effects cannot reclaim a replaced or subsequently cleared draft', async () => {
  const h = harness();
  const gate = deferred<void>();
  h.control.uploadGate = gate.promise;
  const request = h.controller.assign();
  await turn();
  const key = collaborationDraftScope(context);
  const nextOwner = Symbol('new editor');
  h.store.claimDraft(key, nextOwner);
  h.store.saveOwnedDraft(key, nextOwner, { ...h.drafts[key], prompt: 'New editor text' });
  const newer = h.drafts[key];
  gate.resolve();
  await request;
  // A queued old React passive effect runs again after the asynchronous update.
  h.rerunAutosave();
  expect(h.drafts[key]).toBe(newer);
  expect(h.store.draftOwners[key]).toBe(nextOwner);
  h.store.saveOwnedDraft(key, nextOwner, null);
  h.rerunAutosave();
  expect(h.drafts[key]).toBeUndefined();
  expect(h.control.sends).toBe(0);
});

test('reference edits A→B→A during deferred preflight revoke the original consent before any upload', async () => {
  const h = harness();
  const gate = deferred<void>();
  h.control.healthGate = gate.promise;
  const request = h.controller.assign();
  await turn();
  h.editReference();
  h.editReference();
  gate.resolve();
  await request;
  expect(h.control.uploads).toBe(0);
  expect(h.control.sends).toBe(0);
});

function uploadHarness(count = 2) {
  const path = 'src/hooks/use-agent-references.ts';
  const source = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true
  );
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node));
  if (!declaration) throw new Error('Missing reference hook');
  const ownership = new DeliveryOwnership();
  const state: unknown[] = [];
  let draft = references.createAgentReferenceDraft(scope);
  const file = { uri: 'file:///photo.png', name: 'photo.png', mime: 'image/png', size: 10 };
  for (let index = 0; index < count; index++)
    draft = references.addAgentImageReference(draft, ['one', 'two'][index] ?? String(index), file);
  const control = {
    uploads: 0,
    fail: false,
    compressionGate: null as Promise<void> | null,
    uploadGate: null as Promise<void> | null,
    pickedFiles: [] as (typeof file)[],
  };
  const hook = runInNewContext(
    ts.transpileModule(
      declaration.getText(source).replace(/^export /, '') + '\nuseAgentReferences',
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }
    ).outputText,
    {
      ...references,
      assertDeliveryCurrent,
      useLingui: () => ({ t: (parts: string[]) => parts.join('') }),
      useRef: (value: unknown) => ({ current: value }),
      pickPhotoLibrary: async () => control.pickedFiles,
      nextAttachmentId: () => String(Math.random()),
      useState: (initial: unknown) => {
        const index = state.length;
        state.push(typeof initial === 'function' ? initial() : initial);
        return [
          state[index],
          (value: unknown) => {
            state[index] = value;
          },
        ];
      },
      compressPickedImage: async (picked: unknown) => {
        if (control.compressionGate) await control.compressionGate;
        return picked;
      },
      uploadAttachment: async (
        _record: unknown,
        _uri: string,
        _name: string,
        _mime: string,
        isCurrent: () => boolean
      ) => {
        assertDeliveryCurrent(isCurrent);
        control.uploads++;
        if (control.uploadGate) await control.uploadGate;
        if (control.fail) throw new Error('Upload failed');
        return { path: '/gateway/receipt.png' };
      },
    }
  )(scope, draft, () => ownership.capture()) as {
    prepare: (record: unknown, current: () => boolean) => Promise<references.AgentReferenceDraft>;
    remove: (id: string) => void;
    pick: () => Promise<void>;
    edit: (id: string, caption: string, use: references.AgentReferenceUse) => void;
    captureRevision: () => () => boolean;
  };
  return { hook, control, ownership, state };
}
test('actual reference hook preserves failed images and retries only on another explicit prepare', async () => {
  const h = uploadHarness();
  h.control.fail = true;
  await expect(h.hook.prepare(record, h.ownership.capture())).rejects.toThrow('Upload failed');
  const draft = h.state[0] as references.AgentReferenceDraft;
  expect(draft.images).toHaveLength(2);
  expect(draft.images[0].upload?.status).toBe('failed');
  expect(h.control.uploads).toBe(1);
  h.control.fail = false;
  const ready = await h.hook.prepare(record, h.ownership.capture());
  expect(ready.images.every((image) => image.upload?.status === 'uploaded')).toBe(true);
  expect(h.control.uploads).toBe(3);
});

test('actual hook image-use A→B→A changes invalidate a previously captured review revision', () => {
  const h = uploadHarness();
  const isCurrent = h.hook.captureRevision();
  h.hook.edit('one', '', 'may-include');
  h.hook.edit('one', '', 'reference-only');
  expect(isCurrent()).toBe(false);
});

test('an overflowing photo batch leaves all previous images and review validity unchanged', async () => {
  const h = uploadHarness(8);
  const previous = h.state[0];
  const isCurrent = h.hook.captureRevision();
  h.control.pickedFiles = Array.from({ length: 3 }, () => ({
    uri: 'file:///new.png',
    name: 'new.png',
    mime: 'image/png',
    size: 10,
  }));
  await h.hook.pick();
  expect(h.state[0]).toBe(previous);
  expect((h.state[0] as references.AgentReferenceDraft).images).toHaveLength(8);
  expect(isCurrent()).toBe(true);
});
test('actual reference hook checks ownership after compression and each upload before continuing', async () => {
  for (const stage of ['compressionGate', 'uploadGate'] as const) {
    const h = uploadHarness();
    const gate = deferred<void>();
    h.control[stage] = gate.promise;
    const pending = h.hook.prepare(record, h.ownership.capture());
    await turn();
    h.ownership.invalidate();
    gate.resolve();
    await expect(pending).rejects.toThrow('destination');
    expect(h.control.uploads).toBe(stage === 'compressionGate' ? 0 : 1);
    expect((h.state[0] as references.AgentReferenceDraft).images).toHaveLength(2);
  }
});

test('removing a reference while a native upload finishes cannot resurrect it or send the next file', async () => {
  const h = uploadHarness();
  const gate = deferred<void>();
  h.control.uploadGate = gate.promise;
  const pending = h.hook.prepare(record, h.ownership.capture());
  await turn();
  h.hook.remove('one');
  gate.resolve();
  await expect(pending).rejects.toThrow('destination');
  expect((h.state[0] as references.AgentReferenceDraft).images.map((image) => image.id)).toEqual([
    'two',
  ]);
  expect(h.control.uploads).toBe(1);
});

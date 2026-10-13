import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';

import { declaration, transpile } from '../../test-support/production-source';
import { recoverWith, settleAfter } from '../compiler-safe-control-flow';
import { homeSessionReuse, sameComputer, type HomeStartedSession } from '../home-composer';
import { terminalPromptWithAttachments } from '../agent-spawn';

function dock(
  options: {
    agentId?: string;
    terminal?: boolean;
    ledger?: boolean;
    fail?: 'create' | 'prompt';
    moveAt?: 'create' | 'mode';
    replaceDevice?: boolean;
    reused?: HomeStartedSession;
  } = {}
) {
  const original = { serverId: 'computer-a', deviceId: 'phone-a', url: 'https://a.invalid' };
  let record = original;
  const creates: unknown[] = [];
  const prompts: unknown[] = [];
  const terminal: unknown[] = [];
  const ledger: string[] = [];
  const bound: unknown[] = [];
  const failed: unknown[] = [];
  const opened: unknown[] = [];
  const switched: string[] = [];
  const prompted: unknown[] = [];
  const errors: unknown[] = [];
  const startedRef = { current: options.reused ?? null };
  const params = {
    agentId: options.agentId ?? 'codex',
    mode: 'build',
    model: { provider_id: 'openai', model_id: 'model-a', variant: 'high' },
  };
  const move = () => {
    record = options.replaceDevice
      ? { ...record, deviceId: 'phone-b' }
      : { ...record, serverId: 'computer-b', url: 'https://b.invalid' };
  };
  const source = ['startSession', 'sendSessionPrompt', 'sendPrompt']
    .map((name) => declaration('src/components/home-composer-dock.tsx', name))
    .join('\n');
  const api = runInNewContext(transpile(`${source}\n({sendPrompt})`), {
    recoverWith,
    settleAfter,
    homeSessionReuse,
    sameComputer,
    terminalPromptWithAttachments,
    inFlightRef: { current: false },
    startedRef,
    sendTarget: async () => original.serverId,
    sessionParams: params,
    agentId: params.agentId,
    folder: '/workspace/selected',
    terminalAgent: options.terminal ? { agentKind: 'codex', name: 'Codex', confirmed: true } : null,
    ledgerCreate: options.ledger !== false,
    ledgerPane: true,
    ready: true,
    playTransition: () => {},
    heldByModelGate: () => false,
    dispatchTask: (_text: string, send: () => Promise<boolean>) => send(),
    startTerminalAgent: async (...args: unknown[]) => {
      terminal.push(args);
      return true;
    },
    openLedgerTask: async (text: string) => {
      ledger.push(text);
      return true;
    },
    createAgentSession: async (...args: unknown[]) => {
      creates.push(args);
      if (options.moveAt === 'create') move();
      if (options.fail === 'create') throw new Error('Create failed');
      return {
        asid: 'returned-native-id',
        agent_id: params.agentId,
        directory: '/workspace/selected',
      };
    },
    sendAgentPrompt: async (...args: unknown[]) => {
      prompts.push([record.serverId, ...args]);
      if (options.fail === 'prompt') throw new Error('Prompt failed');
    },
    switchAgentMode: async () => {
      switched.push('mode');
      if (options.moveAt === 'mode') move();
    },
    switchAgentModel: async () => {
      switched.push('model');
    },
    HOME_AGENT_SESSION_ID: 'herdr',
    useGatewayConnectionStore: { getState: () => ({ record, records: [original] }) },
    useHomeTaskCards: {
      getState: () => ({
        dispatched: () => 'pending-a',
        settle: () => {},
        bound: (...args: unknown[]) => bound.push(args),
        failed: (...args: unknown[]) => failed.push(args),
      }),
    },
    markAgentUsed: () => {},
    markPromptedSession: (...args: unknown[]) => prompted.push(args),
    onOpenAgent: (...args: unknown[]) => opened.push(args),
    checkAgentServer: async () => ({}),
    homeGuideParams: () => null,
    setError: (error: unknown) => errors.push(error),
    describeFailure: (error: Error) => error.message,
    t: (strings: TemplateStringsArray) => strings.join(''),
    console: { warn: () => {} },
  }) as { sendPrompt: (text: string, attachments?: string[]) => Promise<boolean> };
  return {
    ...api,
    creates,
    prompts,
    terminal,
    ledger,
    bound,
    failed,
    opened,
    switched,
    prompted,
    errors,
    startedRef,
    params,
  };
}

for (const [text, attachments] of [
  ['Read the date', undefined],
  ['Read this file', ['/uploads/report.pdf']],
  ['', ['/uploads/image.png']],
] as const) {
  test(`native Codex stays on its session plane: ${text || 'attachment only'}`, async () => {
    const home = dock();
    expect(await home.sendPrompt(text, attachments ? [...attachments] : undefined)).toBe(true);
    expect(home.creates).toEqual([['herdr', { ...home.params, directory: '/workspace/selected' }]]);
    expect(home.prompts).toEqual([
      ['computer-a', 'herdr', 'returned-native-id', { text, attachments: attachments ?? [] }],
    ]);
    expect(home.ledger).toEqual([]);
    expect(home.terminal).toEqual([]);
    expect(home.bound).toEqual([['pending-a', 'returned-native-id']]);
    expect(home.prompted).toEqual([['computer-a', 'returned-native-id']]);
    expect(home.opened).toEqual([]);
    expect(home.startedRef.current).toBeNull();
  });
}

test('terminal Codex retains terminal delivery, including attachment-only prompts', async () => {
  for (const text of ['Read the date', '']) {
    const home = dock({ terminal: true });
    const attachments = text ? undefined : ['/uploads/image.png'];
    expect(await home.sendPrompt(text, attachments)).toBe(true);
    expect(home.terminal).toEqual([
      [
        'codex',
        'Codex',
        true,
        terminalPromptWithAttachments(text, attachments ?? []),
        true,
        '/workspace/selected',
      ],
    ]);
    expect(home.creates).toEqual([]);
    expect(home.prompts).toEqual([]);
  }
});

test('other session providers keep their ledger path and direct sends stay on Home', async () => {
  const ledger = dock({ agentId: 'opencode' });
  expect(await ledger.sendPrompt('Read the date')).toBe(true);
  expect(ledger.ledger).toEqual(['Read the date']);
  expect(ledger.creates).toEqual([]);
  const session = dock({ agentId: 'opencode', ledger: false });
  expect(await session.sendPrompt('Read the date')).toBe(true);
  expect(session.bound).toEqual([['pending-a', 'returned-native-id']]);
  expect(session.opened).toEqual([]);
});

for (const fail of ['create', 'prompt'] as const) {
  test(`${fail} failure retains the complete draft and does not retry delivery`, async () => {
    const home = dock({ fail });
    const attachments = ['/uploads/report.pdf'];
    expect(await home.sendPrompt('Read this file', attachments)).toBe(false);
    expect(home.creates).toHaveLength(1);
    expect(home.prompts).toHaveLength(fail === 'prompt' ? 1 : 0);
    expect(home.failed).toEqual([
      [
        'pending-a',
        fail === 'create' ? 'Create failed' : 'Prompt failed',
        {
          text: 'Read this file',
          attachments,
          params: home.params,
          folder: '/workspace/selected',
        },
      ],
    ]);
    expect(home.opened).toEqual([]);
    expect(home.ledger).toEqual([]);
  });
}

for (const replaceDevice of [false, true]) {
  test(`selection ${replaceDevice ? 'device' : 'computer'} changed during creation never receives the prompt`, async () => {
    const home = dock({ moveAt: 'create', replaceDevice });
    expect(await home.sendPrompt('Read the date')).toBe(false);
    expect(home.creates).toHaveLength(1);
    expect(home.prompts).toEqual([]);
  });
}

test('reused session checks its computer between mode and model writes', async () => {
  const home = dock({
    moveAt: 'mode',
    reused: {
      key: 'computer-a\u0000codex\u0000/workspace/selected',
      asid: 'reused-native-id',
      params: { agentId: 'codex', mode: 'plan' },
    },
  });
  expect(await home.sendPrompt('Read the date')).toBe(false);
  expect(home.creates).toEqual([]);
  expect(home.switched).toEqual(['mode']);
  expect(home.prompts).toEqual([]);
});

import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import { productionSource, transpile, walk } from '../../test-support/production-source';
import {
  parseAgentDomainEvent,
  parseAgentSessionSnapshot,
  parseFormRequest,
  isBusyStatus,
  type FormRequest,
  type TimelineItem,
} from '../agent-protocol';
import {
  canReplyAgentForm,
  canSendAgentPrompt,
  hasBlockingAgentForm,
} from '../agent-runtime-controls';
import { applySubtaskBlockEvent } from '../agent-subtasks';
import { composerChipIds } from '../agent-composer-chips';
import { recoverWith, settleAfter } from '../compiler-safe-control-flow';
import type { AgentSessionRuntime } from '../agent-session-runtime';

const native: AgentSessionRuntime = { source: 'native', interaction: 'native', transcript: 'live' };
const question: FormRequest = {
  id: 'question',
  asid: 'thread',
  title: 'Direction?',
  nonblocking: true,
  fields: [],
};

function callback(path: string, name: string, environment: Record<string, unknown>) {
  const source = productionSource(path);
  let code = '';
  walk(source.program, (node) => {
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.id.name === name
    )
      code = source.code(node.init!);
  });
  expect(code).not.toBe('');
  return runInNewContext(transpile(code), { useCallback: (fn: unknown) => fn, ...environment });
}

test('async questions preserve observed metadata without blocking the turn or its subtask', () => {
  expect(parseAgentSessionSnapshot({ forms: [question] }).forms).toEqual([question]);
  const event = parseAgentDomainEvent('agent.form.pending', {
    asid: 'thread',
    seq: 1,
    request: question,
  });
  expect(event?.type).toBe('agent.form.pending');
  expect(event && applySubtaskBlockEvent({}, event)).toEqual({});
  expect(hasBlockingAgentForm([question])).toBe(false);
  expect(
    hasBlockingAgentForm([question, { ...question, id: 'required', nonblocking: false }])
  ).toBe(true);
  expect(parseFormRequest({ ...question, nonblocking: 'true' })?.nonblocking).toBeUndefined();
  expect(canReplyAgentForm(question, native)).toBe(true);
  for (const runtime of [
    undefined,
    { source: 'terminal', interaction: 'terminal', transcript: 'persisted' },
    { source: 'unobserved', interaction: 'native' },
  ] as (AgentSessionRuntime | undefined)[]) {
    expect(canReplyAgentForm(question, runtime)).toBe(false);
  }
  expect(canReplyAgentForm({ ...question, nonblocking: false }, undefined)).toBe(true);
});

test('steering support never enables queueing', () => {
  expect(canSendAgentPrompt(true, false, true, 'steer')).toBe(true);
  expect(canSendAgentPrompt(true, false, true, 'queue')).toBe(false);
  expect(canSendAgentPrompt(true, false, false)).toBe(false);
  expect(canSendAgentPrompt(false, false, false)).toBe(true);
  const chips = composerChipIds({
    canOpenSessions: true,
    canOpenModel: true,
    taskCount: 0,
    canOpenTasks: false,
    inboxCount: 0,
    backgroundCount: 0,
    canOpenBackground: false,
    hasContextPill: false,
    hasDiffs: false,
    running: true,
    canSendWhileRunning: true,
    canQueueWhileRunning: false,
  });
  expect(chips).not.toContain('delivery');
  expect(chips).toContain('stop');
});

test('question answers use the form reply contract and retain pending input on timeout', async () => {
  for (const outcome of ['accepted', 'timeout', 'history', 'switched', 'restarted'] as const) {
    let forms = [question];
    const sent: unknown[] = [];
    const resolvedDrafts: unknown[] = [];
    const resolvedNotices: unknown[] = [];
    let generation = 'run-1';
    const activeAsidRef = { current: 'thread' };
    const submit = callback('src/components/agent-workbench.tsx', 'handleFormSubmit', {
      forms,
      questionDraftOwner: 'owner',
      questionDrafts: { resolve: (...args: unknown[]) => resolvedDrafts.push(args) },
      gatewayGeneration: 'run-1',
      useGatewayGeneration: { getState: () => ({ byServer: { server: generation } }) },
      useInAppNotifications: {
        getState: () => ({ resolveQuestion: (value: unknown) => resolvedNotices.push(value) }),
      },
      canReplyAgentForm,
      readRuntime: () =>
        outcome === 'history' ? { source: 'terminal', interaction: 'terminal' } : native,
      activeAsid: 'thread',
      activeAsidRef,
      sessionId: 'workspace',
      serverId: 'server',
      useGatewayConnectionStore: { getState: () => ({ record: { serverId: 'server' } }) },
      replyAgentForm: async (...args: unknown[]) => {
        sent.push(args);
        if (outcome === 'timeout') throw new Error('timeout');
        if (outcome === 'switched') activeAsidRef.current = 'other-thread';
        if (outcome === 'restarted') generation = 'run-2';
      },
      setForms: (update: (previous: FormRequest[]) => FormRequest[]) => {
        forms = update(forms);
      },
      showToast: () => {},
      agentErrorRef: { current: String },
      t: (strings: string[]) => strings[0],
      console: { warn: () => {} },
    }) as (id: string, answers: Record<string, unknown>) => Promise<void>;
    await submit(question.id, { answer: 'Keep going' });
    expect(sent).toEqual(
      outcome === 'history' ? [] : [['workspace', 'thread', 'question', { answer: 'Keep going' }]]
    );
    expect(forms).toEqual(outcome === 'accepted' ? [] : [question]);
    expect(resolvedDrafts).toEqual(
      outcome === 'accepted' ? [['owner', 'question', 'answered']] : []
    );
    expect(resolvedNotices).toEqual(
      outcome === 'accepted'
        ? [{ serverId: 'server', asid: 'thread', formId: 'question', generation: 'run-1' }]
        : []
    );
  }
});

test('normal follow-ups steer the native turn, preserve staging, and report uncertain delivery as unaccepted', async () => {
  for (const outcome of ['accepted', 'timeout', 'queue', 'idle'] as const) {
    let timeline: TimelineItem[] = [];
    const sent: unknown[] = [];
    let clearedStaging = false;
    const owner = { serverId: 'server' };
    const send = callback('src/components/agent-workbench.tsx', 'dispatchPrompt', {
      isBusyStatus,
      sessionInfo: { status: outcome === 'idle' ? 'idle' : 'busy', asid: 'thread' },
      canInteractNatively: true,
      canSendAgentPrompt,
      agentFeatures: { inbox: false, extra: { promptSteering: true } },
      activeAsidRef: { current: 'thread' },
      activeDirectoryRef: { current: '/project' },
      mountedRef: { current: true },
      stagedModels: { thread: { model: 'next-model' } },
      captureWorkbenchOwner: () => owner,
      agentWorkbenchRouteMatches: () => true,
      useGatewayConnectionStore: { getState: () => ({ record: owner }) },
      sessionId: 'workspace',
      syncRef: { current: { seq: 1 } },
      transcriptStore: { getState: () => ({ timeline }) },
      orderKeyAfter: () => 'next',
      setTimeline: (update: (previous: TimelineItem[]) => TimelineItem[]) => {
        timeline = update(timeline);
      },
      setScrollToSentRow: () => {},
      setSessionInfo: () => {},
      recoverWith,
      sendAgentPrompt: async (...args: unknown[]) => {
        sent.push(args);
        if (outcome === 'timeout') throw new Error('timeout');
      },
      setStagedModels: () => {
        clearedStaging = true;
      },
      loadSnapshot: async () => {},
      showToast: () => {},
      agentErrorRef: { current: String },
      t: (strings: string[]) => strings[0],
      console: { warn: () => {} },
    }) as (text: string, attachments?: string[], delivery?: 'steer' | 'queue') => Promise<boolean>;
    const accepted = await send(
      'Continue normally',
      undefined,
      outcome === 'queue' ? 'queue' : undefined
    );
    expect(accepted).toBe(outcome === 'accepted' || outcome === 'idle');
    expect(sent).toEqual(
      outcome === 'queue'
        ? []
        : [
            [
              'workspace',
              'thread',
              {
                text: 'Continue normally',
                attachments: undefined,
                delivery: outcome === 'idle' ? undefined : 'steer',
              },
            ],
          ]
    );
    expect(clearedStaging).toBe(outcome === 'idle');
    expect(timeline.length).toBe(accepted ? 1 : 0);
  }
});

test('composer clears its draft only after accepted steering', async () => {
  for (const accepted of [true, false]) {
    let draft = 'Keep working';
    const send = callback('src/components/agent-composer.tsx', 'handleSend', {
      text: draft,
      attachmentUploads: { attachments: [], clearAttachments: () => {} },
      sending: false,
      interactionBlockedReason: undefined,
      readSlashCommand: () => null,
      commands: [],
      skills: [],
      onRunCommand: undefined,
      onInvokeSkill: undefined,
      onClientCommand: undefined,
      promptAllowed: true,
      disabled: false,
      setSending: () => {},
      settleAfter,
      onSend: async () => accepted,
      setText: (text: string) => {
        draft = text;
      },
      running: true,
      deliveryMode: 'steer',
      attachmentTargetId: undefined,
      record: undefined,
      showToast: () => {},
      t: (strings: string[]) => strings[0],
    }) as () => Promise<void>;
    await send();
    expect(draft).toBe(accepted ? '' : 'Keep working');
  }
});

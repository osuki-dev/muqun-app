import { expect, test } from 'bun:test';
import { ComposerSendGuard } from '../composer-send-guard';
import { deliverAgentAttachmentPrompt } from '../agent-attachment-send';
import {
  captureAgentPromptOwnership,
  type AgentWorkbenchOwner,
} from '../agent-workbench-ownership';
import { upsertTimelineItems, agentPromptUsesOptimisticRow } from '../agent-timeline-upsert';
import type { TimelineItem } from '../agent-protocol';

test('composer send is synchronously exclusive until its delivery settles', () => {
  const guard = new ComposerSendGuard();
  expect(guard.isPending()).toBe(false);
  const first = guard.acquire();
  expect(guard.isPending()).toBe(true);
  expect(first).not.toBeNull();
  expect(guard.acquire()).toBeNull();
  expect(guard.release(Symbol('unrelated'))).toBe(false);
  expect(guard.acquire()).toBeNull();
  expect(guard.release(first!)).toBe(true);
  expect(guard.isPending()).toBe(false);
  expect(guard.acquire()).not.toBeNull();
});

test('a completion from before session reset cannot release a newer send', () => {
  const guard = new ComposerSendGuard();
  const old = guard.acquire()!;
  guard.reset();
  const current = guard.acquire()!;
  expect(guard.owns(old)).toBe(false);
  expect(guard.release(old)).toBe(false);
  expect(guard.owns(current)).toBe(true);
  expect(guard.acquire()).toBeNull();
  expect(guard.release(current)).toBe(true);
});

test.each(['queue', 'steer', undefined] as const)(
  'attachment submission forwards the exact body and all images once (%s), canonical may precede ACK',
  async (delivery) => {
    const paths = ['/uploads/one.bin', '/uploads/two.bin'];
    const native: TimelineItem = {
      id: 'native',
      message_id: 'native',
      ordinal: 0,
      seq: 1,
      updated_ms: 1,
      role: 'user',
      part: { type: 'text', text: 'same body' },
      attachments: ['data:image/png;base64,QUFB', 'data:image/png;base64,QUFC'],
    };
    let timeline: TimelineItem[] = [];
    const submissions: unknown[] = [];
    const receipts: string[] = [];
    let acknowledge!: (accepted: boolean) => void;
    const ack = new Promise<boolean>((resolve) => {
      acknowledge = resolve;
    });
    const guard = new ComposerSendGuard();
    const token = guard.acquire()!;
    const sending = deliverAgentAttachmentPrompt(
      {
        isCurrent: () => guard.owns(token),
        send: (text, attachments, mode) => {
          submissions.push({ text, attachments, delivery: mode });
          timeline = upsertTimelineItems(timeline, [native]);
          return ack;
        },
      },
      'same body',
      async () => paths,
      () => receipts.push('acknowledged'),
      delivery
    );
    expect(agentPromptUsesOptimisticRow(paths)).toBe(false);
    await Promise.resolve();
    expect(timeline).toEqual([native]);
    expect(guard.acquire()).toBeNull();
    expect(receipts).toEqual([]);
    acknowledge(true);
    expect(await sending).toBe('accepted');
    expect(receipts).toEqual(['acknowledged']);
    expect(submissions).toEqual([{ text: 'same body', attachments: paths, delivery }]);
    expect(timeline).toEqual([native]);
    expect(guard.release(token)).toBe(true);
  }
);

test('a refused attachment submission retains the draft', async () => {
  const draft = { text: 'keep this body', attachments: ['/uploads/photo.bin'] };
  const result = await deliverAgentAttachmentPrompt(
    { isCurrent: () => true, send: async () => false },
    draft.text,
    async () => draft.attachments,
    () => {
      draft.text = '';
      draft.attachments = [];
    }
  );
  expect(result).toBe('rejected');
  expect(draft).toEqual({ text: 'keep this body', attachments: ['/uploads/photo.bin'] });
});

test('ACK before history authorizes a submission receipt, not a local user row', async () => {
  const paths = ['/uploads/photo.bin'];
  let receipt: string[] = [];
  let timeline: TimelineItem[] = [];
  expect(
    await deliverAgentAttachmentPrompt(
      { isCurrent: () => true, send: async () => true },
      'keep the body',
      async () => paths,
      () => {
        receipt = paths;
      }
    )
  ).toBe('accepted');
  expect(receipt).toEqual(paths);
  expect(timeline).toEqual([]);
  const native: TimelineItem = {
    id: 'native',
    message_id: 'native',
    ordinal: 0,
    seq: 1,
    updated_ms: 1,
    role: 'user',
    part: { type: 'text', text: 'keep the body' },
  };
  timeline = upsertTimelineItems(timeline, [native]);
  expect(timeline).toEqual([native]);
  expect(receipt).toEqual(paths);
});

test('session, route or gateway changes during uploads cannot dispatch paths to the new destination', async () => {
  const source: AgentWorkbenchOwner = {
    serverId: 'gateway',
    sessionId: 'route',
    asid: 'session-a',
    directory: '/work',
    generation: 1,
  };
  for (const replacement of [
    { ...source, asid: 'session-b' },
    { ...source, sessionId: 'other-route' },
    { ...source, serverId: 'other-gateway' },
    { ...source, generation: 2 },
  ]) {
    let current = source;
    const ownership = captureAgentPromptOwnership(
      source,
      () => current,
      () => true
    );
    let calls = 0;
    const result = await deliverAgentAttachmentPrompt(
      {
        isCurrent: ownership.isCurrent,
        send: async () => {
          calls++;
          return true;
        },
      },
      'body',
      async () => {
        current = replacement;
        return ['/uploads/photo.bin'];
      },
      () => {
        throw new Error('obsolete upload acknowledged');
      }
    );
    expect(result).toBe('obsolete');
    expect(calls).toBe(0);
  }
});

test.each([true, false])(
  'a late attachment result (%s) cannot clear a replacement draft or release its send',
  async (ack) => {
    const guard = new ComposerSendGuard();
    const old = guard.acquire()!;
    const draft = { text: 'replacement body', attachments: ['/uploads/new.bin'] };
    let newer!: symbol;
    const result = await deliverAgentAttachmentPrompt(
      {
        isCurrent: () => guard.owns(old),
        send: async () => {
          guard.reset();
          newer = guard.acquire()!;
          return ack;
        },
      },
      'old body',
      async () => ['/uploads/old.bin'],
      () => {
        draft.text = '';
        draft.attachments = [];
      }
    );
    expect(result).toBe('obsolete');
    expect(guard.release(old)).toBe(false);
    expect(guard.owns(newer)).toBe(true);
    expect(draft).toEqual({ text: 'replacement body', attachments: ['/uploads/new.bin'] });
  }
);

test.each([{ paths: null }, { paths: [] }])(
  'failed or cleared uploads (%s) retain the body without sending a body-only prompt',
  async ({ paths }) => {
    let calls = 0;
    let body = 'keep the body';
    const result = await deliverAgentAttachmentPrompt(
      {
        isCurrent: () => true,
        send: async () => {
          calls++;
          return true;
        },
      },
      body,
      async () => paths,
      () => {
        body = '';
      }
    );
    expect(result).toBe('upload-failed');
    expect(calls).toBe(0);
    expect(body).toBe('keep the body');
  }
);

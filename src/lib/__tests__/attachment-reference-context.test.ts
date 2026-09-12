import { expect, test } from 'bun:test';

import {
  addAgentImageReference,
  agentCommandTextWithReferences,
  agentReferenceContext,
  attachmentCommandText,
  attachmentReferenceContext,
  beginAgentReferenceUpload,
  createAgentReferenceDraft,
  editAgentImageReference,
  finishAgentReferenceUpload,
  referenceAttachments,
  type AgentReferenceScope,
} from '@/lib/agent-command-references';
import { annotateEntry, markUploaded, stageFiles } from '@/lib/attachment-queue';
import type { PendingAttachment, PickedFile } from '@/lib/attachment-queue';

const scope: AgentReferenceScope = {
  serverId: 's1',
  sessionId: 'sess',
  sourcePaneId: 'pane',
  connectionGeneration: 1,
};

/** The same address, in the shape each stack records it. */
const destination = {
  serverId: scope.serverId,
  sessionId: scope.sessionId,
  sourcePaneId: scope.sourcePaneId,
  connectionGeneration: scope.connectionGeneration,
};

const file = (name: string): PickedFile => ({
  uri: `file:///tmp/${name}`,
  name,
  mime: 'image/png',
  size: 1024,
});

/** The same two images, staged in each of the two queues. */
function bothQueues() {
  let draft = createAgentReferenceDraft(scope);
  let queue: PendingAttachment[] = [];
  for (const [index, name] of ['first.png', 'second.png'].entries()) {
    draft = addAgentImageReference(draft, name, file(name));
    queue = stageFiles(queue, [file(name)], destination);
    const reference = draft.images[index];
    draft = editAgentImageReference(
      draft,
      reference.id,
      index === 0 ? 'the header' : '',
      index === 0 ? 'may-include' : 'reference-only'
    );
    queue = annotateEntry(queue, queue[index].id, {
      caption: index === 0 ? 'the header' : undefined,
      use: index === 0 ? 'may-include' : undefined,
    });
    const started = beginAgentReferenceUpload(draft, reference.id, scope);
    draft = finishAgentReferenceUpload(
      started.draft,
      started.ticket,
      { path: `/uploads/${name}` },
      scope
    );
    queue = markUploaded(queue, queue[index].id, { path: `/uploads/${name}` });
  }
  return { draft, queue };
}

test('both queues produce byte-identical reference blocks', () => {
  // This equality is what makes moving collaboration onto the shared staging
  // stack checkable without a paired gateway: the bytes an agent receives do
  // not change, whichever queue assembled them.
  const { draft, queue } = bothQueues();
  expect(attachmentReferenceContext(queue)).toBe(agentReferenceContext(draft, scope));
});

test('an absent caption and use read as the safe defaults', () => {
  // The composer's own attachments carry neither field. They must land as an
  // empty caption and `reference-only`, never as undefined in the JSON.
  let queue = stageFiles([], [file('plain.png')]);
  queue = markUploaded(queue, queue[0].id, { path: '/uploads/plain.png' });
  const block = attachmentReferenceContext(queue);
  expect(JSON.parse(block.slice(block.indexOf('[{')))).toEqual([
    { path: '/uploads/plain.png', name: 'plain.png', caption: '', use: 'reference-only' },
  ]);
});

test('an empty queue contributes nothing, exactly as an empty draft does', () => {
  expect(attachmentReferenceContext([])).toBe('');
  expect(agentReferenceContext(createAgentReferenceDraft(scope), scope)).toBe('');
});

test('an upload still in flight is refused rather than sent half-formed', () => {
  const queue = stageFiles([], [file('slow.png')]);
  expect(() => attachmentReferenceContext(queue)).toThrow('References are not ready');
});

test('a finished upload with no path is refused too', () => {
  const queue = stageFiles([], [file('odd.png')]).map((entry) => ({
    ...entry,
    status: 'done' as const,
  }));
  expect(() => attachmentReferenceContext(queue)).toThrow('References are not ready');
});

test('the block keeps the order the reader staged the images in', () => {
  const { queue } = bothQueues();
  const block = attachmentReferenceContext(queue);
  const records = JSON.parse(block.slice(block.indexOf('[{'))) as { name: string }[];
  expect(records.map((record) => record.name)).toEqual(['first.png', 'second.png']);
});

test('both stacks refuse a destination that moved, with the same message', () => {
  // Parity on the safety property, not just on the bytes: a queue staged for one
  // agent must not assemble a task for another, however the task is built.
  const { draft, queue } = bothQueues();
  const moved = { ...scope, connectionGeneration: 2 };
  expect(() => agentReferenceContext(draft, moved)).toThrow('Reference destination changed');
  expect(() =>
    attachmentReferenceContext(queue, { ...destination, connectionGeneration: 2 })
  ).toThrow('Reference destination changed');
});

test('the destination is checked before an empty queue short-circuits', () => {
  // An empty task is still a task addressed somewhere, and an unbound entry
  // must not slip through by being the only one.
  const unbound = markUploaded(stageFiles([], [file('loose.png')]), 'x', { path: '/p' });
  expect(() => attachmentReferenceContext(unbound, destination)).toThrow(
    'Reference destination changed'
  );
});

test('the adapter carries a draft through the shared builder unchanged', () => {
  // The strongest statement the adapter can make: the block built from the
  // adapted queue is the block the draft itself produces, destination check
  // and all. Anything the adapter lost would show up here.
  const { draft } = bothQueues();
  expect(attachmentReferenceContext(referenceAttachments(draft), destination)).toBe(
    agentReferenceContext(draft, scope)
  );
});

test('the adapter maps every upload state onto the one the strip draws', () => {
  let draft = createAgentReferenceDraft(scope);
  draft = addAgentImageReference(draft, 'waiting', file('waiting.png'));
  expect(referenceAttachments(draft)[0].status).toBe('pending');

  const started = beginAgentReferenceUpload(draft, 'waiting', scope);
  expect(referenceAttachments(started.draft)[0].status).toBe('uploading');

  const failed = finishAgentReferenceUpload(started.draft, started.ticket, null, scope);
  expect(referenceAttachments(failed)[0].status).toBe('error');

  const retried = beginAgentReferenceUpload(failed, 'waiting', scope);
  const done = finishAgentReferenceUpload(retried.draft, retried.ticket, { path: '/p.png' }, scope);
  const [entry] = referenceAttachments(done);
  expect(entry.status).toBe('done');
  expect(entry.remotePath).toBe('/p.png');
});

test('the adapter stamps the destination the draft was scoped to', () => {
  const { draft } = bothQueues();
  for (const entry of referenceAttachments(draft)) expect(entry.destination).toEqual(destination);
});

test('an adapted draft is refused once its destination moves', () => {
  const { draft } = bothQueues();
  expect(() =>
    attachmentReferenceContext(referenceAttachments(draft), {
      ...destination,
      sourcePaneId: 'elsewhere',
    })
  ).toThrow('Reference destination changed');
});

test('the whole task text is byte-identical, not only the reference block', () => {
  // The block being equal is necessary and not sufficient: what reaches the
  // agent is prompt, terminal context, instructions and references assembled in
  // one order with one separator. `attachmentCommandText` is what the composer
  // sends through, so the equality has to hold for the assembled text.
  const { draft, queue } = bothQueues();
  for (const [prompt, context, instructions] of [
    ['Review the diff', '', undefined],
    ['Run the tests', '$ bun test\n3 pass', undefined],
    ['', '', 'Report failures with reproduction steps.'],
    ['Check this', 'tail of the pane', 'Do not edit files.'],
  ] as const) {
    expect(attachmentCommandText(prompt, context, instructions, queue, destination)).toBe(
      agentCommandTextWithReferences(prompt, context, instructions, draft, scope)
    );
  }
});

test('a task assembled from a drifted queue is refused before anything is sent', () => {
  // The composer spawns an assistant to receive this text. Building it first is
  // what keeps a queue that has moved from costing the reader an assistant that
  // then gets nothing -- so the refusal has to come from the text builder, not
  // from a check somewhere after the spawn.
  const { queue } = bothQueues();
  expect(() =>
    attachmentCommandText('Review', '', undefined, queue, {
      ...destination,
      sourcePaneId: 'another-pane',
    })
  ).toThrow();
  expect(() =>
    attachmentCommandText('Review', '', undefined, queue, {
      ...destination,
      connectionGeneration: destination.connectionGeneration + 1,
    })
  ).toThrow();
});

test('an oversized task is refused, and by the same ceiling as the other builder', () => {
  // Which layer refuses is not the point and is not pinned: `collaborationTaskText`
  // has its own limit and reaches an over-long prompt first. What matters is that
  // the two builders agree -- a task one accepts is not one the other rejects,
  // or the composer and the screen would disagree about what is sendable.
  const huge = 'x'.repeat(64 * 1024 + 1);
  const { draft } = bothQueues();
  expect(() => attachmentCommandText(huge, '', undefined, [], destination)).toThrow();
  expect(() => agentCommandTextWithReferences(huge, '', undefined, draft, scope)).toThrow();
});

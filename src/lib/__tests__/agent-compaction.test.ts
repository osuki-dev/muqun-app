import { describe, expect, test } from 'bun:test';
import {
  applyCompactionEvent,
  beginCompaction,
  reconcileCompactionTimeline,
} from '../agent-compaction';
import { parseAgentDomainEvent, parseTimelineItem } from '../agent-protocol';

/** Feed the same wire payloads as the Gateway, through the real parser. */
function event(
  seq: number,
  status: string,
  delta?: string,
  sessionId = 'session-a',
  reason?: string
) {
  const parsed = parseAgentDomainEvent('agent.compaction.changed', {
    session_id: sessionId,
    status,
    seq,
    ...(delta === undefined ? {} : { delta }),
    ...(reason === undefined ? {} : { reason }),
  });
  if (parsed?.type !== 'agent.compaction.changed') throw new Error('Invalid compaction fixture');
  return parsed;
}

function row(seq: number, part: unknown) {
  const parsed = parseTimelineItem({
    id: `boundary-${seq}`,
    message_id: `message-${seq}`,
    role: 'assistant',
    ordinal: 0,
    updated_ms: 1000,
    seq,
    part,
  });
  if (!parsed) throw new Error('Invalid timeline fixture');
  return parsed;
}

describe('real compaction summary stream', () => {
  test('no delta is status only; whitespace is not detail content', () => {
    const started = applyCompactionEvent(null, event(10, 'started'));
    expect(started?.status).toBe('running');
    expect(started?.summary).toBe('');
    const blank = applyCompactionEvent(started, event(11, 'running', ' \n'));
    expect(blank?.summary.trim()).toBe('');
    expect(applyCompactionEvent(blank, event(12, 'completed'))).toBeNull();
  });

  test('appends exact raw deltas once, keeping the original manual reason', () => {
    const started = applyCompactionEvent(
      null,
      event(10, 'started', undefined, 'session-a', 'manual')
    );
    const first = applyCompactionEvent(started, event(11, 'running', '## Objective\n'));
    const second = applyCompactionEvent(first, event(12, 'running', 'Keep the API contract.\n'));
    expect(second?.summary).toBe('## Objective\nKeep the API contract.\n');
    expect(second?.reason).toBe('manual');
    expect(second?.startedSeq).toBe(10);
    expect(applyCompactionEvent(second, event(12, 'running', 'duplicate'))).toBe(second);
    expect(applyCompactionEvent(second, event(11, 'running', 'late'))).toBe(second);
  });

  test('a new started event resets the previous summary and identity', () => {
    const previous = applyCompactionEvent(null, event(10, 'running', 'previous summary'));
    const next = applyCompactionEvent(previous, event(20, 'started'));
    expect(next?.summary).toBe('');
    expect(next?.startedSeq).toBe(20);
  });

  test('a new session never inherits text or sequence numbers from the old one', () => {
    const previous = applyCompactionEvent(null, event(100, 'running', 'private to A'));
    const next = applyCompactionEvent(previous, event(2, 'running', 'only B', 'session-b'));
    expect(next?.asid).toBe('session-b');
    expect(next?.summary).toBe('only B');
  });

  test('completed text remains accessible, static, until the real boundary exists', () => {
    const running = applyCompactionEvent(null, event(10, 'running', 'real summary'));
    const done = applyCompactionEvent(running, event(11, 'completed', '\nFinal note.'));
    expect(done?.status).toBe('completed');
    expect(done?.summary).toBe('real summary\nFinal note.');
    expect(reconcileCompactionTimeline(done, [], 'session-a')).toBe(done);
    // Some streams announce both ended and compacted; neither loses the text.
    const announcedAgain = applyCompactionEvent(done, event(12, 'completed'));
    expect(announcedAgain?.summary).toBe(done?.summary);
    expect(announcedAgain?.status).toBe('completed');
  });

  test('failure preserves partial text and remains dismissible without text too', () => {
    const running = applyCompactionEvent(null, event(10, 'running', 'partial summary'));
    const failed = applyCompactionEvent(running, event(11, 'failed'));
    expect(failed?.status).toBe('failed');
    expect(failed?.summary).toBe('partial summary');
    expect(applyCompactionEvent(null, event(10, 'failed'))?.status).toBe('failed');
  });

  test('hands off only to an actual completed compaction summary, not ordinary text', () => {
    const running = applyCompactionEvent(null, event(10, 'running', 'real summary'));
    const done = applyCompactionEvent(running, event(11, 'completed'));
    const unrelated = [
      row(12, { type: 'reasoning', text: 'Thinking about compaction' }),
      row(13, { type: 'text', text: 'Context compacted' }),
      row(14, { type: 'compaction', status: 'completed', recent: 'Not a summary' }),
    ];
    expect(reconcileCompactionTimeline(done, unrelated, 'session-a')).toBe(done);
    const boundary = row(15, { type: 'compaction', status: 'completed', summary: 'real summary' });
    expect(reconcileCompactionTimeline(done, [boundary], 'session-a')).toBeNull();
    expect(reconcileCompactionTimeline(done, [boundary], 'session-b')).toBe(done);
  });

  test('never substitutes an older compaction summary for the active stream', () => {
    const running = applyCompactionEvent(null, event(10, 'running', 'current'));
    const old = row(9, { type: 'compaction', status: 'completed', summary: 'old summary' });
    expect(reconcileCompactionTimeline(running, [old], 'session-a')).toBe(running);
    const empty = beginCompaction('session-a', 'manual', 9);
    expect(reconcileCompactionTimeline(empty, [old], 'session-a')).toBe(empty);
  });

  test('a running boundary can supply real summary content when no delta arrived', () => {
    const running = applyCompactionEvent(null, event(10, 'started'));
    const boundary = row(11, {
      type: 'compaction',
      status: 'running',
      summary: 'snapshot summary',
    });
    expect(reconcileCompactionTimeline(running, [boundary], 'session-a')?.summary).toBe(
      'snapshot summary'
    );
  });

  test('a newer running boundary never replaces raw streamed bytes or consumes later deltas', () => {
    const raw = '## 原始流 A\r\n  keep bytes  \n';
    const running = applyCompactionEvent(null, event(10, 'running', raw));
    const newer = row(20, { type: 'compaction', status: 'running', summary: 'canonical B' });
    const reconciled = reconcileCompactionTimeline(running, [newer], 'session-a');
    expect(reconciled).toBe(running);
    expect(reconciled?.summary).toBe(raw);
    expect(reconciled?.lastSeq).toBe(10);

    // The boundary revision is not a watermark for consumed stream events.
    const next = applyCompactionEvent(reconciled, event(11, 'running', '\tnew delta C\n'));
    expect(next?.summary).toBe(`${raw}\tnew delta C\n`);
    expect(next?.lastSeq).toBe(11);
    expect(applyCompactionEvent(next, event(11, 'running', '\tnew delta C\n'))).toBe(next);

    const matching = row(30, {
      type: 'compaction',
      status: 'running',
      summary: `${raw}\tnew delta C\n`,
    });
    const matched = reconcileCompactionTimeline(next, [matching], 'session-a');
    expect(matched).toBe(next);
    expect(applyCompactionEvent(matched, event(12, 'running', 'D'))?.summary).toBe(
      `${raw}\tnew delta C\nD`
    );
  });

  test('a running boundary after failure or completion preserves terminal status and raw bytes', () => {
    const raw = 'partial A\r\n  原样  \n';
    for (const status of ['failed', 'completed'] as const) {
      const running = applyCompactionEvent(null, event(10, 'running', raw));
      const terminal = applyCompactionEvent(running, event(11, status));
      const newer = row(20, { type: 'compaction', status: 'running', summary: 'canonical B' });
      const reconciled = reconcileCompactionTimeline(terminal, [newer], 'session-a');
      expect(reconciled).toBe(terminal);
      expect(reconciled?.status).toBe(status);
      expect(reconciled?.summary).toBe(raw);
      expect(reconciled?.lastSeq).toBe(11);
    }
  });

  test('canonical-only first fill and matching revisions never advance the delta cursor', () => {
    const started = applyCompactionEvent(null, event(10, 'started'));
    const first = row(20, { type: 'compaction', status: 'running', summary: 'canonical A\n' });
    const filled = reconcileCompactionTimeline(started, [first], 'session-a');
    expect(filled?.summary).toBe('canonical A\n');
    expect(filled?.lastSeq).toBe(10);
    const changed = row(21, { type: 'compaction', status: 'running', summary: 'canonical B' });
    expect(reconcileCompactionTimeline(filled, [changed], 'session-a')).toBe(filled);
    const matching = row(22, { type: 'compaction', status: 'running', summary: 'canonical A\n' });
    expect(reconcileCompactionTimeline(filled, [matching], 'session-a')).toBe(filled);
    expect(applyCompactionEvent(filled, event(10, 'started'))).toBe(filled);
    const next = applyCompactionEvent(filled, event(11, 'running', 'new raw delta\n'));
    expect(next?.summary).toBe('canonical A\nnew raw delta\n');
    expect(applyCompactionEvent(next, event(11, 'running', 'new raw delta\n'))).toBe(next);
  });

  test('a refetched historical boundary with a newer revision is not this compaction', () => {
    const old = row(9, { type: 'compaction', status: 'completed', summary: 'old summary' });
    const started = applyCompactionEvent(null, event(10, 'started'), [old]);
    const running = applyCompactionEvent(started, event(11, 'running', 'current summary'));
    // Gateway tail refetches stamp revisions; sequence alone is not run identity.
    const refetched = { ...old, seq: 12 };
    expect(reconcileCompactionTimeline(running, [refetched], 'session-a')).toBe(running);
  });

  test('a different final summary does not discard the stream text the user already saw', () => {
    const running = applyCompactionEvent(null, event(10, 'running', 'streamed summary'));
    const done = applyCompactionEvent(running, event(11, 'completed'));
    const boundary = row(12, {
      type: 'compaction',
      status: 'completed',
      summary: 'different canonical summary',
    });
    expect(reconcileCompactionTimeline(done, [boundary], 'session-a')).toBe(done);
  });

  test('a new running stream without started never inherits a terminal stream', () => {
    const running = applyCompactionEvent(null, event(10, 'running', 'old summary'));
    const done = applyCompactionEvent(running, event(11, 'completed'));
    const next = applyCompactionEvent(done, event(12, 'running', 'new summary'));
    expect(next?.summary).toBe('new summary');
    expect(next?.status).toBe('running');
    expect(next?.startedSeq).toBe(12);
  });

  test('a stale running row cannot overwrite newer streamed text or restart completion', () => {
    const first = applyCompactionEvent(null, event(10, 'running', 'first'));
    const second = applyCompactionEvent(first, event(12, 'running', ' second'));
    const stale = row(11, { type: 'compaction', status: 'running', summary: 'first' });
    expect(reconcileCompactionTimeline(second, [stale], 'session-a')).toBe(second);
    const done = applyCompactionEvent(second, event(13, 'completed'));
    expect(reconcileCompactionTimeline(done, [stale], 'session-a')?.status).toBe('completed');
  });

  test('snapshot/catch-up terminal rows stop running and preserve text on missing summary', () => {
    const running = applyCompactionEvent(null, event(10, 'running', 'retained summary'));
    const completed = row(11, { type: 'compaction', status: 'completed' });
    const recovered = reconcileCompactionTimeline(running, [completed], 'session-a');
    expect(recovered?.status).toBe('completed');
    expect(recovered?.summary).toBe('retained summary');
    const failed = row(11, { type: 'compaction', status: 'failed', error: { message: 'Failure' } });
    expect(reconcileCompactionTimeline(running, [failed], 'session-a')?.status).toBe('failed');
  });

  test('large raw text stays intact for copying; rendering is separately bounded', () => {
    const text = '真实摘要\n'.repeat(20000);
    const running = applyCompactionEvent(null, event(10, 'running', text));
    expect(running?.summary).toBe(text);
  });
});

test('failed compaction preserves a structured native error without changing reason or summary', () => {
  const parsed = parseAgentDomainEvent('agent.compaction.changed', {
    session_id: 'session-a',
    seq: 20,
    status: 'failed',
    reason: 'manual',
    error: {
      code: 'compaction_too_small',
      message: 'Nothing to compact: this session is too short.',
    },
  });
  if (parsed?.type !== 'agent.compaction.changed') throw new Error('Invalid error fixture');
  const failed = applyCompactionEvent(beginCompaction('session-a', 'manual', 19), parsed);
  expect(failed?.error?.message).toBe('Nothing to compact: this session is too short.');
  expect(failed?.reason).toBe('manual');
  expect(failed?.summary).toBe('');
  expect(applyCompactionEvent(failed, event(19, 'running'))).toBe(failed);
  expect(applyCompactionEvent(failed, event(21, 'started'))?.error).toBeUndefined();
  expect(applyCompactionEvent(null, event(22, 'failed'))?.error).toBeUndefined();
  expect(
    applyCompactionEvent(failed, event(23, 'failed', undefined, 'session-b'))?.error
  ).toBeUndefined();
});

import { describe, expect, test } from 'bun:test';

import {
  agentRevertPath,
  removeTimelineItems,
  revertedFileCount,
  revertedMessageCount,
  stagingUnsupported,
} from '../agent-revert';
import { buildTimelineGroupsCached, createTimelineGroupCache } from '../agent-timeline-groups';
import {
  LEGACY_AGENT_FEATURES,
  parseAgentDomainEvent,
  parseAgentSessionInfo,
  type TimelineItem,
} from '../agent-protocol';

function row(
  id: string,
  messageId: string,
  role: 'user' | 'assistant',
  text: string
): TimelineItem {
  return {
    id,
    message_id: messageId,
    role,
    ordinal: 0,
    seq: 1,
    updated_ms: 1,
    part: { type: 'text', text },
  };
}

const TRANSCRIPT: TimelineItem[] = [
  row('msg_1:t0', 'msg_1', 'user', 'first'),
  row('msg_2:t0', 'msg_2', 'assistant', 'answer'),
  row('msg_2:t1', 'msg_2', 'assistant', 'more'),
  row('msg_3:t0', 'msg_3', 'user', 'second'),
  row('msg_4:t0', 'msg_4', 'assistant', 'answer again'),
];

describe('revertedMessageCount', () => {
  test('the boundary and everything after it', () => {
    expect(revertedMessageCount(TRANSCRIPT, 'msg_3')).toBe(2);
    expect(revertedMessageCount(TRANSCRIPT, 'msg_1')).toBe(4);
    expect(revertedMessageCount(TRANSCRIPT, 'msg_4')).toBe(1);
  });

  test('a boundary outside the window is not guessed at', () => {
    expect(revertedMessageCount(TRANSCRIPT, 'msg_0')).toBe(0);
    expect(revertedMessageCount(TRANSCRIPT, undefined)).toBe(0);
    expect(revertedMessageCount([], 'msg_1')).toBe(0);
  });

  test('parts of one message count once', () => {
    // `msg_2` is two rows and one message.
    expect(revertedMessageCount(TRANSCRIPT, 'msg_2')).toBe(3);
  });
});

describe('revertedFileCount', () => {
  test('what the preview would put back', () => {
    expect(revertedFileCount(null)).toBe(0);
    expect(revertedFileCount({ message_id: 'msg_1' })).toBe(0);
    expect(
      revertedFileCount({
        message_id: 'msg_1',
        files: [{ path: 'a.ts', patch: '', additions: 1, deletions: 0 }],
      })
    ).toBe(1);
  });
});

describe('removeTimelineItems', () => {
  test('the committed rollback takes its rows out', () => {
    const left = removeTimelineItems(TRANSCRIPT, ['msg_3:t0', 'msg_4:t0']);
    expect(left.map((item) => item.id)).toEqual(['msg_1:t0', 'msg_2:t0', 'msg_2:t1']);
  });

  test('nothing matched is the same array, so no render is spent on it', () => {
    expect(removeTimelineItems(TRANSCRIPT, [])).toBe(TRANSCRIPT);
    expect(removeTimelineItems(TRANSCRIPT, ['msg_9:t0'])).toBe(TRANSCRIPT);
  });

  test('the groups the list draws lose them too, and keep the rest by identity', () => {
    const cache = createTimelineGroupCache();
    const before = buildTimelineGroupsCached(cache, TRANSCRIPT);
    expect(before.length).toBeGreaterThan(1);

    const after = buildTimelineGroupsCached(
      cache,
      removeTimelineItems(TRANSCRIPT, ['msg_3:t0', 'msg_4:t0'])
    );
    // No group still carries a removed row...
    const ids = after.flatMap((group) => group.items.map((item) => item.id));
    expect(ids).toEqual(['msg_1:t0', 'msg_2:t0', 'msg_2:t1']);
    // ...and the groups that survived are the same objects, so the rows above
    // the rollback do not re-render and the viewport has no reason to move.
    expect(after[0]).toBe(before[0]);
  });
});

describe('agent.revert.changed', () => {
  test('a staging carries the boundary and the files it would put back', () => {
    const event = parseAgentDomainEvent('agent.revert.changed', {
      type: 'agent.revert.changed',
      asid: 'ses_1',
      seq: 22,
      state: 'staged',
      revert: {
        message_id: 'msg_3',
        part_id: null,
        snapshot: null,
        files: [{ file: 'src/a.ts', patch: '@@', additions: 3, deletions: 1, status: 'modified' }],
      },
    });
    expect(event).toEqual({
      type: 'agent.revert.changed',
      asid: 'ses_1',
      seq: 22,
      state: 'staged',
      revert: {
        message_id: 'msg_3',
        files: [{ path: 'src/a.ts', patch: '@@', additions: 3, deletions: 1, status: 'modified' }],
      },
    });
  });

  test('committed and cleared carry nothing staged', () => {
    for (const state of ['committed', 'cleared'] as const) {
      expect(
        parseAgentDomainEvent('agent.revert.changed', {
          type: 'agent.revert.changed',
          asid: 'ses_1',
          seq: 23,
          state,
          revert: null,
        })
      ).toEqual({ type: 'agent.revert.changed', asid: 'ses_1', seq: 23, state, revert: null });
    }
  });

  test('a state this app does not know is not an event', () => {
    expect(
      parseAgentDomainEvent('agent.revert.changed', {
        type: 'agent.revert.changed',
        asid: 'ses_1',
        seq: 24,
        state: 'rewound',
      })
    ).toBeNull();
  });

  test('a session carries its staged rollback on a cold open', () => {
    const info = parseAgentSessionInfo({
      asid: 'ses_1',
      title: 'x',
      status: 'idle',
      updated_ms: 1,
      revert: { message_id: 'msg_3', files: [{ file: 'a.ts', additions: 1, deletions: 2 }] },
    });
    expect(info?.revert?.message_id).toBe('msg_3');
    expect(info?.revert?.files?.[0]).toEqual({
      path: 'a.ts',
      patch: '',
      additions: 1,
      deletions: 2,
    });
  });

  test('a boundary with no message id is not a staging', () => {
    const event = parseAgentDomainEvent('agent.revert.changed', {
      type: 'agent.revert.changed',
      asid: 'ses_1',
      seq: 25,
      state: 'staged',
      revert: { part_id: 'prt_1' },
    });
    expect(event).toEqual({
      type: 'agent.revert.changed',
      asid: 'ses_1',
      seq: 25,
      state: 'staged',
      revert: null,
    });
  });
});

describe('which rollback an agent gets', () => {
  test('an agent that can stage one stages it', () => {
    expect(agentRevertPath({ ...LEGACY_AGENT_FEATURES })).toBe('staged');
  });

  test('an agent that reverts but cannot stage goes one step, behind a confirmation', () => {
    expect(agentRevertPath({ ...LEGACY_AGENT_FEATURES, stagedRevert: false })).toBe('one-step');
  });

  test('an agent that cannot revert at all is offered nothing', () => {
    expect(agentRevertPath({ ...LEGACY_AGENT_FEATURES, revert: false })).toBeNull();
    expect(
      agentRevertPath({ ...LEGACY_AGENT_FEATURES, revert: false, stagedRevert: false })
    ).toBeNull();
  });
});

describe('a staging the agent refused as unsupported', () => {
  const failure = (status: number, code: string) =>
    new Error(
      `Failed to stage revert: ${status} ${JSON.stringify({
        error: { code, message: 'This agent does not support: stage_revert' },
      })}`
    );

  test('a 501 feature_unsupported falls back to the one-step rollback', () => {
    expect(stagingUnsupported(failure(501, 'feature_unsupported'))).toBe(true);
  });

  test('either half alone is enough', () => {
    expect(stagingUnsupported(failure(400, 'feature_unsupported'))).toBe(true);
    expect(stagingUnsupported(new Error('Failed to stage revert: 501 '))).toBe(true);
  });

  test('any other failure is reported, not worked around', () => {
    expect(stagingUnsupported(failure(502, 'agent_error'))).toBe(false);
    expect(stagingUnsupported(new Error('Failed to stage revert: 500 boom'))).toBe(false);
    expect(stagingUnsupported(new TypeError('Network request failed'))).toBe(false);
    expect(stagingUnsupported(undefined)).toBe(false);
  });
});

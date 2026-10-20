import { describe, expect, test } from 'bun:test';
import { inboxItemAttachments, parseInboxItem, type TimelineItem } from '../agent-protocol';
import { agentPromptUsesOptimisticRow, inboxTimelineRows } from '../agent-timeline-upsert';
import { createAgentTranscriptStore } from '@/stores/agent-transcript';

const UPLOAD = '/home/me/.local/share/muqun-gateway/uploads/photo-1.png';

const inbox = (id: string, payload: unknown, delivery = 'queue', type = 'user') =>
  parseInboxItem({ id, sessionID: 'ses', type, payload, delivery })!;

describe('inboxItemAttachments', () => {
  test('reads OpenCode stored files: upload path first, inline image bytes as fallback', () => {
    const item = inbox('msg_1', {
      text: 'look',
      files: [
        {
          data: 'iVBORw0KGgo=',
          mime: 'image/png',
          source: { type: 'uri', uri: `file://${UPLOAD}` },
        },
        { data: 'R0lGODlh', mime: 'image/gif', source: { type: 'inline' }, name: 'pasted.gif' },
        {
          data: 'JVBERi0=',
          mime: 'application/pdf',
          source: { type: 'uri', uri: 'file:///srv/report%20final.pdf' },
          name: 'report final.pdf',
        },
      ],
    });
    expect(inboxItemAttachments(item)).toEqual([
      { uri: UPLOAD, name: 'photo-1.png', mime: 'image/png', image: true },
      { uri: 'data:image/gif;base64,R0lGODlh', name: 'pasted.gif', mime: 'image/gif', image: true },
      {
        uri: '/srv/report final.pdf',
        name: 'report final.pdf',
        mime: 'application/pdf',
        image: false,
      },
    ]);
  });

  test('reads the Gateway queue input shape and skips unusable entries', () => {
    const item = inbox('q_1', {
      text: '',
      files: [
        { uri: `file://${UPLOAD}`, name: 'photo-1.png' },
        { uri: '/outside/notes.txt', name: 'notes.txt', mime: 'text/plain' },
        { name: 'no-source.png' },
        'junk',
        null,
      ],
    });
    expect(inboxItemAttachments(item)).toEqual([
      { uri: UPLOAD, name: 'photo-1.png', image: true },
      { uri: '/outside/notes.txt', name: 'notes.txt', mime: 'text/plain', image: false },
    ]);
    expect(inboxItemAttachments(inbox('q_2', 'plain text'))).toEqual([]);
    expect(inboxItemAttachments(inbox('q_3', { text: 'x', files: 'nope' }))).toEqual([]);
  });
});

describe('inboxTimelineRows', () => {
  const temp = (text: string): TimelineItem => ({
    id: `temp_usr_${text}`,
    message_id: 'm',
    ordinal: 0,
    seq: 1,
    updated_ms: 1,
    role: 'user',
    part: { type: 'text', text },
  });

  test('a queued send never draws an optimistic row of its own', () => {
    expect(agentPromptUsesOptimisticRow(undefined, 'queue')).toBe(false);
    expect(agentPromptUsesOptimisticRow(['/x.png'], 'steer')).toBe(false);
    expect(agentPromptUsesOptimisticRow([], 'steer')).toBe(true);
  });

  test('rows carry the inbox id and files, skip non-prompts and keep identity', () => {
    const queued = inbox('msg_a', { text: 'later', files: [{ uri: `file://${UPLOAD}` }] });
    const items = [queued, inbox('msg_b', { text: '' }, 'steer', 'compaction')];
    const rows = inboxTimelineRows(items, []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'inbox_msg_a',
      row_key: 'inbox_msg_a',
      role: 'user',
      queued: true,
      attachments: [UPLOAD],
      inbox: { id: 'msg_a', delivery: 'queue' },
    });
    expect(inboxTimelineRows(items, [])[0]).toBe(rows[0]);
  });

  test('an optimistic steer row with the same text is drawn once, one twin per row', () => {
    const items = [
      inbox('msg_1', { text: 'same' }, 'steer'),
      inbox('msg_2', { text: 'same' }, 'steer'),
      inbox('msg_3', { text: 'same', files: [{ uri: UPLOAD }] }, 'steer'),
    ];
    const rows = inboxTimelineRows(items, [temp('same')]);
    expect(rows.map((row) => row.inbox?.id)).toEqual(['msg_2', 'msg_3']);
  });

  test('the transcript draws queued rows after the history and keeps streaming on history', () => {
    const store = createAgentTranscriptStore();
    const answer: TimelineItem = {
      id: 'answer',
      message_id: 'answer',
      ordinal: 0,
      seq: 1,
      updated_ms: 1,
      role: 'assistant',
      part: { type: 'text', text: 'working' },
    };
    store.getState().setTimeline([answer]);
    store.getState().configure({ windowStart: 0, status: 'busy' });
    store.getState().setInbox([inbox('msg_q', { text: 'next one' })]);
    expect(store.getState().keys).toEqual(['grp_answer', 'grp_inbox_msg_q']);
    expect(store.getState().streamingKey).toBe('grp_answer');
    store.getState().setInbox([]);
    expect(store.getState().keys).toEqual(['grp_answer']);
  });
});

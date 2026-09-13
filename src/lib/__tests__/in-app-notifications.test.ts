import { describe, expect, test } from 'bun:test';

import {
  dismissNotice,
  enqueueNotice,
  MAX_NOTICES,
  MAX_SEEN_NOTICES,
  noticeFromPush,
  noticePresentation,
  type InAppNotice,
  type NoticeQueue,
} from '../in-app-notifications';

const notice = (id: string): InAppNotice => ({ id, title: `Event ${id}`, body: '', route: null });
const empty = (): NoticeQueue => ({ items: [], seen: [] });

describe('foreground notification queue', () => {
  test('new events queue behind the visible notice without mutating the input', () => {
    const first = enqueueNotice(empty(), notice('first'));
    const before = structuredClone(first);
    const next = enqueueNotice(first, notice('second'));
    expect(first).toEqual(before);
    expect(next.items.map((item) => item.id)).toEqual(['first', 'second']);
    expect(next.items[0]).toBe(first.items[0]);
    expect(next.seen).toEqual(['first', 'second']);
  });

  test('empty and repeated identifiers are ignored, including after dismissal', () => {
    const first = enqueueNotice(empty(), notice('first'));
    expect(enqueueNotice(first, notice(''))).toBe(first);
    expect(enqueueNotice(first, { ...notice('first'), body: 'Changed duplicate' })).toBe(first);
    const dismissed = dismissNotice(first, 'first');
    expect(dismissed.items).toEqual([]);
    expect(enqueueNotice(dismissed, notice('first'))).toBe(dismissed);
  });

  test('overflow preserves the visible event and drops the oldest waiting event', () => {
    let queue = empty();
    for (let index = 0; index < MAX_NOTICES; index++) {
      queue = enqueueNotice(queue, notice(String(index)));
    }
    const visible = queue.items[0];
    queue = enqueueNotice(queue, notice('newest'));
    expect(queue.items).toHaveLength(MAX_NOTICES);
    expect(queue.items[0]).toBe(visible);
    expect(queue.items[1].id).toBe('2');
    expect(queue.items.at(-1)?.id).toBe('newest');
    expect(queue.seen).toContain('1');
  });

  test('receipt history is bounded; identifiers older than the window may return', () => {
    let queue = empty();
    for (let index = 0; index <= MAX_SEEN_NOTICES; index++) {
      const id = String(index);
      queue = dismissNotice(enqueueNotice(queue, notice(id)), id);
    }
    expect(queue.items).toEqual([]);
    expect(queue.seen).toHaveLength(MAX_SEEN_NOTICES);
    expect(queue.seen[0]).toBe('1');
    expect(queue.seen.at(-1)).toBe(String(MAX_SEEN_NOTICES));
    expect(enqueueNotice(queue, notice('0')).items.map((item) => item.id)).toEqual(['0']);
  });

  test('an outstanding visible notice stays deduplicated after its receipt history expires', () => {
    let queue = enqueueNotice(empty(), notice('visible'));
    for (let index = 0; index < MAX_SEEN_NOTICES; index++) {
      queue = enqueueNotice(queue, notice(String(index)));
    }
    expect(queue.seen).not.toContain('visible');
    expect(queue.items[0].id).toBe('visible');
    expect(enqueueNotice(queue, notice('visible'))).toBe(queue);
  });

  test('dismissal advances only the requested item and retains receipt history', () => {
    const queue = enqueueNotice(enqueueNotice(empty(), notice('a')), notice('b'));
    const before = structuredClone(queue);
    expect(dismissNotice(queue, 'missing')).toEqual(queue);
    const next = dismissNotice(queue, 'a');
    expect(next.items.map((item) => item.id)).toEqual(['b']);
    expect(next.seen).toBe(queue.seen);
    expect(queue).toEqual(before);
  });
});

describe('push content conversion', () => {
  test('rejects invalid identifiers and content with no readable text', () => {
    expect(noticeFromPush('', { title: 'Event' })).toBeNull();
    expect(noticeFromPush('x'.repeat(513), { title: 'Event' })).toBeNull();
    expect(noticeFromPush('x'.repeat(512), { title: 'Event' })).not.toBeNull();
    expect(noticeFromPush('empty', {})).toBeNull();
    expect(noticeFromPush('control', { title: '\u202e\u0000', body: ' \t ' })).toBeNull();
    expect(noticeFromPush('wrong-types', { title: 42, body: { text: 'Event' } })).toBeNull();
  });

  test('body-only and title-only notices remain useful without a destination', () => {
    expect(noticeFromPush('body', { body: 'Agent needs attention' })).toEqual({
      id: 'body',
      title: '',
      body: 'Agent needs attention',
      route: null,
    });
    expect(noticeFromPush('title', { title: 'Update' })).toEqual({
      id: 'title',
      title: 'Update',
      body: '',
      route: null,
    });
  });

  test('removes invisible controls and flattens title lines while preserving body lines', () => {
    const converted = noticeFromPush('safe', {
      title: '  Agent\r\nneeds\u2028attention\u202e\u0000  ',
      body: '  First\r\nSecond\tline\u2066  ',
    });
    expect(converted?.title).toBe('Agent needs attention');
    expect(converted?.body).toBe('First\nSecond line');
  });

  test('bounds both text fields without splitting Unicode code points', () => {
    const converted = noticeFromPush('long', { title: '🌸'.repeat(121), body: '🌙'.repeat(321) });
    expect(Array.from(converted!.title)).toHaveLength(120);
    expect(Array.from(converted!.body)).toHaveLength(320);
    expect(converted?.title).toBe(`${'🌸'.repeat(119)}…`);
    expect(converted?.body).toBe(`${'🌙'.repeat(319)}…`);
  });

  test('server destinations stay structured and retain the receipt identifier', () => {
    const content = {
      title: 'Approval needed',
      data: { server_id: 'server', session_id: 'herdr', pane_id: 'w1:p2', url: '/settings' },
    };
    const before = structuredClone(content);
    expect(noticeFromPush('receipt', content)?.route).toEqual({
      pathname: '/servers/[serverId]',
      params: {
        serverId: 'server',
        sessionId: 'herdr',
        paneId: 'w1:p2',
        notificationId: 'receipt',
      },
    });
    expect(content).toEqual(before);
  });

  test('supports camel-case server fields and internal route fallbacks', () => {
    expect(
      noticeFromPush('camel', { title: 'Event', data: { serverId: ' server ' } })?.route
    ).toEqual({
      pathname: '/servers/[serverId]',
      params: { serverId: 'server', notificationId: 'camel' },
    });
    expect(noticeFromPush('local', { title: 'Event', data: { url: '/settings' } })?.route).toBe(
      '/settings'
    );
  });

  test('external or malformed fallback links never become banner actions', () => {
    for (const url of [
      'https://example.invalid',
      '//example.invalid',
      'javascript:alert(1)',
      '/https://example.invalid',
      42,
      null,
    ]) {
      expect(noticeFromPush('external', { title: 'Event', data: { url } })?.route).toBeNull();
    }
  });
});

describe('presentation policy', () => {
  test('foreground uses the app only, background uses the system only', () => {
    expect(noticePresentation(true, true)).toEqual({ inApp: true, system: false });
    expect(noticePresentation(true, false)).toEqual({ inApp: false, system: true });
  });

  test('disabled notifications suppress both paths in either lifecycle state', () => {
    expect(noticePresentation(false, true)).toEqual({ inApp: false, system: false });
    expect(noticePresentation(false, false)).toEqual({ inApp: false, system: false });
  });
});

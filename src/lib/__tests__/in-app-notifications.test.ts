import { describe, expect, test } from 'bun:test';
import { useInAppNotifications } from '../../stores/in-app-notifications';

import {
  noticeDisplayTitle,
  dismissNotice,
  dismissNoticeKind,
  dismissSessionQuestions,
  enqueueNotice,
  MAX_NOTICES,
  MAX_SEEN_NOTICES,
  noticeFromPush,
  noticePresentation,
  noticeTitleParts,
  noticeAutoDismissDelay,
  type InAppNotice,
  type NoticeQueue,
  attributePush,
  resolveQuestionNotice,
  reopenQuestionNotice,
} from '../in-app-notifications';

const notice = (id: string): InAppNotice => ({
  id,
  title: `Event ${id}`,
  body: '',
  route: null,
  kind: 'general',
});
const empty = (): NoticeQueue => ({ items: [], seen: [] });

test('Clear all retains receipts and question resolution state across late callbacks and fresh arrivals', () => {
  const previous = useInAppNotifications.getState();
  useInAppNotifications.setState({ items: [], seen: [], resolvedQuestions: [] });
  try {
    const store = useInAppNotifications.getState();
    const question = { serverId: 'studio', asid: 'session', formId: 'form', generation: 'run' };
    const pending: InAppNotice = {
      ...notice('pending'),
      kind: 'approval',
      body: 'Choose a deployment target.',
      question,
    };
    const before = structuredClone(pending);
    store.enqueue(pending);
    store.enqueue({ ...notice('permission'), kind: 'approval' });
    store.resolveQuestion({ ...question, formId: 'answered' });
    const receipts = useInAppNotifications.getState().seen;
    const resolutions = useInAppNotifications.getState().resolvedQuestions;
    store.clear();
    expect(useInAppNotifications.getState().items).toEqual([]);
    expect(useInAppNotifications.getState().seen).toBe(receipts);
    expect(useInAppNotifications.getState().resolvedQuestions).toBe(resolutions);
    expect(pending).toEqual(before);

    store.enqueue(pending);
    expect(useInAppNotifications.getState().items).toEqual([]);
    const fresh = { ...pending, id: 'fresh-pending' };
    store.enqueue(fresh);
    // A timeout or completed swipe captured before Clear all cannot remove a fresh receipt.
    store.dismiss('pending');
    store.dismiss('permission');
    expect(useInAppNotifications.getState().items).toEqual([fresh]);
    store.clear();
    store.resolveQuestion(question);
    store.enqueue({ ...pending, id: 'late-resolved' });
    expect(useInAppNotifications.getState().items).toEqual([]);
    store.reopenQuestion(question);
    expect(useInAppNotifications.getState().items).toEqual([]);
    store.enqueue({ ...pending, id: 'authoritative-pending' });
    expect(useInAppNotifications.getState().items[0]?.id).toBe('authoritative-pending');
  } finally {
    useInAppNotifications.setState(previous, true);
  }
});

test('Clear all keeps bounded seen IDs and accepts arrivals on either side of the clear', () => {
  const previous = useInAppNotifications.getState();
  useInAppNotifications.setState({ items: [], seen: [], resolvedQuestions: [] });
  try {
    const store = useInAppNotifications.getState();
    for (let index = 0; index < MAX_SEEN_NOTICES + 5; index++)
      store.enqueue(notice(`event-${index}`));
    store.clear();
    expect(useInAppNotifications.getState().seen).toHaveLength(MAX_SEEN_NOTICES);
    store.enqueue(notice(`event-${MAX_SEEN_NOTICES + 4}`));
    expect(useInAppNotifications.getState().items).toEqual([]);
    store.enqueue(notice('after-clear'));
    expect(useInAppNotifications.getState().items.map((item) => item.id)).toEqual(['after-clear']);
    store.clear();
    store.clear();
    store.enqueue(notice('after-repeated-clear'));
    expect(useInAppNotifications.getState().items.map((item) => item.id)).toEqual([
      'after-repeated-clear',
    ]);
  } finally {
    useInAppNotifications.setState(previous, true);
  }
});

describe('notice display wording', () => {
  const labels = { question: 'Needs your input', approval: 'Approval required', fallback: 'Muqun' };

  test('typed questions use reader-facing wording without losing the computer or altering the source', () => {
    const entry: InAppNotice = {
      ...notice('form'),
      title: 'Agent blocked · Studio',
      kind: 'approval',
      question: { asid: 'session', formId: 'form' },
    };
    expect(noticeDisplayTitle(entry, labels)).toEqual({
      lead: 'Needs your input',
      suffix: 'Studio',
    });
    expect(entry.title).toBe('Agent blocked · Studio');
    expect(noticeAutoDismissDelay(entry.kind, true)).toBeNull();
  });

  test('approval prose remains approval even when it is not a parsed OpenCode rule', () => {
    expect(
      noticeDisplayTitle(
        { ...notice('permission'), title: 'APPROVAL REQUIRED · Studio', kind: 'approval' },
        labels
      )
    ).toEqual({ lead: 'Approval required', suffix: 'Studio' });
  });

  test('untyped blocked and error events never become ordinary questions', () => {
    for (const lead of ['Agent blocked', 'Agent error', 'Connection failed']) {
      const entry = { ...notice('status'), title: `${lead} · Studio` };
      expect(noticeDisplayTitle(entry, labels)).toEqual({ lead, suffix: 'Studio' });
      expect(noticeAutoDismissDelay(entry.kind, true)).toBe(2000);
    }
  });
});

test('only visible general notices expire after two seconds', () => {
  expect(noticeAutoDismissDelay('general', true)).toBe(2000);
  expect(noticeAutoDismissDelay('approval', true)).toBeNull();
  expect(noticeAutoDismissDelay('general', false)).toBeNull();
  expect(noticeAutoDismissDelay(undefined, true)).toBeNull();
});

test('expiring the visible notice preserves pending approval and queued updates', () => {
  const first = notice('done');
  const approval = { ...notice('permission'), kind: 'approval' as const };
  const next = notice('next');
  const queue = [first, approval, next].reduce(enqueueNotice, empty());
  const expired = dismissNotice(queue, first.id);
  expect(expired.items).toEqual([approval, next]);
  expect(enqueueNotice(expired, first)).toBe(expired);
});

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

  test('matching general events keep only the latest content without moving the card', () => {
    const first = noticeFromPush('first', {
      title: 'Agent done · studio',
      body: 'codex finished running.',
      data: { server_id: 'server', session_id: 'session', pane_id: 'pane' },
    })!;
    const latest = noticeFromPush('latest', {
      title: 'Agent done · studio',
      body: 'codex finished running.',
      data: { server_id: 'server', session_id: 'session', pane_id: 'pane' },
    })!;
    const queue = enqueueNotice(enqueueNotice(empty(), first), latest);

    expect(queue.items).toHaveLength(1);
    expect(queue.items[0]?.id).toBe('first');
    expect(queue.items[0]?.route).toMatchObject({
      params: { notificationId: 'latest' },
    });
    expect(queue.seen).toEqual(['first', 'latest']);
  });

  test('different agents, destinations and approval requests remain distinct', () => {
    const base = {
      title: 'Agent done · studio',
      body: 'codex finished running.',
      data: { server_id: 'server', session_id: 'session', pane_id: 'pane' },
    };
    let queue = enqueueNotice(empty(), noticeFromPush('base', base)!);
    queue = enqueueNotice(
      queue,
      noticeFromPush('agent', { ...base, body: 'claude finished running.' })!
    );
    queue = enqueueNotice(
      queue,
      noticeFromPush('destination', { ...base, data: { ...base.data, pane_id: 'other' } })!
    );
    queue = enqueueNotice(
      queue,
      noticeFromPush('approval-a', {
        title: 'Approval required',
        body: 'external_directory: /etc/*',
        data: { ...base.data, category: 'approval', approval_id: 'a' },
      })!
    );
    queue = enqueueNotice(
      queue,
      noticeFromPush('approval-b', {
        title: 'Approval required',
        body: 'external_directory: /etc/*',
        data: { ...base.data, category: 'approval', approval_id: 'b' },
      })!
    );

    expect(queue.items.map((item) => item.id)).toEqual([
      'base',
      'agent',
      'destination',
      'approval-a',
      'approval-b',
    ]);
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
      kind: 'general',
    });
    expect(noticeFromPush('title', { title: 'Update' })).toEqual({
      id: 'title',
      title: 'Update',
      body: '',
      route: null,
      kind: 'general',
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

describe('push attribution', () => {
  const paired = [
    { serverId: 'a', label: 'Alpha' },
    { serverId: 'b', label: 'Beta' },
  ];
  const owner = (asid: string) => (asid === 'ses_b' ? 'b' : undefined);
  test.each([
    ['a paired computer about its own session', 'a', 'ses_a', 'Agent blocked · Alpha', 'a'],
    ['a session the other computer ledger bound', 'a', 'ses_b', 'Agent blocked · Beta', 'b'],
    ['a computer no longer paired', 'gone', 'ses_b', null, null],
  ])('%s', (_name, serverId, asid, title, routed) => {
    const answer = attributePush(
      { title: 'Agent blocked · Alpha', data: { server_id: serverId, asid } },
      paired,
      owner
    );
    expect(answer?.title ?? null).toBe(title);
    expect(answer?.data?.server_id ?? null).toBe(routed);
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

describe('approval notices', () => {
  test('a push tagged as an approval is marked as one', () => {
    expect(
      noticeFromPush('a1', { title: 'APPROVAL REQUIRED', data: { categoryId: 'approval' } })?.kind
    ).toBe('approval');
    expect(
      noticeFromPush('a2', { title: 'Waiting', data: { type: 'approval.pending' } })?.kind
    ).toBe('approval');
    // What an agent permission actually arrives as, measured on the wire.
    expect(
      noticeFromPush('a4', {
        title: 'Approval Required',
        body: 'external_directory: /etc/*',
        data: { category: 'approval', type: 'approval', approval_id: 'per_1' },
      })?.kind
    ).toBe('approval');
    expect(noticeFromPush('a3', { title: 'Build finished' })?.kind).toBe('general');
  });

  test('they all go when nothing is waiting any more, and nothing else does', () => {
    const queue: NoticeQueue = {
      items: [
        { id: 'a', title: 'Approval', body: '', route: null, kind: 'approval' },
        { id: 'b', title: 'Done', body: '', route: null, kind: 'general' },
        { id: 'c', title: 'Approval', body: '', route: null, kind: 'approval' },
      ],
      seen: ['a', 'b', 'c'],
    };
    const next = dismissNoticeKind(queue, 'approval');
    expect(next.items.map((item) => item.id)).toEqual(['b']);
    // Still seen, so a late duplicate of the same receipt stays dismissed.
    expect(next.seen).toEqual(['a', 'b', 'c']);
  });

  test('a queue with none of that kind is returned untouched', () => {
    const queue: NoticeQueue = {
      items: [{ id: 'b', title: 'Done', body: '', route: null, kind: 'general' }],
      seen: ['b'],
    };
    expect(dismissNoticeKind(queue, 'approval')).toBe(queue);
  });
});

describe('notice title', () => {
  test("the gateway's middle dot separates the event from where it happened", () => {
    expect(noticeTitleParts('Agent done \u00b7 studio')).toEqual({
      lead: 'Agent done',
      suffix: 'studio',
    });
  });

  test('only the first separator counts, so a suffix keeps its own dots', () => {
    expect(noticeTitleParts('Agent done \u00b7 studio \u00b7 claude')).toEqual({
      lead: 'Agent done',
      suffix: 'studio \u00b7 claude',
    });
  });

  test('a title with no separator is drawn whole, in one weight', () => {
    expect(noticeTitleParts('Approval required')).toEqual({
      lead: 'Approval required',
      suffix: '',
    });
    expect(noticeTitleParts('')).toEqual({ lead: '', suffix: '' });
  });

  test('a separator with nothing on one side of it is not a split', () => {
    expect(noticeTitleParts('Agent done \u00b7 ')).toEqual({
      lead: 'Agent done \u00b7',
      suffix: '',
    });
    expect(noticeTitleParts(' \u00b7 studio')).toEqual({ lead: '\u00b7 studio', suffix: '' });
  });
});

describe('question pushes', () => {
  const data = {
    type: 'question',
    category: 'question',
    form_id: 'form-1',
    fingerprint: 'fp-1',
    server_id: 'server-1',
    asid: 'asid-1',
    agent_id: 'claude',
  };

  test('a question with no title shows the needs-your-input title and opens the session', () => {
    const notice = noticeFromPush(
      'q-1',
      { data },
      { isPad: false, questionTitle: 'Needs your input' }
    );
    expect(notice).toMatchObject({
      title: 'Needs your input',
      kind: 'approval',
      question: { asid: 'asid-1', formId: 'form-1' },
      route: {
        pathname: '/agent',
        params: { server: 'server-1', asid: 'asid-1', agentId: 'claude' },
      },
    });
  });

  test('the gateway title wins and a Pad gets the workspace route', () => {
    const notice = noticeFromPush(
      'q-2',
      { title: 'Claude needs your input · studio', body: 'Which branch?', data },
      { isPad: true, questionTitle: 'Needs your input' }
    );
    expect(notice?.title).toBe('Claude needs your input · studio');
    expect(notice?.route).toEqual({
      pathname: '/servers/[serverId]',
      params: { serverId: 'server-1', asid: 'asid-1', agentId: 'claude' },
    });
  });

  test('questions about different sessions are separate cards', () => {
    const a = noticeFromPush('q-a', { title: 'Needs your input', data })!;
    const b = noticeFromPush('q-b', {
      title: 'Needs your input',
      data: { ...data, asid: 'asid-2' },
    })!;
    expect(enqueueNotice(enqueueNotice(empty(), a), b).items).toHaveLength(2);
  });

  test('a question stays on screen like an approval', () => {
    const notice = noticeFromPush('q-s', { title: 'Needs your input', data })!;
    expect(noticeAutoDismissDelay(notice.kind, true)).toBeNull();
  });

  test('the same question asked again replaces its card', () => {
    const first = noticeFromPush('q-1', { title: 'Needs your input', data })!;
    const again = noticeFromPush('q-2', { title: 'Needs your input', data })!;
    const other = noticeFromPush('q-3', {
      title: 'Needs your input',
      data: { ...data, form_id: 'form-2' },
    })!;
    const queue = enqueueNotice(enqueueNotice(enqueueNotice(empty(), first), other), again);
    expect(queue.items.map((item) => item.id)).toEqual(['q-3', 'q-2']);
  });

  test('opening the session dismisses its questions only', () => {
    let queue = enqueueNotice(empty(), noticeFromPush('q-1', { title: 'Q', data })!);
    queue = enqueueNotice(
      queue,
      noticeFromPush('q-2', { title: 'Q', data: { ...data, asid: 'asid-2' } })!
    );
    expect(
      dismissSessionQuestions(queue, 'asid-1', 'server-1').items.map((item) => item.id)
    ).toEqual(['q-2']);
  });

  test('an answered approval leaves questions on screen', () => {
    let queue = enqueueNotice(empty(), noticeFromPush('q-1', { title: 'Q', data })!);
    queue = enqueueNotice(
      queue,
      noticeFromPush('ap-1', {
        title: 'Approval required',
        body: 'bash: ls',
        data: { category: 'approval', server_id: 'server-1', asid: 'asid-1' },
      })!
    );
    expect(dismissNoticeKind(queue, 'approval').items.map((item) => item.id)).toEqual(['q-1']);
  });
});

describe('resolved question notifications', () => {
  const identity = { serverId: 'server', asid: 'thread', formId: 'form', generation: 'run-1' };
  const question = (id: string, overrides = {}) => ({
    ...notice(id),
    kind: 'approval' as const,
    question: { ...identity, ...overrides },
  });

  test('explicit resolution removes only the exact source question and rejects delayed pushes', () => {
    const entries = [
      question('answered'),
      question('other-form', { formId: 'next' }),
      question('other-server', { serverId: 'peer' }),
      question('other-thread', { asid: 'other' }),
      question('other-generation', { generation: 'run-2' }),
      { ...notice('permission'), kind: 'approval' as const },
    ];
    const queue = entries.reduce(enqueueNotice, empty());
    const resolved = resolveQuestionNotice(queue, identity);
    expect(resolved.items.map((item) => item.id)).toEqual(entries.slice(1).map((item) => item.id));
    expect(enqueueNotice(resolved, question('delayed'))).toBe(resolved);
    expect(
      enqueueNotice(reopenQuestionNotice(resolved, identity), question('reopened')).items.at(-1)?.id
    ).toBe('reopened');
  });

  test('resolution before push is remembered and cannot silence a different process', () => {
    const resolved = resolveQuestionNotice(empty(), identity);
    expect(enqueueNotice(resolved, question('late')).items).toEqual([]);
    expect(
      enqueueNotice(resolved, question('new-run', { generation: 'run-2' })).items
    ).toHaveLength(1);
    expect(resolveQuestionNotice(resolved, { ...identity, serverId: undefined })).toBe(resolved);
  });

  test('question replacement and visit dismissal cannot cross paired servers', () => {
    const queue = [question('local'), question('peer', { serverId: 'peer' })].reduce(
      enqueueNotice,
      empty()
    );
    expect(queue.items).toHaveLength(2);
    expect(dismissSessionQuestions(queue, 'thread', 'server').items.map((item) => item.id)).toEqual(
      ['peer']
    );
  });

  test('resolution memory is bounded and ordinary events retain it', () => {
    let queue = empty();
    for (let i = 0; i < MAX_SEEN_NOTICES + 5; i++)
      queue = resolveQuestionNotice(queue, { ...identity, formId: String(i) });
    expect(queue.resolvedQuestions).toHaveLength(MAX_SEEN_NOTICES);
    const ordinary = enqueueNotice(queue, notice('ordinary'));
    expect(ordinary.resolvedQuestions).toBe(queue.resolvedQuestions);
  });

  test('question attribution uses its source pairing label, never another ledger with the same asid', () => {
    const paired = [
      { serverId: 'local', label: 'osk local' },
      { serverId: 'other', label: 'osk' },
    ];
    const source = {
      title: 'Needs your input · osk',
      data: { type: 'question', server_id: 'local', asid: 'thread', form_id: 'form' },
    };
    const attributed = attributePush(source, paired, () => 'other')!;
    expect(attributed.title).toBe('Needs your input · osk local');
    expect(attributed.data?.server_id).toBe('local');
    expect(
      noticeFromPush('question', attributed, { gatewayGeneration: 'run-1' })?.question
    ).toEqual({ ...identity, serverId: 'local' });
  });
});

import { describe, expect, mock, test } from 'bun:test';

// The Lingui macro is compiled away in the app; here it reads as the source text.
const interpolate = (strings: TemplateStringsArray, ...values: unknown[]) =>
  strings.reduce((out, part, i) => out + part + (i < values.length ? String(values[i]) : ''), '');
mock.module('@lingui/core/macro', () => ({
  t: interpolate,
  plural: interpolate,
  msg: (strings: TemplateStringsArray, ...values: unknown[]) => {
    const message = interpolate(strings, ...values);
    return { id: message, message };
  },
}));

const { describeGatewayFailure } = await import('../network-error');
const { parseTerminalDiscovery } = await import('../agent-protocol');
const {
  backendPagesHistory,
  canOfferHistoryPull,
  historyPullBlockedAfter,
  historyPullNotice,
  pullEarlierPage,
  HISTORY_EXHAUSTED_NOTICE_MS,
} = await import('../terminal-history-pull');

// What the gateway answers when its tmux adapter cannot serve a read: the
// Mac's tmux has no `capture-pane -F`, and every range read came back this.
const BACKEND_ERROR = new Error(
  'HTTP 502: {"error":{"code":"backend_error","message":"terminal backend request failed"}}'
);
const NOT_FOUND = new Error(
  'HTTP 404: {"error":{"code":"backend_target_not_found","message":"terminal target not found"}}'
);
const NETWORK = new Error('Network request failed');
const UNAUTHORIZED = new Error('HTTP 401: {"error":{"code":"invalid_token","message":"nope"}}');

type Read = { output: string; read: unknown };
const tailRead: Read = { output: 'tail', read: { output: 'tail' } };
const rangeRead = (start: number): Read => ({
  output: 'range',
  read: { output: 'range', range: { start, end: start + 240, total: 5000 } },
});
const servedStart = (read: unknown) =>
  (read as { range?: { start: number } } | null)?.range?.start ?? null;

/** A reader that answers from a script, one entry per call, and counts its calls. */
function scripted(answers: (Read | Error)[]) {
  const calls = { count: 0 };
  const read = async () => {
    const answer = answers[calls.count++];
    if (!answer) throw new Error('unexpected call');
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { read, calls };
}

const PAGE = { start: 4520, end: 4760 };

describe('gateway error mapping for a pull', () => {
  test('a backend_error is a retryable server failure carrying the gateway reason', () => {
    const failure = describeGatewayFailure(BACKEND_ERROR);
    expect(failure.kind).toBe('server');
    expect(failure.retryable).toBe(true);
    expect(failure.message).toBe('terminal backend request failed');
  });

  test('the notice leads with the app sentence and keeps the raw reason as the caption', () => {
    const notice = historyPullNotice({
      kind: 'failed',
      failure: describeGatewayFailure(BACKEND_ERROR),
      rangeUnsupported: true,
    });
    expect(notice?.title).toBe('Could not load older history from this terminal');
    expect(notice?.caption).toBe('terminal backend request failed');
    expect(notice?.retry).toBe(true);
    expect(notice?.kind).toBe('failed');
  });

  test('no Retry when pairing again is the remedy', () => {
    const notice = historyPullNotice({
      kind: 'failed',
      failure: describeGatewayFailure(UNAUTHORIZED),
      rangeUnsupported: false,
    });
    expect(notice?.retry).toBe(false);
  });

  test('a refusal says there is no more history, once, without Retry', () => {
    const notice = historyPullNotice({
      kind: 'refused',
      failure: describeGatewayFailure(NOT_FOUND),
      rangeUnsupported: true,
    });
    expect(notice).toEqual({
      kind: 'exhausted',
      title: 'This terminal has no more history',
      caption: null,
      retry: false,
      dismissMs: HISTORY_EXHAUSTED_NOTICE_MS,
    });
  });

  test('a landed page has nothing to say', () => {
    expect(
      historyPullNotice({
        kind: 'page',
        fetched: tailRead,
        origin: 'page',
        rangeUnsupported: false,
      })
    ).toBeNull();
  });
});

describe('pullEarlierPage', () => {
  test('an honoured range is the page, and the tail is never asked', async () => {
    const range = scripted([rangeRead(PAGE.start)]);
    const tail = scripted([]);
    const outcome = await pullEarlierPage({
      page: PAGE,
      readRange: range.read,
      readTail: tail.read,
      servedStart,
    });
    expect(outcome).toMatchObject({ kind: 'page', origin: 'rangePage', rangeUnsupported: false });
    expect(tail.calls.count).toBe(0);
  });

  test('a range the backend refuses (502) falls through to the tail on the same pull', async () => {
    const range = scripted([BACKEND_ERROR]);
    const tail = scripted([tailRead]);
    const outcome = await pullEarlierPage({
      page: PAGE,
      readRange: range.read,
      readTail: tail.read,
      servedStart,
    });
    expect(outcome).toEqual({
      kind: 'page',
      fetched: tailRead,
      origin: 'page',
      rangeUnsupported: true,
    });
    // The refusal is an answer: not asked a second time.
    expect(range.calls.count).toBe(1);
  });

  test('a range answered with the backend tail is remembered as unsupported', async () => {
    const range = scripted([rangeRead(4760)]);
    const tail = scripted([tailRead]);
    const outcome = await pullEarlierPage({
      page: PAGE,
      readRange: range.read,
      readTail: tail.read,
      servedStart,
    });
    expect(outcome).toMatchObject({ kind: 'page', origin: 'page', rangeUnsupported: true });
  });

  test('a range lost in transit is retried once, and the retry can land', async () => {
    const range = scripted([NETWORK, rangeRead(PAGE.start)]);
    const outcome = await pullEarlierPage({
      page: PAGE,
      readRange: range.read,
      readTail: scripted([]).read,
      servedStart,
    });
    expect(outcome).toMatchObject({ kind: 'page', origin: 'rangePage', rangeUnsupported: false });
    expect(range.calls.count).toBe(2);
  });

  test('a range lost in transit twice fails, without condemning range addressing', async () => {
    const range = scripted([NETWORK, NETWORK]);
    const tail = scripted([]);
    const outcome = await pullEarlierPage({
      page: PAGE,
      readRange: range.read,
      readTail: tail.read,
      servedStart,
    });
    expect(outcome).toMatchObject({ kind: 'failed', rangeUnsupported: false });
    expect(tail.calls.count).toBe(0);
  });

  test('a transient tail failure is retried once and the retry can land', async () => {
    const tail = scripted([BACKEND_ERROR, tailRead]);
    const outcome = await pullEarlierPage({
      page: null,
      readRange: scripted([]).read,
      readTail: tail.read,
      servedStart,
    });
    expect(outcome).toMatchObject({ kind: 'page', origin: 'page' });
    expect(tail.calls.count).toBe(2);
  });

  test('the tail failing twice ends as failed -- a notice, never a third request', async () => {
    const tail = scripted([BACKEND_ERROR, BACKEND_ERROR]);
    const outcome = await pullEarlierPage({
      page: PAGE,
      readRange: scripted([BACKEND_ERROR]).read,
      readTail: tail.read,
      servedStart,
    });
    expect(outcome.kind).toBe('failed');
    expect(outcome.rangeUnsupported).toBe(true);
    expect(tail.calls.count).toBe(2);
  });

  test('a tail the gateway rejects (4xx) is a refusal, not retried', async () => {
    const tail = scripted([NOT_FOUND]);
    const outcome = await pullEarlierPage({
      page: null,
      readRange: scripted([]).read,
      readTail: tail.read,
      servedStart,
    });
    expect(outcome.kind).toBe('refused');
    expect(tail.calls.count).toBe(1);
  });

  test('an auth failure on the range ends the pull without touching the tail', async () => {
    const tail = scripted([]);
    const outcome = await pullEarlierPage({
      page: PAGE,
      readRange: scripted([UNAUTHORIZED]).read,
      readTail: tail.read,
      servedStart,
    });
    expect(outcome.kind).toBe('failed');
    expect(tail.calls.count).toBe(0);
  });
});

describe('the pull gate', () => {
  test('fail, then no pull on offer, then a reconnect, then a page', async () => {
    let blocked = false;
    const offered = () =>
      canOfferHistoryPull({ canLoadEarlier: true, blocked, pagedHistory: undefined });
    const tail = scripted([BACKEND_ERROR, BACKEND_ERROR, tailRead]);
    const pull = () =>
      pullEarlierPage({
        page: null,
        readRange: scripted([]).read,
        readTail: tail.read,
        servedStart,
      });

    expect(offered()).toBe(true);
    const failed = await pull();
    expect(failed.kind).toBe('failed');
    blocked = historyPullBlockedAfter(failed.kind);
    // Closed: the gesture is not offered, so nothing fires into the same failure.
    expect(offered()).toBe(false);
    expect(tail.calls.count).toBe(2);

    blocked = historyPullBlockedAfter('reconnected');
    expect(offered()).toBe(true);
    const landed = await pull();
    expect(landed.kind).toBe('page');
    blocked = historyPullBlockedAfter(landed.kind);
    expect(offered()).toBe(true);
    expect(tail.calls.count).toBe(3);
  });

  test('a refusal closes the gate, and another pane opens it', () => {
    expect(historyPullBlockedAfter('refused')).toBe(true);
    expect(historyPullBlockedAfter('paneChanged')).toBe(false);
  });

  test('nothing to reach is nothing to offer, gate or no gate', () => {
    expect(canOfferHistoryPull({ canLoadEarlier: false, blocked: false, pagedHistory: true })).toBe(
      false
    );
  });
});

describe('discovery features.pagedHistory', () => {
  const plane = (features?: unknown) =>
    parseTerminalDiscovery({
      supported: true,
      mode: 'multiplexer',
      backends: [
        {
          sessionId: 'default',
          label: 'tmux',
          kind: 'tmux',
          connected: true,
          capabilities: [],
          ...(features === undefined ? {} : { features }),
        },
      ],
    });

  test('false withdraws the pull for that backend only', () => {
    const discovered = plane({ pagedHistory: false });
    expect(backendPagesHistory(discovered, 'default')).toBe(false);
    expect(backendPagesHistory(discovered, 'herdr')).toBeUndefined();
    expect(
      canOfferHistoryPull({
        canLoadEarlier: true,
        blocked: false,
        pagedHistory: backendPagesHistory(discovered, 'default'),
      })
    ).toBe(false);
  });

  test('absent or malformed is unknown, and unknown keeps the pull', () => {
    for (const features of [undefined, {}, { pagedHistory: 'no' }, 'nope']) {
      const pagedHistory = backendPagesHistory(plane(features), 'default');
      expect(pagedHistory).toBeUndefined();
      expect(canOfferHistoryPull({ canLoadEarlier: true, blocked: false, pagedHistory })).toBe(
        true
      );
    }
    expect(backendPagesHistory(null, 'default')).toBeUndefined();
  });

  test('true is carried through', () => {
    expect(backendPagesHistory(plane({ pagedHistory: true }), 'default')).toBe(true);
  });
});

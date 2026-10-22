import { describe, expect, mock, test } from 'bun:test';
import { runInNewContext } from 'node:vm';
import {
  declaration,
  productionSource,
  transpile,
  walk,
} from '../../test-support/production-source';
import { foldPaneWindow } from '../../terminal/history';
import { createPaneOutputStore } from '../../terminal/pane-output-store';
import type { CapturedHistoryRead } from '../terminal-history-pull';
import {
  emptyPaneCache,
  rememberPaneWindow,
  recallPaneWindow,
  paneWindowWorthFiling,
} from '../pane-cache';

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
  capturedProbeDue,
  capturedProbeState,
  capturedReprobeDelay,
  capturedTraversalNeedsRefresh,
  canOfferHistoryPull,
  historyExhaustedNotice,
  historyRefreshNotice,
  historyPullUsesRange,
  tailPageFoundNothing,
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

test('a blocked agent explains how to respond without suggesting a retry', () => {
  const failure = describeGatewayFailure(
    new Error(
      'HTTP 400: {"error":{"code":"agent_blocked","message":"agent.prompt: agent w1:p1 is blocked and requires interactive input"}}'
    )
  );
  expect(failure).toEqual({
    kind: 'request',
    message:
      "The agent is waiting for an answer. Use the question's controls or the terminal keyboard to respond. Your message has not been sent.",
    retryable: false,
    needsPairing: false,
  });
});

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
    const offered = () => canOfferHistoryPull({ canLoadEarlier: true, blocked });
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
    expect(canOfferHistoryPull({ canLoadEarlier: false, blocked: false })).toBe(false);
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

  test('false turns off the range read for that backend only, and keeps the pull', () => {
    // herdr: no range reads, but a wider tail read still pages (459 lines held,
    // 240 shown). The pull stays; only the range path goes.
    const discovered = plane({ pagedHistory: false });
    expect(backendPagesHistory(discovered, 'default')).toBe(false);
    expect(backendPagesHistory(discovered, 'herdr')).toBeUndefined();
    expect(historyPullUsesRange(backendPagesHistory(discovered, 'default'))).toBe(false);
    expect(historyPullUsesRange(backendPagesHistory(discovered, 'herdr'))).toBe(true);
    expect(canOfferHistoryPull({ canLoadEarlier: true, blocked: false })).toBe(true);
  });

  test('absent or malformed is unknown, and unknown still tries the range', () => {
    for (const features of [undefined, {}, { pagedHistory: 'no' }, 'nope']) {
      const pagedHistory = backendPagesHistory(plane(features), 'default');
      expect(pagedHistory).toBeUndefined();
      expect(historyPullUsesRange(pagedHistory)).toBe(true);
    }
    expect(backendPagesHistory(null, 'default')).toBeUndefined();
  });

  test('true is carried through', () => {
    expect(backendPagesHistory(plane({ pagedHistory: true }), 'default')).toBe(true);
  });
});

describe('a tail page that found nothing', () => {
  const tailPage = {
    kind: 'page' as const,
    fetched: tailRead,
    origin: 'page' as const,
    rangeUnsupported: false,
  };

  test('no new rows ends the pull with one notice', () => {
    expect(tailPageFoundNothing(tailPage, 240, 240)).toBe(true);
    expect(tailPageFoundNothing(tailPage, 200, 240)).toBe(true);
    expect(historyExhaustedNotice().kind).toBe('exhausted');
  });

  test('new rows are a page, and a range page is never judged by its length', () => {
    expect(tailPageFoundNothing(tailPage, 459, 240)).toBe(false);
    expect(tailPageFoundNothing({ ...tailPage, origin: 'rangePage' }, 80, 240)).toBe(false);
  });
});

describe('captured history goes first where the gateway serves it', () => {
  const capturedPage = (
    rows: string[],
    hasMore: boolean,
    nextBefore: string | null,
    epoch = 1
  ) => ({
    ok: true as const,
    page: {
      rows,
      hasMore,
      nextBefore,
      captureEpoch: epoch,
      availability: 'captured' as const,
    },
  });
  const notCapturedPage = {
    ok: true as const,
    page: {
      rows: [],
      hasMore: false,
      nextBefore: null,
      captureEpoch: 1,
      availability: 'not_captured' as const,
    },
  };
  const status = (code: number) => ({
    ok: false as const,
    status: code,
    error: new Error(`HTTP ${code}: {"error":{"code":"x","message":"x"}}`),
  });
  type Answer =
    | ReturnType<typeof capturedPage>
    | typeof notCapturedPage
    | ReturnType<typeof status>;

  test.each<
    [
      string,
      { before: string; epoch: number } | null,
      Answer[],
      (string | null)[],
      { kind: string; origin?: string; captured?: unknown },
      number,
    ]
  >([
    [
      'the first pull asks without a cursor and lands a captured page',
      null,
      [capturedPage(['a', 'b'], true, 'c1')],
      [null],
      {
        kind: 'page',
        origin: 'capturedPage',
        captured: { kind: 'page', cursor: { before: 'c1', epoch: 1 }, hasMore: true },
      },
      0,
    ],
    [
      'a later pull asks from the cursor',
      { before: 'c1', epoch: 1 },
      [capturedPage(['older'], false, null)],
      ['c1'],
      {
        kind: 'page',
        origin: 'capturedPage',
        captured: { kind: 'page', cursor: null, hasMore: false },
      },
      0,
    ],
    [
      'a pane the gateway does not capture falls through to the tail',
      null,
      [notCapturedPage],
      [null],
      { kind: 'page', origin: 'page', captured: { kind: 'notCaptured' } },
      1,
    ],
    [
      'a lost cursor (410) starts over once without it',
      { before: 'c9', epoch: 1 },
      [status(410), capturedPage(['a', 'b'], true, 'c1')],
      ['c9', null],
      { kind: 'page', origin: 'capturedPage' },
      0,
    ],
    [
      '410 twice running fails',
      { before: 'c9', epoch: 1 },
      [status(410), status(410)],
      ['c9', null],
      { kind: 'failed' },
      0,
    ],
    [
      'a cursor mismatch (409) is refused',
      { before: 'c1', epoch: 1 },
      [status(409)],
      ['c1'],
      { kind: 'refused' },
      0,
    ],
  ])('%s', async (_name, cursor, answers, asked, expected, tailCalls) => {
    const requested: (string | null)[] = [];
    const tail = scripted([tailRead]);
    const outcome = await pullEarlierPage({
      page: null,
      readRange: scripted([]).read,
      readTail: tail.read,
      servedStart,
      captured: {
        cursor,
        read: async (before) => {
          requested.push(before);
          const answer = answers[requested.length - 1];
          if (!answer) throw new Error('unexpected call');
          return answer;
        },
      },
    });
    expect(outcome).toMatchObject(expected);
    expect(requested).toEqual(asked);
    expect(tail.calls.count).toBe(tailCalls);
  });
});

test('the captured history is asked once, and never after a pull knows more', () => {
  const pane = { off: false, exhausted: false, cursor: null, askedAlready: false };
  const cases: [Parameters<typeof capturedProbeDue>[0], boolean][] = [
    [pane, true],
    // A focus return or an overview toggle asks nothing new.
    [{ ...pane, askedAlready: true }, false],
    // The last page was given: going back to the pane does not offer it again.
    [{ ...pane, exhausted: true }, false],
    [{ ...pane, cursor: { before: 'c', epoch: 'e' } }, false],
    [{ ...pane, off: true }, false],
  ];
  expect(cases.map(([state]) => capturedProbeDue(state))).toEqual(cases.map(([, due]) => due));
});

describe('captured traversal recovery', () => {
  const page = (
    rows: string[],
    snapshotId = 'new',
    generation = 'generation',
    captureEpoch = 'epoch'
  ) => ({
    ok: true as const,
    page: {
      rows,
      hasMore: true,
      nextBefore: 'next',
      snapshotId,
      generation,
      captureEpoch,
      availability: 'captured' as const,
    },
  });
  const pull = (read: (before: string | null) => Promise<CapturedHistoryRead>) =>
    pullEarlierPage({
      page: null,
      readRange: scripted([]).read,
      readTail: scripted([]).read,
      servedStart,
      captured: {
        cursor: { before: 'expired', epoch: 'epoch', snapshotId: 'old', generation: 'generation' },
        read,
      },
    });

  test('410 preserves the held snapshot until refresh; fresh rows then replace only its prefix', async () => {
    const asked: (string | null)[] = [];
    const outcome = await pull(async (before) => {
      asked.push(before);
      return before
        ? { ok: false, status: 410, error: new Error('HTTP 410: expired') }
        : page(['old 7', 'old 8', 'old 9', 'old 10']);
    });
    expect(asked).toEqual(['expired', null]);
    expect(outcome.kind).toBe('page');
    if (outcome.kind !== 'page' || outcome.captured?.kind !== 'page')
      throw new Error('expected captured page');
    let held = foldPaneWindow(
      { output: 'live A\nlive B', capturedRows: 0 },
      'old 1\nold 2\nold 3\nold 4\nold 5\nold 6\nold 7\nold 8',
      'capturedPage',
      40,
      true,
      2,
      true
    );
    const beforeRefresh = held;
    expect(capturedTraversalNeedsRefresh(outcome.captured, held.capturedRows, false)).toBe(true);
    expect(historyRefreshNotice()).toMatchObject({ kind: 'refresh', retry: true, dismissMs: 0 });
    held = foldPaneWindow(held, 'live C\nlive D', 'frame', 40, true, 2);
    expect(held.output).toBe(
      `${beforeRefresh.output.split('\n').slice(0, 8).join('\n')}\nlive C\nlive D`
    );
    expect(capturedTraversalNeedsRefresh(outcome.captured, held.capturedRows, true)).toBe(false);
    const refreshed = foldPaneWindow(
      held,
      outcome.fetched.output,
      outcome.origin,
      40,
      true,
      2,
      outcome.captured.reset
    );
    expect(refreshed.output).toBe('old 7\nold 8\nold 9\nold 10\nlive C\nlive D');
  });

  test.each(['snapshotId', 'generation', 'captureEpoch'] as const)(
    '%s changes restart without merging the mismatched page',
    async (field) => {
      const asked: (string | null)[] = [];
      const answer = page(['wrong page'], 'old');
      answer.page[field] = 'changed';
      const outcome = await pull(async (before) => {
        asked.push(before);
        return before ? answer : page(['current first page']);
      });
      expect(asked).toEqual(['expired', null]);
      expect(outcome).toMatchObject({
        kind: 'page',
        fetched: { output: 'current first page' },
        captured: {
          reset: true,
          cursor: { snapshotId: 'new', generation: 'generation', epoch: 'epoch' },
        },
      });
    }
  );

  test('an unseeded first probe stays eligible, and later sampling enables captured pagination', async () => {
    const unseeded = {
      ok: true as const,
      page: { ...page([]).page, availability: 'not_captured' as const },
    };
    const probe = capturedProbeState(unseeded);
    expect(probe).toEqual({ off: false, empty: true, hasRows: false });
    expect(
      capturedProbeDue({ ...probe, exhausted: false, cursor: null, askedAlready: false })
    ).toBe(true);
    expect(capturedProbeState(page(['sampled row']))).toEqual({
      off: false,
      empty: false,
      hasRows: true,
    });
    const outcome = await pullEarlierPage({
      page: null,
      readRange: scripted([]).read,
      readTail: scripted([tailRead]).read,
      servedStart,
      captured: { cursor: null, read: async () => unseeded },
    });
    expect(outcome).toMatchObject({
      kind: 'page',
      origin: 'page',
      captured: { kind: 'notCaptured', reset: true },
    });
    // A native-scrollback shell still receives the ordinary tail fallback.
    expect(outcome.kind === 'page' && outcome.fetched).toBe(tailRead);
  });

  test('history parsing retains snapshot identity and accepts legacy pages without it', () => {
    const parse = runInNewContext(
      transpile(
        `${declaration('src/lib/gateway-client.ts', 'parseCapturedHistoryPage')}\nparseCapturedHistoryPage`
      )
    ) as (value: unknown) => unknown;
    expect(
      parse({
        rows: ['row'],
        has_more: true,
        next_before: 'cursor',
        capture_epoch: 'epoch',
        snapshot_id: 'snapshot',
        generation: 'generation',
      })
    ).toMatchObject({ captureEpoch: 'epoch', snapshotId: 'snapshot', generation: 'generation' });
    expect(parse({ rows: ['legacy'], has_more: false })).toMatchObject({
      rows: ['legacy'],
      snapshotId: null,
      generation: null,
      captureEpoch: null,
    });
  });

  test('output advancing before an empty probe finishes schedules a throttled retry without idle polling', () => {
    expect(capturedReprobeDelay('first frame', 'sampled frame', 1_000, 11_000, 30_000)).toBe(
      20_000
    );
    expect(capturedReprobeDelay('first frame', 'sampled frame', 1_000, 31_000, 30_000)).toBe(0);
    expect(
      capturedReprobeDelay('sampled frame', 'sampled frame', 31_000, 61_000, 30_000)
    ).toBeNull();
    expect(capturedReprobeDelay(null, 'sampled frame', 1_000, 31_000, 30_000)).toBeNull();
  });

  test('rows discovered before the viewport boundary are offered once when the boundary arrives', async () => {
    const source = productionSource('src/components/server-terminal-workspace.tsx');
    let effectSource = '';
    walk(source.program, (node) => {
      if (
        node.type !== 'CallExpression' ||
        node.callee.type !== 'Identifier' ||
        node.callee.name !== 'useEffect'
      )
        return;
      const callback = node.arguments[0];
      if (callback?.type !== 'ArrowFunctionExpression') return;
      const code = source.code(callback);
      if (code.includes('const probedOutput = outputStore.get().window.output;'))
        effectSource = code;
    });
    if (!effectSource) throw new Error('Missing captured probe effect');
    let reads = 0;
    const offers: boolean[] = [];
    const viewport = { current: 0 };
    const globals = {
      selection: { paneId: 'pane' },
      data: { sessionId: 'session' },
      ready: true,
      servesCapturedHistory: true,
      servesSegmentedHistory: false,
      record: { serverId: 'server' },
      capturedProbe: 0,
      capturedViewportReady: false,
      capturedOffRef: { current: false },
      capturedExhaustedRef: { current: false },
      capturedCursorRef: { current: null },
      capturedProbedKeyRef: { current: '' },
      capturedProbedAtRef: { current: 0 },
      activePaneRef: { current: 'pane' },
      loadingEarlierOutputRef: { current: false },
      capturedRefreshRequiredRef: { current: false },
      capturedEmptyRef: { current: false },
      paneScreenRowsRef: viewport,
      outputLineLimitRef: { current: 240 },
      MAX_PANE_OUTPUT_LINES: 2_000,
      capturedProbeDue,
      capturedProbeState,
      outputStore: createPaneOutputStore({
        window: { output: 'live viewport', capturedRows: 0 },
        revision: -1,
      }),
      readPaneHistory: async () => {
        reads += 1;
        return page(['captured row']);
      },
      setCapturedEmptyProbe: () => {},
      offerCaptured: (_pane: string, open: boolean) => offers.push(open),
    };
    const effect = runInNewContext(transpile(effectSource), globals) as () =>
      | (() => void)
      | undefined;
    const cleanup = effect();
    await Promise.resolve();
    await Promise.resolve();
    expect(offers).toEqual([false]);
    expect(reads).toBe(1);
    cleanup?.();
    viewport.current = 24;
    globals.capturedViewportReady = true;
    effect();
    await Promise.resolve();
    await Promise.resolve();
    expect(offers).toEqual([false, true]);
    expect(reads).toBe(2);
    effect();
    await Promise.resolve();
    expect(reads).toBe(2);
  });

  test('pane handoff retains prefix provenance even when a reconnect discarded its cursor state', () => {
    const handoff = runInNewContext(
      transpile(
        `${declaration('src/components/server-terminal-workspace.tsx', 'usePaneWindowHandoff')}\nusePaneWindowHandoff`
      ),
      {
        rememberPaneWindow,
        recallPaneWindow,
        paneWindowWorthFiling,
      }
    ) as (switched: boolean, input: Record<string, unknown>) => void;
    const cache = { current: emptyPaneCache };
    const owner = { current: 'previous-pane' };
    const outputStore = createPaneOutputStore({
      window: { output: 'captured row\nlive row', capturedRows: 1 },
      revision: 1,
    });
    const restored: { output: string; capturedRows: number }[] = [];
    const input = {
      outputStore,
      paneId: 'next-pane',
      outputShape: 'ansi:main',
      paneCacheRef: cache,
      paneWindowOwnerRef: owner,
      heldShapeRef: { current: 'ansi:main' },
      outputLineLimitRef: { current: 240 },
      canLoadEarlierOutputRef: { current: true },
      earlierOutputRowsRef: { current: 2 },
      rangeUnsupportedRef: { current: false },
      lastReadRef: { current: null },
      capturedHereRef: { current: null },
      setCanLoadEarlierOutput: () => {},
    };
    handoff(true, input);
    restored.push(outputStore.get().window);
    outputStore.setWindow({ output: 'next live', capturedRows: 0 });
    handoff(true, { ...input, paneId: 'previous-pane' });
    restored.push(outputStore.get().window);
    expect(restored).toEqual([
      { output: '', capturedRows: 0 },
      { output: 'captured row\nlive row', capturedRows: 1 },
    ]);
    expect(
      cache.current.entries.find((entry) => entry.paneId === 'previous-pane')?.captured
    ).toMatchObject({ rows: 1, generation: -1, cursor: null });
  });
});

import { describe, expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';

import {
  declaration,
  productionSource,
  transpile,
  walk,
} from '../../test-support/production-source';
import type { GatewayRecord } from '../gateway-storage';
import {
  appendCapturedSegmentsPage,
  CAPTURED_HISTORY_PAGE_ROWS,
  capturedHistoryOwnerMatches,
  parseCapturedSegmentsPage,
  type CapturedSegmentsPage,
  type CapturedSegmentsRead,
} from '../terminal-history-segments';

const request = { sessionId: 'herdr', paneId: 'agent', limit: CAPTURED_HISTORY_PAGE_ROWS };
const owner: GatewayRecord = {
  serverId: 'computer-a',
  label: 'Computer A',
  url: 'http://gateway.invalid',
  token: 'fixture-token',
  deviceId: 'device-a',
  transportKey: 'fixture-key',
  transport: 'muqun-aes-256-gcm-v1',
  pairedAt: 1,
};
const segment = (id: string, rows: string[], reason = 'observation-start') => ({
  segment_id: id,
  started_at_ms: 1000,
  sealed_at_ms: id === 'old' ? 2000 : null,
  boundary_reason: reason,
  rows,
});
const wire = (segments: ReturnType<typeof segment>[], before: string | null = null) => ({
  session_id: request.sessionId,
  pane_id: request.paneId,
  generation: 'generation',
  source: 'gateway-captured',
  read_source: 'recent-unwrapped',
  format: 'ansi',
  availability: 'captured',
  snapshot_id: segments.length ? 'snapshot' : null,
  segments,
  row_count: segments.reduce((total, entry) => total + entry.rows.length, 0),
  has_more: before !== null,
  next_before: before,
  order: 'oldest-to-newest',
  includes_live_viewport: false,
  complete_archive: false,
});
const parse = (value: unknown) => {
  const page = parseCapturedSegmentsPage(value, request);
  if (!page) throw new Error('Invalid test fixture');
  return page;
};

describe('captured segments contract', () => {
  test('4980 pre-restart rows and 20 new rows remain reachable across the 2000-row live-window bound', () => {
    const rows = Array.from({ length: 5000 }, (_, index) => String(index));
    let pages: CapturedSegmentsPage[] = [];
    for (let end = rows.length; end > 0; end -= request.limit) {
      const start = Math.max(0, end - request.limit);
      const segments = [];
      if (start < 4980) segments.push(segment('old', rows.slice(start, Math.min(end, 4980))));
      if (end > 4980)
        segments.push(segment('new', rows.slice(Math.max(start, 4980), end), 'gateway-restart'));
      const page = parse(wire(segments, start > 0 ? `before-${start}` : null));
      pages = pages.length ? appendCapturedSegmentsPage(pages, page, `before-${end}`)! : [page];
      expect(pages).not.toBeNull();
      expect(page.rowCount).toBeLessThanOrEqual(240);
    }
    expect(pages).toHaveLength(21);
    expect(pages.reduce((total, page) => total + page.rowCount, 0)).toBe(5000);
    expect(
      pages.toReversed().flatMap((page) => page.segments.flatMap((entry) => entry.rows))
    ).toEqual(rows);
    expect(pages[0]!.segments.map((entry) => [entry.id, entry.boundaryReason])).toEqual([
      ['old', 'observation-start'],
      ['new', 'gateway-restart'],
    ]);
    expect(pages.at(-1)!.hasMore).toBe(false);
  });

  test('blank and repeated ANSI rows survive a boundary and a segment split across pages', () => {
    const same = '\u001b[32msame\u001b[0m';
    const newest = parse(
      wire([segment('old', [same]), segment('new', [same, ''], 'resize')], 'older')
    );
    const older = parse(wire([segment('old', ['', same])]));
    const pages = appendCapturedSegmentsPage([newest], older, 'older')!;
    expect(
      pages.toReversed().flatMap((page) => page.segments.flatMap((entry) => entry.rows))
    ).toEqual(['', same, same, same, '']);
    expect(pages[0]!.segments[1]!.id).toBe('new');
    expect(pages[1]!.segments[0]!.id).toBe('old');
  });

  test('a snapshot near the raw text budget keeps its oldest rows without counting page separators twice', () => {
    const rows = Array.from({ length: 5000 }, () => 'x'.repeat(419));
    let pages: CapturedSegmentsPage[] = [];
    for (let end = rows.length; end > 0; end -= request.limit) {
      const start = Math.max(0, end - request.limit);
      const page = parse(
        wire([segment('old', rows.slice(start, end))], start ? String(start) : null)
      );
      const next = pages.length ? appendCapturedSegmentsPage(pages, page, String(end)) : [page];
      expect(next).not.toBeNull();
      pages = next!;
    }
    expect(pages.reduce((total, page) => total + page.rowCount, 0)).toBe(5000);
    expect(pages.reduce((total, page) => total + page.byteCount, 0)).toBe(2_095_000);
    // The per-page wire budget still includes a separator for each row.
    expect(
      parseCapturedSegmentsPage(wire([segment('old', ['x'.repeat(256 * 1024)])]), request)
    ).toBeNull();
  });

  test('malformed pages are refused whole, including legacy rows, wrong identity, and invalid row counts', () => {
    const good = wire([segment('old', ['row'])]);
    for (const bad of [
      { ...good, rows: ['legacy'], segments: undefined },
      { ...good, pane_id: 'other-pane' },
      { ...good, format: 'text' },
      { ...good, row_count: 2 },
      { ...good, includes_live_viewport: true },
      {
        ...good,
        segments: [segment('old', ['row']), segment('old', ['duplicate identity'])],
        row_count: 2,
      },
      { ...good, segments: [{ ...segment('old', ['row']), rows: ['row', 3] }], row_count: 2 },
    ])
      expect(parseCapturedSegmentsPage(bad, request)).toBeNull();
    expect(parseCapturedSegmentsPage({ data: good }, request)?.segments[0]?.rows).toEqual(['row']);
    expect(parseCapturedSegmentsPage(wire([]), request)?.rowCount).toBe(0);
  });

  test('snapshots, request limits, and segment metadata cannot cross a held traversal', () => {
    const newest = parse(wire([segment('old', ['held'])], 'older'));
    const older = parse(wire([segment('old', ['earlier'])]));
    for (const changed of [
      { ...older, snapshotId: 'replacement' },
      { ...older, generation: 'restarted' },
      { ...older, limit: 1 },
      { ...older, paneId: 'another-pane' },
      { ...older, segments: [{ ...older.segments[0]!, boundaryReason: 'resize' }] },
      { ...older, nextBefore: 'older', hasMore: true },
    ])
      expect(appendCapturedSegmentsPage([newest], changed, 'older')).toBeNull();
    expect(appendCapturedSegmentsPage([newest], older, 'probe-cursor')).toBeNull();
    expect(newest.segments[0]!.rows).toEqual(['held']);
  });

  test('pairing ownership includes credentials and tunnel destination but not the display label', () => {
    expect(capturedHistoryOwnerMatches(owner, { ...owner, label: 'Renamed' })).toBe(true);
    for (const changed of [
      null,
      { ...owner, serverId: 'b' },
      { ...owner, deviceId: 'replacement' },
      { ...owner, token: 'rotated' },
      { ...owner, transportKey: 'rotated' },
      { ...owner, url: 'http://elsewhere.invalid' },
      { ...owner, sshTunnel: { hostId: 'ssh', remoteHost: 'localhost', remotePort: 8787 } },
    ])
      expect(capturedHistoryOwnerMatches(owner, changed)).toBe(false);
  });
});

test('the production reader binds the endpoint and credentials, never reusing a 1-row probe cursor', async () => {
  const calls: { record: GatewayRecord; path: string }[] = [];
  const read = runInNewContext(
    transpile(
      `${declaration('src/lib/gateway-client.ts', 'readPaneHistorySegments')}\nreadPaneHistorySegments`
    ),
    {
      URLSearchParams,
      Error,
      CAPTURED_HISTORY_PAGE_ROWS,
      parseCapturedSegmentsPage,
      isDemoRecord: () => false,
      readGatewayRecordJson: async (record: GatewayRecord, path: string) => {
        calls.push({ record, path });
        if (path.includes('before=expired')) throw new Error('HTTP 410');
        return { data: wire([segment('old', ['one'])], 'cursor') };
      },
    }
  ) as (
    record: GatewayRecord,
    sessionId: string,
    paneId: string,
    before: string | null,
    limit?: number
  ) => Promise<CapturedSegmentsRead>;
  await read(owner, 'herdr', 'agent', null, 1);
  await read(owner, 'herdr', 'agent', null);
  expect(calls.map(({ path }) => path)).toEqual([
    '/api/sessions/herdr/panes/agent/history/segments?format=ansi&limit=1',
    '/api/sessions/herdr/panes/agent/history/segments?format=ansi&limit=240',
  ]);
  expect(calls.every((call) => call.record === owner)).toBe(true);
  expect(await read(owner, 'herdr', 'agent', 'expired')).toMatchObject({ ok: false, status: 410 });
});

test('the production reader keeps the held page and viewport on expiry, mismatch, and a late replacement-pairing reply', () => {
  const source = productionSource('src/components/pane-history-sheet.tsx');
  let receiveSource = '';
  walk(source.program, (node) => {
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 'useEffectEvent'
    ) {
      const callback = node.arguments[0];
      if (
        callback?.type === 'ArrowFunctionExpression' &&
        source.code(callback).includes('appendCapturedSegmentsPage')
      )
        receiveSource = source.code(callback);
    }
  });
  expect(receiveSource).not.toBe('');
  const held = [
    parse(wire([segment('old', ['newest held'])], 'middle')),
    parse(wire([segment('old', ['middle held'])], 'oldest')),
    parse(wire([segment('old', ['oldest held'])], 'older')),
  ];
  let pages = held;
  let index = 2;
  let refresh = false;
  const globals = {
    owns: true,
    enabled: true,
    pages: held,
    appendCapturedSegmentsPage,
    setLoading: () => {},
    setFailure: () => {},
    setPages: (value: CapturedSegmentsPage[]) => {
      pages = value;
    },
    setIndex: (value: number) => {
      index = value;
    },
    setRefreshRequired: (value: boolean) => {
      refresh = value;
    },
  };
  const receive = runInNewContext(transpile(receiveSource), globals) as (
    answer: CapturedSegmentsRead,
    before: string | null
  ) => void;
  for (const status of [409, 410]) {
    receive({ ok: false, status, error: new Error(`HTTP ${status}`) }, 'older');
    expect(refresh).toBe(true);
    expect(pages).toBe(held);
    expect(index).toBe(2);
  }
  const replacement = { ...parse(wire([segment('old', ['replacement'])])), snapshotId: 'new' };
  receive({ ok: true, page: replacement }, 'older');
  expect(pages).toBe(held);
  globals.owns = false;
  receive({ ok: true, page: replacement }, null);
  expect(pages).toBe(held);
  globals.owns = true;
  receive({ ok: true, page: replacement }, null);
  expect(pages).toEqual([replacement]);
  expect(index).toBe(0);
  expect(refresh).toBe(false);
});

test('segmented snapshots neither arm the inline pull nor navigate when a native pull reaches its limit', async () => {
  const source = productionSource('src/components/server-terminal-workspace.tsx');
  let probeSource = '';
  let pullSource = '';
  let affordanceSource = '';
  walk(source.program, (node) => {
    if (
      node.type === 'JSXAttribute' &&
      node.name.type === 'JSXIdentifier' &&
      node.name.name === 'canLoadEarlier' &&
      node.value?.type === 'JSXExpressionContainer'
    ) {
      affordanceSource = source.code(node.value.expression);
    }
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier') return;
    const callback = node.arguments[0];
    if (callback?.type !== 'ArrowFunctionExpression') return;
    const code = source.code(callback);
    if (
      node.callee.name === 'useEffect' &&
      code.includes('const probedOutput = outputStore.get().window.output;')
    )
      probeSource = code;
    if (
      node.callee.name === 'useCallback' &&
      code.includes('const currentLimit = outputLineLimitRef.current;') &&
      code.includes('pullEarlierPage')
    )
      pullSource = code;
  });
  expect(probeSource).not.toBe('');
  expect(pullSource).not.toBe('');
  expect(affordanceSource).not.toBe('');
  const routes: unknown[] = [];
  const globals = {
    selection: { paneId: 'agent' },
    data: { sessionId: 'herdr' },
    record: owner,
    ready: true,
    servesCapturedHistory: true,
    servesSegmentedHistory: true,
    capturedOpen: true,
    connection: { phase: 'connected' },
    serverId: owner.serverId,
    loadingEarlierOutputRef: { current: false },
    historyPullBlockedRef: { current: false },
    outputLineLimitRef: { current: 2000 },
    MAX_PANE_OUTPUT_LINES: 2000,
    router: { push: (route: unknown) => routes.push(route) },
  };
  // No background segment probe is needed for the explicit saved-history entry.
  runInNewContext(transpile(probeSource), globals)();
  await runInNewContext(transpile(pullSource), globals)();
  expect(routes).toEqual([]);
  const offered = (overrides: Record<string, unknown>) =>
    runInNewContext(transpile(affordanceSource), {
      ...globals,
      fullScreenPane: false,
      canLoadEarlierOutput: false,
      historyPullBlocked: false,
      canOfferHistoryPull: ({
        canLoadEarlier,
        blocked,
      }: {
        canLoadEarlier: boolean;
        blocked: boolean;
      }) => canLoadEarlier && !blocked,
      ...overrides,
    });
  expect(offered({})).toBe(false);
  expect(offered({ canLoadEarlierOutput: true })).toBe(true);
  expect(offered({ canLoadEarlierOutput: true, historyPullBlocked: true })).toBe(false);
  expect(offered({ fullScreenPane: true, canLoadEarlierOutput: true })).toBe(false);
  expect(offered({ servesSegmentedHistory: false })).toBe(true);
});

test('saved history opens only from its explicit quick action with the captured pane identity', () => {
  const routes: unknown[] = [];
  const globals = {
    available: { canOpenSavedHistory: true },
    params: { serverId: 'computer-a', sessionId: 'session-a', paneId: 'pane-a' },
    router: { replace: (route: unknown) => routes.push(route) },
  };
  const open = runInNewContext(
    transpile(`${declaration('src/app/commands.tsx', 'openSavedHistory')}\nopenSavedHistory`),
    globals
  );
  open();
  expect(routes).toEqual([{ pathname: '/pane-history', params: globals.params }]);
  globals.available.canOpenSavedHistory = false;
  open();
  expect(routes).toHaveLength(1);
});

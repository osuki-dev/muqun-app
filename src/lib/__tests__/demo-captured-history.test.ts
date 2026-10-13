import { expect, test } from 'bun:test';
import { runInNewContext } from 'node:vm';

import { declaration, transpile } from '../../test-support/production-source';
import {
  DEMO_CAPTURED_HISTORY_PANE_ID as paneId,
  DEMO_CAPTURED_HISTORY_SESSION_ID as sessionId,
  demoCapturedHistory,
} from '../demo-captured-history';
import type { GatewayRecord } from '../gateway-storage';
import { DEMO_PAIRING_SERVER_ID } from '../pairing';
import {
  appendCapturedSegmentsPage,
  CAPTURED_HISTORY_PAGE_ROWS,
  parseCapturedSegmentsPage,
  type CapturedSegmentsPage,
  type CapturedSegmentsRead,
} from '../terminal-history-segments';

const request = { sessionId, paneId, limit: CAPTURED_HISTORY_PAGE_ROWS };

test('the bundled fixture traverses three production pages and preserves the restart boundary', () => {
  let pages: CapturedSegmentsPage[] = [];
  let before: string | null = null;
  do {
    const wire = demoCapturedHistory(sessionId, paneId, before);
    expect('capture_epoch' in wire.data).toBe(false);
    expect('rows' in wire.data).toBe(false);
    const page = parseCapturedSegmentsPage(wire, request)!;
    expect(page).not.toBeNull();
    pages = before ? appendCapturedSegmentsPage(pages, page, before)! : [page];
    expect(pages).not.toBeNull();
    before = page.nextBefore;
  } while (before);
  expect(pages.map((page) => page.rowCount)).toEqual([240, 240, 40]);
  expect(pages[0]!.segments.map((segment) => segment.boundaryReason)).toEqual([
    'observation-start',
    'gateway-restart',
  ]);
  expect(pages[1]!.segments[0]!.id).toBe(pages[0]!.segments[0]!.id);
  const rows = pages
    .toReversed()
    .flatMap((page) => page.segments.flatMap((segment) => segment.rows));
  expect(rows).toHaveLength(520);
  expect(rows[0]).toContain('[saved 001]');
  expect(rows.at(-1)).toContain('[saved 520]');
  expect(new Set(rows).size).toBe(520);
  expect(parseCapturedSegmentsPage(demoCapturedHistory(sessionId, paneId, null), request)).toEqual(
    pages[0]
  );
});

test('demo cursors are bound to the request limit and reserved pane identity', () => {
  const probe = demoCapturedHistory(sessionId, paneId, null, 1);
  expect(() => demoCapturedHistory(sessionId, paneId, probe.data.next_before)).toThrow('HTTP 409');
  const cursor = demoCapturedHistory(sessionId, paneId, null).data.next_before;
  expect(() => demoCapturedHistory('another-session', paneId, cursor)).toThrow('HTTP 409');
  expect(() => demoCapturedHistory(sessionId, 'another-pane', cursor)).toThrow('HTTP 409');
  expect(() => demoCapturedHistory(sessionId, paneId, 'demo-history-v1:240:279')).toThrow(
    'HTTP 409'
  );
  const empty = demoCapturedHistory(sessionId, 'pane-1', null);
  expect(empty.data.availability).toBe('not_captured');
  expect(parseCapturedSegmentsPage(empty, { ...request, paneId: 'pane-1' })?.rowCount).toBe(0);
});

test('the production record reader uses the demo wire parser without making a real request', async () => {
  const realCalls: string[] = [];
  const read = runInNewContext(
    transpile(
      `${declaration('src/lib/gateway-client.ts', 'readPaneHistorySegments')}\nreadPaneHistorySegments`
    ),
    {
      URLSearchParams,
      Error,
      CAPTURED_HISTORY_PAGE_ROWS,
      parseCapturedSegmentsPage,
      demoCapturedHistory,
      isDemoRecord: (record: GatewayRecord) => record.serverId === DEMO_PAIRING_SERVER_ID,
      readGatewayRecordJson: async (_record: GatewayRecord, path: string) => {
        realCalls.push(path);
        return demoCapturedHistory(sessionId, paneId, null);
      },
    }
  ) as (
    record: GatewayRecord,
    sessionId: string,
    paneId: string,
    before: string | null
  ) => Promise<CapturedSegmentsRead>;
  const record: GatewayRecord = {
    serverId: DEMO_PAIRING_SERVER_ID,
    label: 'Demo',
    url: 'https://demo.invalid',
    token: 'demo',
    pairedAt: 0,
  };
  expect(await read(record, sessionId, paneId, null)).toMatchObject({
    ok: true,
    page: { rowCount: 240 },
  });
  expect(realCalls).toEqual([]);
  expect(await read({ ...record, serverId: 'paired' }, sessionId, paneId, null)).toMatchObject({
    ok: true,
  });
  expect(realCalls).toHaveLength(1);
});

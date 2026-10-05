import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { parseAgentSocketFrame } from '@/lib/agent-socket-codec';
import {
  noteGatewayGeneration,
  onGatewayRestart,
  readGatewayGeneration,
  useGatewayGeneration,
} from '@/stores/gateway-connection-generation';
import { foldPaneRead } from '@/terminal/history';

const MAXIMUM = 2000;

/**
 * The workspace's handling of a pane read, cut down to what a restart
 * touches: one held window per server, reset by `onGatewayRestart`, and an
 * answer whose `note` saw a restart turned away (the workspace's bumped
 * request id) in favour of the read the reset issues.
 */
function harness(servers: string[]) {
  const held: Record<string, string> = {};
  const stops = servers.map((serverId) => {
    held[serverId] = '';
    return onGatewayRestart(serverId, () => {
      held[serverId] = '';
    });
  });
  const read = (serverId: string, buffer: string, generation?: string) => {
    // On a restart this answer is discarded and the reset's own read folds
    // the same buffer into the emptied window -- the same string either way.
    noteGatewayGeneration(serverId, { output: buffer, ...(generation ? { generation } : {}) });
    held[serverId] = foldPaneRead(held[serverId], buffer, 'refresh', MAXIMUM);
  };
  return { held, read, stop: () => stops.forEach((stop) => stop()) };
}

const count = (text: string, line: string) => text.split('\n').filter((row) => row === line).length;

let stop = () => {};

beforeEach(() => {
  useGatewayGeneration.setState({ byServer: {}, restarts: {} });
});

afterEach(() => stop());

test('reads the generation at the top level or inside the read envelope', () => {
  expect(readGatewayGeneration({ generation: 'g1', output: 'x' })).toBe('g1');
  expect(readGatewayGeneration({ read: { output: 'x', generation: 'g2' } })).toBe('g2');
  expect(readGatewayGeneration({ output: 'x' })).toBeUndefined();
  expect(readGatewayGeneration({ generation: '' })).toBeUndefined();
  expect(readGatewayGeneration({ generation: 7 })).toBeUndefined();
  expect(readGatewayGeneration(null)).toBeUndefined();
});

test('an unchanged generation keeps the held history', () => {
  const h = harness(['a']);
  stop = h.stop;
  h.read('a', 'one\ntwo', 'g1');
  h.read('a', 'one\ntwo\nthree', 'g1');
  expect(h.held.a).toBe('one\ntwo\nthree');
  expect(useGatewayGeneration.getState().restarts.a).toBeUndefined();
});

test('the first generation seen is learnt, not a restart', () => {
  const h = harness(['a']);
  stop = h.stop;
  h.read('a', 'old\nhistory');
  expect(noteGatewayGeneration('a', { generation: 'g1' })).toBe(false);
  h.read('a', 'old\nhistory\nmore', 'g1');
  expect(h.held.a).toBe('old\nhistory\nmore');
});

test('a gateway without a generation behaves as before', () => {
  const h = harness(['a']);
  stop = h.stop;
  h.read('a', 'one\ntwo', 'g1');
  h.read('a', 'two\nthree');
  expect(h.held.a).toBe(foldPaneRead('one\ntwo', 'two\nthree', 'refresh', MAXIMUM));
  expect(useGatewayGeneration.getState().byServer.a).toBe('g1');
});

test('a changed generation replaces the history with the next read, without duplicates', () => {
  const h = harness(['a']);
  stop = h.stop;
  h.read('a', '$ opencode\nold answer\nready', 'g1');
  // What the fold alone makes of it: the old run's rows survive.
  expect(foldPaneRead(h.held.a, '$ opencode\nready', 'refresh', MAXIMUM)).toContain('old answer');
  // The restarted gateway's buffer starts again with the same opening rows.
  h.read('a', '$ opencode\nready', 'g2');
  expect(h.held.a).toBe('$ opencode\nready');
  expect(count(h.held.a, '$ opencode')).toBe(1);
  expect(h.held.a).not.toContain('old answer');
  expect(useGatewayGeneration.getState().restarts.a).toBe(1);
  // And from then on it folds as usual against the new run.
  h.read('a', '$ opencode\nready\nnew answer', 'g2');
  expect(h.held.a).toBe('$ opencode\nready\nnew answer');
});

test('two servers are independent', () => {
  const h = harness(['a', 'b']);
  stop = h.stop;
  h.read('a', 'a-one', 'g1');
  h.read('b', 'b-one', 'g1');
  h.read('a', 'a-fresh', 'g2');
  expect(h.held.a).toBe('a-fresh');
  expect(h.held.b).toBe('b-one');
  h.read('b', 'b-one\nb-two', 'g1');
  expect(h.held.b).toBe('b-one\nb-two');
  expect(useGatewayGeneration.getState().restarts).toEqual({ a: 1 });
});

test('a note without a server id records nothing', () => {
  expect(noteGatewayGeneration(null, { generation: 'g1' })).toBe(false);
  expect(useGatewayGeneration.getState().byServer).toEqual({});
});

// The exact bodies gateway 8d1020e sends: `src/platform/openapi.rs`, its
// `every_read_carries_one_generation_and_another_instance_has_another` and ws
// hello tests, and docs/content-model.md "Instance generation".
describe("the gateway's own layouts", () => {
  test('GET /health, /api/meta, /api/discovery, /api/capabilities: top-level generation', () => {
    expect(readGatewayGeneration({ ok: true, herdr: { ok: true }, generation: 'gen-1' })).toBe(
      'gen-1'
    );
    expect(
      readGatewayGeneration({ agents: { default: 'opencode', list: [] }, generation: 'gen-1' })
    ).toBe('gen-1');
  });

  test('pane output: result.read.generation, beside revision', () => {
    const body = {
      result: {
        type: 'pane_read',
        read: {
          output: '$ ls',
          revision: 4,
          range: { start: 0, end: 1, total: 1 },
          generation: 'gen-1',
        },
      },
    };
    expect(readGatewayGeneration(body)).toBe('gen-1');
    // And through the `{ code, data }` envelope the API client unwraps.
    expect(readGatewayGeneration({ code: 0, data: body })).toBe('gen-1');
  });

  test('pane parts: data.generation, beside revision', () => {
    expect(
      readGatewayGeneration({
        schema_version: '1',
        capabilities: { parts: true, assets: true, image_upload: true, composer: true },
        data: {
          session_id: 'default',
          pane_id: 'wM:p1',
          source: 'recent-unwrapped',
          lines: 40,
          revision: 4,
          generation: 'gen-1',
          pane: { pane_id: 'wM:p1', parts: 'text', image_input: false },
          parts: [],
        },
      })
    ).toBe('gen-1');
  });

  test('terminal SSE: data.generation on a pane_updated frame carrying data.output', () => {
    const frame: unknown = JSON.parse(
      '{"event":"pane_updated","data":{"pane":{"pane_id":"w1:p2","revision":1},"output":"hi","generation":"gen-1"}}'
    );
    expect(readGatewayGeneration(frame)).toBe('gen-1');
    // A frame without output names none, and changes nothing.
    expect(
      readGatewayGeneration({ event: 'pane_updated', data: { pane: { pane_id: 'w1:p2' } } })
    ).toBeUndefined();
  });

  test('GET /api/ws: generation in the hello frame', () => {
    const hello = parseAgentSocketFrame(
      '{"t":"hello","connection_id":"c-1","protocol":1,"generation":"gen-1"}'
    );
    expect(hello).toEqual({ t: 'hello', connectionId: 'c-1', protocol: 1, generation: 'gen-1' });
    expect(readGatewayGeneration(hello)).toBe('gen-1');
    expect(parseAgentSocketFrame('{"t":"hello","connection_id":"c-1","protocol":1}')).toEqual({
      t: 'hello',
      connectionId: 'c-1',
      protocol: 1,
    });
  });
});

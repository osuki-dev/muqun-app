import { afterEach, beforeEach, expect, test } from 'bun:test';

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

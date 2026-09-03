/**
 * The shortcut row that makes the second use of a port a tap.
 *
 * The promise these protect: a chip in that row opens the port it prints. So
 * nothing that is not a real port survives a read, the same port never appears
 * twice, and the most recently opened one is always the one nearest the thumb.
 */
import { describe, expect, test } from 'bun:test';

import {
  MAX_MIRRORED_PORT_SERVERS,
  MAX_RECENT_PORTS,
  normalizePorts,
  parseServerWebPortsIndex,
  samePorts,
  withMirroredPorts,
  withRecentPort,
} from '../server-web-ports';

describe('reading a stored list', () => {
  test('keeps whole ports in range, in order, once each', () => {
    expect(normalizePorts([3000, 8080, 3000])).toEqual([3000, 8080]);
  });

  test('drops anything that could not open what a chip would print', () => {
    expect(
      normalizePorts([0, 65536, -1, 3000.5, '3000', null, undefined, Number.NaN, 3000])
    ).toEqual([3000]);
  });

  test('a mirror that never had a list reads as none', () => {
    expect(normalizePorts(undefined)).toEqual([]);
    expect(normalizePorts(null)).toEqual([]);
    expect(normalizePorts({ 0: 3000 })).toEqual([]);
  });

  test('a list longer than the row is trimmed to it', () => {
    const many = Array.from({ length: MAX_RECENT_PORTS + 5 }, (_, index) => 3000 + index);
    expect(normalizePorts(many)).toHaveLength(MAX_RECENT_PORTS);
    expect(normalizePorts(many)[0]).toBe(3000);
  });
});

describe('opening a port', () => {
  test('the newest is first, so the usual one is nearest the thumb', () => {
    expect(withRecentPort([8080, 5173], 3000)).toEqual([3000, 8080, 5173]);
  });

  test('re-opening a remembered port moves it rather than duplicating it', () => {
    expect(withRecentPort([8080, 3000, 5173], 3000)).toEqual([3000, 8080, 5173]);
    expect(withRecentPort([3000], 3000)).toEqual([3000]);
  });

  test('the first port on a server that has none starts the list', () => {
    expect(withRecentPort(undefined, 3000)).toEqual([3000]);
    expect(withRecentPort([], 3000)).toEqual([3000]);
  });

  test('the oldest falls off the end once the row is full', () => {
    const full = Array.from({ length: MAX_RECENT_PORTS }, (_, index) => 3000 + index);
    const next = withRecentPort(full, 9999);
    expect(next).toHaveLength(MAX_RECENT_PORTS);
    expect(next[0]).toBe(9999);
    expect(next).not.toContain(full[full.length - 1]);
  });

  test('a port that is not one leaves the row as it was', () => {
    expect(withRecentPort([3000], 0)).toEqual([3000]);
    expect(withRecentPort([3000], 65536)).toEqual([3000]);
    expect(withRecentPort([3000], 3000.5)).toEqual([3000]);
  });
});

describe('deciding whether a write is worth making', () => {
  test('an unchanged list is the same list', () => {
    expect(samePorts([3000, 8080], [3000, 8080])).toBe(true);
  });

  test('order is part of the answer, because order is what the row shows', () => {
    expect(samePorts([3000, 8080], [8080, 3000])).toBe(false);
  });

  test('a server with nothing stored differs from one with something', () => {
    expect(samePorts(undefined, [3000])).toBe(false);
    expect(samePorts([3000], [])).toBe(false);
  });
});

describe('holding many servers', () => {
  test('a server that was just used moves to the young end', () => {
    const index = { a: [3000], b: [8080] };
    expect(Object.keys(withMirroredPorts(index, 'a', [5173]))).toEqual(['b', 'a']);
  });

  test('a server whose list emptied is removed rather than kept as nothing', () => {
    expect(withMirroredPorts({ a: [3000], b: [8080] }, 'a', [])).toEqual({ b: [8080] });
  });

  test('the quietest server is evicted once the cap is reached', () => {
    let index = {};
    for (let n = 0; n < MAX_MIRRORED_PORT_SERVERS + 3; n += 1) {
      index = withMirroredPorts(index, `server-${n}`, [3000 + n]);
    }
    const ids = Object.keys(index);
    expect(ids).toHaveLength(MAX_MIRRORED_PORT_SERVERS);
    expect(ids).not.toContain('server-0');
    expect(ids[ids.length - 1]).toBe(`server-${MAX_MIRRORED_PORT_SERVERS + 2}`);
  });
});

describe('reading the mirror back off the device', () => {
  test('round-trips what was written', () => {
    const index = withMirroredPorts({}, 'osk', [3000, 8080]);
    expect(parseServerWebPortsIndex(JSON.stringify(index))).toEqual(index);
  });

  test('re-validates every entry rather than trusting the blob', () => {
    expect(
      parseServerWebPortsIndex('{"osk":[3000,0,"8080",70000,5173],"":[3000],"quiet":[]}')
    ).toEqual({ osk: [3000, 5173] });
  });

  test('a mirror that cannot be read is simply no shortcuts', () => {
    expect(parseServerWebPortsIndex('not json')).toEqual({});
    expect(parseServerWebPortsIndex('[3000]')).toEqual({});
    expect(parseServerWebPortsIndex('null')).toEqual({});
  });
});

// Remembering where simfarm is, per server (card #851).
//
// The mirror is small; what matters is that it degrades to "ask again" rather
// than to a URL with a bad number in it, and that the trim drops the machine
// nobody has previewed in the longest time rather than the one in use.
import { describe, expect, test } from 'bun:test';

import type { ServerSimfarmIndex } from '@/lib/server-simfarm';
import {
  MAX_REMEMBERED_SIMFARM_SERVERS,
  parseServerSimfarmIndex,
  withSimfarmPort,
  withoutSimfarmServer,
} from '@/lib/server-simfarm';

describe('parseServerSimfarmIndex', () => {
  test('reads what was written', () => {
    expect(parseServerSimfarmIndex('{"srv-a":8801,"srv-b":9000}')).toEqual({
      'srv-a': 8801,
      'srv-b': 9000,
    });
  });

  test('nothing stored is no opinion, not a crash', () => {
    expect(parseServerSimfarmIndex(null)).toEqual({});
    expect(parseServerSimfarmIndex('')).toEqual({});
  });

  test('a half-written or foreign value degrades to asking again', () => {
    for (const raw of ['not json', '[]', 'null', '"a string"', '42']) {
      expect(parseServerSimfarmIndex(raw)).toEqual({});
    }
  });

  test('drops entries that could not become a URL', () => {
    const raw = JSON.stringify({
      ok: 8801,
      zero: 0,
      huge: 70000,
      fractional: 88.5,
      text: '8801',
      nothing: null,
      '': 8801,
    });
    expect(parseServerSimfarmIndex(raw)).toEqual({ ok: 8801 });
  });
});

describe('withSimfarmPort', () => {
  test('records a port', () => {
    expect(withSimfarmPort({}, 'srv-a', 8801)).toEqual({ 'srv-a': 8801 });
  });

  test('replaces rather than accumulating: a machine runs one simfarm', () => {
    const once = withSimfarmPort({}, 'srv-a', 8801);
    expect(withSimfarmPort(once, 'srv-a', 9000)).toEqual({ 'srv-a': 9000 });
  });

  test('an unchanged answer is not a write', () => {
    const index = withSimfarmPort({}, 'srv-a', 8801);
    expect(withSimfarmPort(index, 'srv-a', 8801)).toBe(index);
  });

  test('refuses a port that is not one', () => {
    expect(withSimfarmPort({}, 'srv-a', 0)).toEqual({});
    expect(withSimfarmPort({}, 'srv-a', 70000)).toEqual({});
    expect(withSimfarmPort({}, '', 8801)).toEqual({});
  });

  test('the trim drops the least recently used, never the one being written', () => {
    let index: ServerSimfarmIndex = {};
    for (let i = 0; i < MAX_REMEMBERED_SIMFARM_SERVERS + 5; i += 1) {
      index = withSimfarmPort(index, `srv-${i}`, 8800 + i);
    }
    const keys = Object.keys(index);
    expect(keys).toHaveLength(MAX_REMEMBERED_SIMFARM_SERVERS);
    expect(keys.at(-1)).toBe(`srv-${MAX_REMEMBERED_SIMFARM_SERVERS + 4}`);
    expect(keys).not.toContain('srv-0');
  });

  test('re-recording an old server moves it out of the trim path', () => {
    let index: ServerSimfarmIndex = {};
    for (let i = 0; i < MAX_REMEMBERED_SIMFARM_SERVERS; i += 1) {
      index = withSimfarmPort(index, `srv-${i}`, 8800 + i);
    }
    index = withSimfarmPort(index, 'srv-0', 9999);
    index = withSimfarmPort(index, 'fresh', 8801);
    expect(index['srv-0']).toBe(9999);
    expect(index['srv-1']).toBeUndefined();
  });
});

describe('withoutSimfarmServer', () => {
  test('forgets an unpaired server', () => {
    const index = withSimfarmPort(withSimfarmPort({}, 'a', 8801), 'b', 9000);
    expect(withoutSimfarmServer(index, 'a')).toEqual({ b: 9000 });
  });

  test('forgetting what was never there is not a write', () => {
    const index = withSimfarmPort({}, 'a', 8801);
    expect(withoutSimfarmServer(index, 'b')).toBe(index);
  });
});

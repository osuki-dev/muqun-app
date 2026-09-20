// One request per identical question in flight, and not one thing more.
//
// The two ways this can be wrong are opposite and both bad. Dedupe too little
// and the home screen keeps putting the same GET on the wire twice in a frame,
// which is what it was written for. Dedupe too much -- a POST, a stream, an
// upload, two GETs that differ in a header -- and the app silently loses a
// send, or hands a caller an answer to somebody else's question.
import { beforeEach, describe, expect, test } from 'bun:test';

import { dedupeKey, withRequestDedupe } from '../request-dedupe';

let flights: Map<string, Promise<Response>>;

beforeEach(() => {
  flights = new Map();
});

/**
 * A stand-in for `NitroResponse`: a body that can be read once, and a `clone`
 * that refuses after it has been. That refusal is the property the real thing
 * has and the reason every caller is handed a copy.
 */
function fakeResponse(body: string): Response {
  let used = false;
  const response = {
    get bodyUsed() {
      return used;
    },
    async text() {
      if (used) throw new TypeError('Body has already been read.');
      used = true;
      return body;
    },
    clone() {
      if (used) throw new TypeError('Cannot clone a Response whose body has been used.');
      return fakeResponse(body);
    },
  };
  return response as unknown as Response;
}

/**
 * A runner that counts how many times it was actually asked to fetch, and does
 * not answer until released -- so a second caller genuinely overlaps the first.
 */
function counting(body = 'ok') {
  let calls = 0;
  let open = () => {};
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  return {
    get calls() {
      return calls;
    },
    release: () => open(),
    run: async () => {
      calls += 1;
      await gate;
      return fakeResponse(body);
    },
  };
}

describe('the key', () => {
  test('two identical GETs are the same question', () => {
    expect(dedupeKey('https://gw/health', undefined, 8000)).toBe(
      dedupeKey('https://gw/health', { method: 'GET' }, 8000)
    );
  });

  test('a different path is a different question', () => {
    expect(dedupeKey('https://gw/health', undefined, 8000)).not.toBe(
      dedupeKey('https://gw/api/sessions', undefined, 8000)
    );
  });

  test('a query string is part of the question', () => {
    // `/panes/%9/output?lines=240` and `?lines=2000` are not the same read.
    expect(dedupeKey('https://gw/o?lines=240', undefined, 8000)).not.toBe(
      dedupeKey('https://gw/o?lines=2000', undefined, 8000)
    );
  });

  test('a caller asking in another language is asking something else', () => {
    expect(dedupeKey('https://gw/health', { headers: { 'Accept-Language': 'en' } }, 8000)).not.toBe(
      dedupeKey('https://gw/health', { headers: { 'Accept-Language': 'ja' } }, 8000)
    );
  });

  test('header order and case do not make two questions out of one', () => {
    expect(dedupeKey('https://gw/h', { headers: { A: '1', B: '2' } }, 8000)).toBe(
      dedupeKey('https://gw/h', { headers: { b: '2', a: '1' } }, 8000)
    );
  });

  test('a shorter deadline is not answered by a longer one', () => {
    // A joiner would otherwise inherit whichever budget happened to be first.
    expect(dedupeKey('https://gw/h', undefined, 4000)).not.toBe(
      dedupeKey('https://gw/h', undefined, 8000)
    );
  });

  test('a URL object and its string spell the same key', () => {
    expect(dedupeKey(new URL('https://gw/health'), undefined, 8000)).toBe(
      dedupeKey('https://gw/health', undefined, 8000)
    );
  });

  describe('what is never deduplicated', () => {
    test('anything that is not a GET', () => {
      // Two sends, spawns or approvals are two instructions. Collapsing them
      // would lose work with nothing on screen to say so.
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
        expect(dedupeKey('https://gw/api/send', { method }, 8000)).toBeNull();
    });

    test('a GET carrying a body, which the key does not cover', () => {
      expect(dedupeKey('https://gw/h', { method: 'GET', body: '{}' }, 8000)).toBeNull();
    });

    test('an event stream, which is a subscription rather than an answer', () => {
      expect(
        dedupeKey('https://gw/events', { headers: { Accept: 'text/event-stream' } }, 8000)
      ).toBeNull();
      expect(
        dedupeKey('https://gw/events', { stream: true } as unknown as RequestInit, 8000)
      ).toBeNull();
    });

    test('an upload, whose body must never be held for a joiner', () => {
      expect(
        dedupeKey('https://gw/assets', { upload: true } as unknown as RequestInit, 60_000)
      ).toBeNull();
    });
  });
});

describe('joining a flight', () => {
  test('two overlapping callers cost one request and both get a body', async () => {
    const fetcher = counting('hello');
    const key = dedupeKey('https://gw/health', undefined, 8000);
    const first = withRequestDedupe(flights, key, fetcher.run);
    const second = withRequestDedupe(flights, key, fetcher.run);
    fetcher.release();
    const [a, b] = await Promise.all([first, second]);
    expect(fetcher.calls).toBe(1);
    // Separate bodies, not one body read twice.
    expect(await a.text()).toBe('hello');
    expect(await b.text()).toBe('hello');
  });

  test('the entry is gone once it settles, so this is not a cache', async () => {
    const fetcher = counting();
    const key = dedupeKey('https://gw/health', undefined, 8000);
    const first = withRequestDedupe(flights, key, fetcher.run);
    fetcher.release();
    await first;
    expect(flights.size).toBe(0);
    // A question asked after the answer came back is a new question.
    const later = counting();
    const second = withRequestDedupe(flights, key, later.run);
    later.release();
    await second;
    expect(later.calls).toBe(1);
  });

  test('a failure is shared by everyone waiting, and clears the entry', async () => {
    let calls = 0;
    const run = async () => {
      calls += 1;
      throw new Error('Timed out waiting for the server.');
    };
    const key = dedupeKey('https://gw/health', undefined, 8000);
    // Settled together: waiting on one while the other sits rejected and
    // unobserved is an unhandled rejection, not a property of the code.
    const settled = await Promise.allSettled([
      withRequestDedupe(flights, key, run),
      withRequestDedupe(flights, key, run),
    ]);
    expect(settled.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
    for (const outcome of settled)
      expect((outcome as PromiseRejectedResult).reason.message).toBe(
        'Timed out waiting for the server.'
      );
    expect(calls).toBe(1);
    expect(flights.size).toBe(0);
  });

  test('a null key is passed straight through, every time', async () => {
    const fetcher = counting();
    const first = withRequestDedupe(flights, null, fetcher.run);
    const second = withRequestDedupe(flights, null, fetcher.run);
    fetcher.release();
    await Promise.all([first, second]);
    expect(fetcher.calls).toBe(2);
    expect(flights.size).toBe(0);
  });

  test('a transport with no usable clone makes the joiner ask for itself', async () => {
    // Degrades to the behaviour that existed before the dedupe, rather than
    // handing anyone a response whose body somebody else has taken.
    let calls = 0;
    const run = async () => {
      calls += 1;
      return { async text() {} } as unknown as Response;
    };
    const key = dedupeKey('https://gw/health', undefined, 8000);
    await Promise.all([withRequestDedupe(flights, key, run), withRequestDedupe(flights, key, run)]);
    expect(calls).toBe(2);
  });

  test('different questions do not join each other', async () => {
    const fetcher = counting();
    const health = withRequestDedupe(
      flights,
      dedupeKey('https://gw/health', undefined, 8000),
      fetcher.run
    );
    const sessions = withRequestDedupe(
      flights,
      dedupeKey('https://gw/api/sessions', undefined, 8000),
      fetcher.run
    );
    expect(flights.size).toBe(2);
    fetcher.release();
    await Promise.all([health, sessions]);
    expect(fetcher.calls).toBe(2);
  });
});

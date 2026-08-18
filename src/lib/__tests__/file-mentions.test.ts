// The `@` mention contract, as assertions.
//
// Three things are worth pinning here, and they are the three things that make
// the feature feel wrong when they slip: when an `@` is a mention and when it is
// just an `@`, what exactly lands in the draft when one is picked, and the
// promise that a slow answer for an old prefix can never overwrite the panel.
import { describe, expect, test } from 'bun:test';

import {
  FILE_MENTION_DEBOUNCE_MS,
  createFileMentionSearch,
  fileMentionHitsFromResponse,
  findFileMentionTrigger,
  insertFileMention,
  MAX_FILE_MENTION_QUERY,
  type FileMentionHit,
} from '../file-mentions';

/**
 * A clock the test drives by hand. Timers fire only when `advance` reaches them,
 * so "debounced" is asserted as "did not run yet", not as "ran late".
 */
function fakeTimers() {
  let now = 0;
  let nextId = 1;
  const scheduled = new Map<number, { at: number; fn: () => void }>();
  return {
    timers: {
      setTimeout: (fn: () => void, ms: number) => {
        const id = nextId++;
        scheduled.set(id, { at: now + ms, fn });
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout: (handle: ReturnType<typeof setTimeout>) => {
        scheduled.delete(handle as unknown as number);
      },
    },
    advance(ms: number) {
      now += ms;
      for (const [id, entry] of [...scheduled.entries()]) {
        if (entry.at <= now) {
          scheduled.delete(id);
          entry.fn();
        }
      }
    },
    get pending() {
      return scheduled.size;
    },
  };
}

/** A promise whose settling the test controls, so "in flight" is a real state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const hit = (path: string): FileMentionHit => ({
  path,
  name: path.slice(path.lastIndexOf('/') + 1),
  kind: 'text',
});

describe('when an @ opens a mention', () => {
  test('an @ at the start of the draft opens one', () => {
    expect(findFileMentionTrigger('@', 1)).toEqual({ start: 0, end: 1, query: '' });
  });

  test('an @ after a space opens one, and what follows is the query', () => {
    expect(findFileMentionTrigger('look at @theme', 14)).toEqual({
      start: 8,
      end: 14,
      query: 'theme',
    });
  });

  test('an @ at the start of a later line opens one', () => {
    expect(findFileMentionTrigger('first\n@src', 10)).toEqual({ start: 6, end: 10, query: 'src' });
  });

  test('an @ inside a word does not, so an email address is just text', () => {
    expect(findFileMentionTrigger('mail me at ellen@example.com', 28)).toBeNull();
  });

  test('a version pin is a word, not a mention', () => {
    expect(findFileMentionTrigger('npm i expo@57', 13)).toBeNull();
  });

  test('a space after the @ closes it, because a path has no spaces in it', () => {
    expect(findFileMentionTrigger('@theme ts', 9)).toBeNull();
  });

  test('the caret decides, so a caret moved back into an old @word reopens it', () => {
    // "@theme.ts done", caret parked just after "@the".
    expect(findFileMentionTrigger('@theme.ts done', 4)).toEqual({ start: 0, end: 4, query: 'the' });
  });

  test('a caret before the @ is not inside it', () => {
    expect(findFileMentionTrigger('hi @theme', 3)).toBeNull();
  });

  test('a caret at zero, which is how a range selection arrives, opens nothing', () => {
    expect(findFileMentionTrigger('@theme', 0)).toBeNull();
    expect(findFileMentionTrigger('@theme', -1)).toBeNull();
  });

  test('a query past the cap stops being a file query', () => {
    const long = `@${'a'.repeat(MAX_FILE_MENTION_QUERY + 1)}`;
    expect(findFileMentionTrigger(long, long.length)).toBeNull();
  });

  test('the last @ wins, so re-mentioning next to a finished one still works', () => {
    const text = '@src/a.ts @b';
    expect(findFileMentionTrigger(text, text.length)).toEqual({ start: 10, end: 12, query: 'b' });
  });
});

describe('what picking a file puts in the draft', () => {
  test('the path replaces the @query and a space follows it', () => {
    const trigger = findFileMentionTrigger('open @the', 9)!;
    expect(insertFileMention('open @the', trigger, 'src/theme.ts')).toEqual({
      text: 'open src/theme.ts ',
      caret: 18,
    });
  });

  test('the path goes in byte for byte -- no quoting, no @ put back', () => {
    const trigger = findFileMentionTrigger('@a', 2)!;
    const { text } = insertFileMention('@a', trigger, 'src/文档/naïve name.ts');
    expect(text).toBe('src/文档/naïve name.ts ');
  });

  test('text after the mention is kept, and the caret lands before it', () => {
    const draft = 'check @th then ship';
    const trigger = findFileMentionTrigger(draft, 9)!;
    const result = insertFileMention(draft, trigger, 'app.json');
    expect(result.text).toBe('check app.json then ship');
    expect(result.caret).toBe(15);
    expect(result.text.slice(result.caret)).toBe('then ship');
  });

  test('a space already there is stepped over rather than doubled', () => {
    const draft = '@th rest';
    const trigger = findFileMentionTrigger(draft, 3)!;
    const result = insertFileMention(draft, trigger, 'app.json');
    expect(result.text).toBe('app.json rest');
    expect(result.caret).toBe(9);
  });

  test('the inserted mention no longer reads as an open one', () => {
    const trigger = findFileMentionTrigger('@a', 2)!;
    const result = insertFileMention('@a', trigger, 'app.json');
    expect(findFileMentionTrigger(result.text, result.caret)).toBeNull();
  });
});

describe('reading the gateway answer', () => {
  const envelope = (files: unknown[], root: string | null = '/w') => ({
    schema_version: '1.3.0',
    data: { session_id: 's', pane_id: 'p', query: '', limit: 20, root, files },
  });

  test('hits come through with path, name and kind', () => {
    expect(
      fileMentionHitsFromResponse(envelope([{ path: 'src/theme.ts', name: 'theme.ts', kind: 'text' }]))
    ).toEqual([{ path: 'src/theme.ts', name: 'theme.ts', kind: 'text' }]);
  });

  test('a pane with no workspace answers nothing rather than failing', () => {
    expect(fileMentionHitsFromResponse(envelope([], null))).toEqual([]);
  });

  test('an entry with no path is not a file and is dropped', () => {
    expect(fileMentionHitsFromResponse(envelope([{ name: 'x', kind: 'text' }, 7, null]))).toEqual([]);
  });

  test('a missing name is derived from the path, and a missing kind reads as text', () => {
    expect(fileMentionHitsFromResponse(envelope([{ path: 'docs/deep/notes.md' }]))).toEqual([
      { path: 'docs/deep/notes.md', name: 'notes.md', kind: 'text' },
    ]);
  });

  test('junk instead of an envelope is an empty list, not a throw', () => {
    expect(fileMentionHitsFromResponse(null)).toEqual([]);
    expect(fileMentionHitsFromResponse({ data: { files: 'nope' } })).toEqual([]);
  });
});

describe('debouncing and cancelling', () => {
  test('typing fast asks once, for the last thing typed', () => {
    const clock = fakeTimers();
    const asked: string[] = [];
    const search = createFileMentionSearch({
      search: (query) => {
        asked.push(query);
        return Promise.resolve([]);
      },
      onResults: () => {},
      timers: clock.timers,
    });

    search.request('t');
    search.request('th');
    search.request('the');
    clock.advance(FILE_MENTION_DEBOUNCE_MS - 1);
    expect(asked).toEqual([]);

    clock.advance(1);
    expect(asked).toEqual(['the']);
  });

  test('a bare @ skips the wait, so the first screen is not late', () => {
    const clock = fakeTimers();
    const asked: string[] = [];
    const search = createFileMentionSearch({
      search: (query) => {
        asked.push(query);
        return Promise.resolve([]);
      },
      onResults: () => {},
      timers: clock.timers,
    });

    search.request('', { immediate: true });
    expect(asked).toEqual(['']);
    expect(clock.pending).toBe(0);
  });

  test('an answer for a prefix the user has typed past never reaches the panel', async () => {
    const clock = fakeTimers();
    const slow = deferred<FileMentionHit[]>();
    const fast = deferred<FileMentionHit[]>();
    const queue = [slow, fast];
    const rendered: string[] = [];
    const search = createFileMentionSearch({
      search: () => queue.shift()!.promise,
      onResults: (query) => rendered.push(query),
      timers: clock.timers,
    });

    search.request('th');
    clock.advance(FILE_MENTION_DEBOUNCE_MS);
    search.request('theme');
    clock.advance(FILE_MENTION_DEBOUNCE_MS);

    // The stale request answers last, which is exactly the case that used to
    // repaint the panel with results for a prefix nobody is looking at.
    fast.resolve([hit('src/theme.ts')]);
    slow.resolve([hit('src/th-anything.ts')]);
    await Promise.resolve();
    await Promise.resolve();

    expect(rendered).toEqual(['theme']);
  });

  test('cancelling drops the pending request and invalidates the in-flight one', async () => {
    const clock = fakeTimers();
    const flight = deferred<FileMentionHit[]>();
    let asked = 0;
    const rendered: FileMentionHit[][] = [];
    const search = createFileMentionSearch({
      search: () => {
        asked += 1;
        return flight.promise;
      },
      onResults: (_query, hits) => rendered.push(hits),
      timers: clock.timers,
    });

    search.request('theme');
    clock.advance(FILE_MENTION_DEBOUNCE_MS);
    expect(asked).toBe(1);

    search.cancel();
    flight.resolve([hit('src/theme.ts')]);
    await Promise.resolve();
    await Promise.resolve();

    expect(rendered).toEqual([]);
    expect(search.isPending()).toBe(false);
  });

  test('cancelling before the debounce elapses never asks at all', () => {
    const clock = fakeTimers();
    let asked = 0;
    const search = createFileMentionSearch({
      search: () => {
        asked += 1;
        return Promise.resolve([]);
      },
      onResults: () => {},
      timers: clock.timers,
    });

    search.request('theme');
    search.cancel();
    clock.advance(FILE_MENTION_DEBOUNCE_MS * 4);

    expect(asked).toBe(0);
    expect(clock.pending).toBe(0);
  });

  test('an offline gateway is silence, not an error the composer has to show', async () => {
    const clock = fakeTimers();
    const rendered: FileMentionHit[][] = [];
    const search = createFileMentionSearch({
      search: () => Promise.reject(new Error('Network request failed')),
      onResults: (_query, hits) => rendered.push(hits),
      timers: clock.timers,
    });

    search.request('theme');
    clock.advance(FILE_MENTION_DEBOUNCE_MS);
    await Promise.resolve();
    await Promise.resolve();

    expect(rendered).toEqual([]);
    expect(search.isPending()).toBe(false);
  });

  test('a search that throws where it stands is the same silence', () => {
    const clock = fakeTimers();
    const rendered: FileMentionHit[][] = [];
    const search = createFileMentionSearch({
      search: () => {
        throw new Error('no base url');
      },
      onResults: (_query, hits) => rendered.push(hits),
      timers: clock.timers,
    });

    expect(() => {
      search.request('theme');
      clock.advance(FILE_MENTION_DEBOUNCE_MS);
    }).not.toThrow();
    expect(rendered).toEqual([]);
  });
});

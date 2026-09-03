// The rule these tests exist to hold down is one line long: a request that
// stops halfway must still end.
//
// The defect they are a fence around is easy to reintroduce, because the code
// that has it looks correct. `fetch` resolves when the response HEADERS arrive,
// so an abort timer cleared in a `finally` around the fetch call is cleared
// while the body is still on the wire. Every `await response.json()` after that
// has no deadline at all, and a server that answers 200 and then stalls
// mid-body hangs the caller forever -- no error, no timeout, a spinner that
// never stops. `readAssetText` was fixed for this once; `gatewayFetch` had the
// same hole, which is what these cover.
/// <reference types="node" />
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  answerHasNoBody,
  headerRecord,
  isStreamingRequest,
  startRequestBudget,
  withBodyDeadline,
} from '../request-budget';

/** Long enough to be deliberate, short enough that the suite stays fast. */
const BUDGET_MS = 25;

const never = new Promise<never>(() => {});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A stand-in for what the transport hands back.
 *
 * It keeps its state in a `#private` field on purpose: that is what makes
 * calling a method with the proxy as `this` throw, so the test proves the proxy
 * binds to the target rather than merely appearing to work.
 */
class FakeResponse {
  readonly #body: () => Promise<string>;
  readonly ok = true;
  readonly headers = new Map<string, string>([['content-type', 'application/json']]);

  constructor(
    body: () => Promise<string>,
    readonly status = 200
  ) {
    this.#body = body;
  }

  text(): Promise<string> {
    return this.#body();
  }

  async json(): Promise<unknown> {
    return JSON.parse(await this.#body());
  }
}

function fake(body: () => Promise<string>, status = 200): Response {
  return new FakeResponse(body, status) as unknown as Response;
}

describe('the clock on a request', () => {
  test('a request that never answers ends, in the caller words the user reads', async () => {
    const budget = startRequestBudget(BUDGET_MS, 'The server stopped responding.');
    await expect(Promise.race([never, budget.deadline])).rejects.toThrow(
      'The server stopped responding.'
    );
  });

  test('running out of budget also aborts, so the socket is let go of', async () => {
    const budget = startRequestBudget(BUDGET_MS, 'gone');
    expect(budget.signal.aborted).toBe(false);
    await expect(Promise.race([never, budget.deadline])).rejects.toThrow('gone');
    expect(budget.signal.aborted).toBe(true);
  });

  test('a disarmed budget never fires, so a finished request is not aborted later', async () => {
    const budget = startRequestBudget(BUDGET_MS, 'gone');
    budget.disarm();
    await sleep(BUDGET_MS * 3);
    expect(budget.signal.aborted).toBe(false);
  });

  test('the caller cancelling cancels the request', () => {
    const caller = new AbortController();
    const budget = startRequestBudget(BUDGET_MS, 'gone', caller.signal);
    expect(budget.signal.aborted).toBe(false);
    caller.abort();
    expect(budget.signal.aborted).toBe(true);
  });

  test('a caller that had already given up never opens the request at all', () => {
    const caller = new AbortController();
    caller.abort();
    expect(startRequestBudget(BUDGET_MS, 'gone', caller.signal).signal.aborted).toBe(true);
  });
});

describe('the body is inside the budget, not outside it', () => {
  test('a body that never arrives rejects rather than hanging the caller', async () => {
    // This is the whole point. Before the fix the deadline was cleared the
    // moment the headers landed, and this promise never settled.
    const budget = startRequestBudget(BUDGET_MS, 'The server stopped responding.');
    const response = withBodyDeadline(
      fake(() => never),
      budget
    );

    await expect(response.text()).rejects.toThrow('The server stopped responding.');
    expect(budget.signal.aborted).toBe(true);
  });

  test('a body that stalls after the headers is still caught by json()', async () => {
    const budget = startRequestBudget(BUDGET_MS, 'The server stopped responding.');
    const response = withBodyDeadline(
      fake(() => never),
      budget
    );
    await expect(response.json()).rejects.toThrow('The server stopped responding.');
  });

  test('a body that does arrive is returned, and stops the clock', async () => {
    const budget = startRequestBudget(BUDGET_MS, 'gone');
    const response = withBodyDeadline(
      fake(async () => '{"ok":true}'),
      budget
    );

    expect(await response.json()).toEqual({ ok: true });
    // Disarmed by the read, so the timer cannot come back and abort a request
    // that already finished.
    await sleep(BUDGET_MS * 3);
    expect(budget.signal.aborted).toBe(false);
  });

  test('a body that fails on its own reports its own failure, not the deadline', async () => {
    const budget = startRequestBudget(BUDGET_MS, 'The server stopped responding.');
    const response = withBodyDeadline(
      fake(() => Promise.reject(new Error('Network is unreachable.'))),
      budget
    );
    await expect(response.text()).rejects.toThrow('Network is unreachable.');
  });

  test('everything that is not a body reader is the response it always was', () => {
    const budget = startRequestBudget(BUDGET_MS, 'gone');
    const response = withBodyDeadline(
      fake(async () => 'x', 404),
      budget
    );

    expect(response.status).toBe(404);
    expect(response.ok).toBe(true);
    // A method that reads private state, called through the proxy: it works
    // only because the proxy binds to the target.
    expect((response.headers as unknown as Map<string, string>).get('content-type')).toBe(
      'application/json'
    );
    budget.disarm();
  });
});

describe('answers with nothing left to wait for', () => {
  test('a HEAD is finished when its headers land', () => {
    expect(answerHasNoBody('HEAD', 200)).toBe(true);
    expect(answerHasNoBody('head', 200)).toBe(true);
  });

  test('204 and 205 say so in the status', () => {
    expect(answerHasNoBody('GET', 204)).toBe(true);
    expect(answerHasNoBody('POST', 205)).toBe(true);
  });

  test('an ordinary answer still has a body to wait for', () => {
    expect(answerHasNoBody('GET', 200)).toBe(false);
    expect(answerHasNoBody(undefined, 200)).toBe(false);
    expect(answerHasNoBody('DELETE', 200)).toBe(false);
  });
});

describe('streams are exempt, because a stream is not a slow request', () => {
  test('nitro-fetch asked for a readable body', () => {
    expect(isStreamingRequest({ stream: true } as RequestInit)).toBe(true);
  });

  test('the caller asked for server-sent events', () => {
    expect(isStreamingRequest({ headers: { Accept: 'text/event-stream' } })).toBe(true);
  });

  test('a header name is a header name whatever its case', () => {
    expect(isStreamingRequest({ headers: { accept: 'text/event-stream' } })).toBe(true);
    expect(isStreamingRequest({ headers: [['ACCEPT', 'text/event-stream']] })).toBe(true);
  });

  test('an ordinary request is on the clock like everything else', () => {
    expect(isStreamingRequest(undefined)).toBe(false);
    expect(isStreamingRequest({})).toBe(false);
    expect(isStreamingRequest({ headers: { Accept: 'application/json' } })).toBe(false);
    expect(isStreamingRequest({ stream: false } as RequestInit)).toBe(false);
  });
});

describe('the words a budget runs out with', () => {
  // `describeGatewayFailure` decides what kind of failure it is looking at by
  // reading the message, and only "abort"/"timeout"/"timed out" earn the
  // translated, retryable "Gateway did not respond in time." Anything else is
  // filed as a plain request error: shown to the user verbatim -- in English,
  // in every locale -- and marked not worth retrying. So the phrasing passed to
  // `fetchWithin` is a contract, not a wording choice, and it is one nothing at
  // run time would complain about breaking.
  //
  // Scanned from the source because that classifier imports the Lingui macro,
  // which needs the Babel transform this suite does not run. The precedent is
  // `i18n/macro-expansion.test.ts`, which reads source for the same reason: the
  // failure is silent, ships, and is invisible in review.
  const CLIENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'gateway-client.ts');
  const TIMEOUT_WORDS = /abort|timeout|timed out/i;

  test('every deadline in the gateway client says it timed out', () => {
    const source = readFileSync(CLIENT, 'utf8');
    const messages = [
      ...source.matchAll(/fetchWithin\(\s*[\w.]+,\s*(?:\/\/[^\n]*\n\s*)*'([^']+)'/g),
    ].map((match) => match[1]);

    // If this is empty the regex has drifted, and an empty list would pass the
    // assertion below while checking nothing at all.
    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(messages.filter((message) => !TIMEOUT_WORDS.test(message))).toEqual([]);
  });
});

describe('headers arrive in three shapes and leave in one', () => {
  test('a record passes through', () => {
    expect(headerRecord({ Authorization: 'Bearer t' })).toEqual({ Authorization: 'Bearer t' });
  });

  test('nothing is an empty record, not a crash', () => {
    expect(headerRecord(undefined)).toEqual({});
  });

  test('pairs become a record', () => {
    expect(headerRecord([['Authorization', 'Bearer t']])).toEqual({ Authorization: 'Bearer t' });
  });

  test('a Headers instance keeps its entries instead of spreading to nothing', () => {
    // Spreading a `Headers` yields `{}`, which would silently drop auth.
    expect(headerRecord(new Headers({ authorization: 'Bearer t' }))).toEqual({
      authorization: 'Bearer t',
    });
  });
});

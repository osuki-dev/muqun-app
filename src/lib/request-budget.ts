/**
 * A deadline for a whole HTTP request -- headers and body both.
 *
 * The bug this module exists to make impossible: `fetch` resolves when the
 * response HEADERS arrive, not when the body has been read. An abort timer
 * cleared in a `finally` around the fetch call is therefore cleared while the
 * body is still on the wire, and every `await response.json()` after it runs
 * with no deadline at all. A server that answers 200 and then stalls mid-body
 * leaves the caller awaiting forever: no error, no timeout, a spinner that
 * never stops.
 *
 * The pieces here are the parts of the fix that can be wrong on their own, kept
 * away from the transport so they can be tested without one. `gateway-client`
 * is what wires them to `nitroFetch`.
 */

export interface RequestBudget {
  /** Hand this to the transport; it is aborted when the budget runs out. */
  readonly signal: AbortSignal;
  /**
   * Rejects with the caller's message when the budget runs out, and otherwise
   * never settles.
   *
   * A race, and not only an abort. Aborting is a request, and one the transport
   * is free to answer late or not at all; the race is the part that guarantees
   * the caller's promise SETTLES, which is what a screen needs in order to stop
   * spinning. Both are kept: the abort frees the socket, the race frees the
   * screen.
   */
  readonly deadline: Promise<never>;
  /** Stop the clock, because nothing more is going to be read. Idempotent. */
  disarm(): void;
}

/**
 * Start the clock on one request.
 *
 * @param timeoutMs How long the whole request may take.
 * @param message What to say when it does not, in the caller's own words --
 *   this is the text a user may end up reading.
 * @param callerSignal The caller's own cancellation, if it has one. It is
 *   chained onto the same controller, so a viewer that closes stops the
 *   download rather than letting it run to completion into a screen that is
 *   gone.
 */
export function startRequestBudget(
  timeoutMs: number,
  message: string,
  callerSignal?: AbortSignal | null
): RequestBudget {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (callerSignal?.aborted) abort();
  callerSignal?.addEventListener('abort', abort);
  const release = () => callerSignal?.removeEventListener('abort', abort);

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      abort();
      release();
      reject(new Error(message));
    }, timeoutMs);
  });
  // The deadline can fire with nothing racing it -- a caller that reads no
  // body, a HEAD, a request already abandoned -- and an unhandled rejection is
  // a red box in development. Attaching a handler marks it handled without
  // hiding it from `Promise.race`, which subscribes to this promise rather than
  // to the derived one made here.
  deadline.catch(() => {});

  return {
    signal: controller.signal,
    deadline,
    disarm() {
      clearTimeout(timeout);
      release();
    },
  };
}

/** The response methods that return the body, and so have to share the budget. */
const BODY_READERS = new Set(['arrayBuffer', 'blob', 'bytes', 'formData', 'json', 'text']);

/**
 * The same response, with the promise for its body brought inside the budget.
 *
 * A proxy rather than a rebuilt `Response`: what comes back has to stay the
 * object the transport made -- same headers, same `body` stream, same `clone()`
 * -- and only the reading of it needs a deadline. Methods are bound to the
 * target because a class with private fields is entitled to refuse a proxy as
 * its `this`.
 *
 * Whichever reader is called first settles the budget for the whole request; a
 * body is read once, and `bodyUsed` makes a second call an error anyway.
 */
export function withBodyDeadline(response: Response, budget: RequestBudget): Response {
  return new Proxy(response, {
    get(target, property) {
      const value = Reflect.get(target, property, target) as unknown;
      if (typeof value !== 'function') return value;
      const method = (value as (...args: unknown[]) => unknown).bind(target);
      if (typeof property !== 'string' || !BODY_READERS.has(property)) return method;
      return (...args: unknown[]) =>
        Promise.race([Promise.resolve(method(...args)), budget.deadline]).finally(() =>
          budget.disarm()
        );
    },
  });
}

/**
 * Whether there is a body still to wait for.
 *
 * A response without one is finished the moment its headers land, so it can let
 * go of the budget straight away instead of holding a timer that would abort a
 * completed request some seconds from now.
 */
export function answerHasNoBody(method: string | undefined, status: number): boolean {
  return (method ?? 'GET').toUpperCase() === 'HEAD' || status === 204 || status === 205;
}

/**
 * Whether this request is a long-lived stream, and so exempt from any budget.
 *
 * A stream is not a slow request, and a deadline on one would be a bug rather
 * than a safety net: an SSE connection is meant to stay open until the app
 * closes it, and the pane event stream can sit silent for minutes between
 * frames. Such a request is cancelled only by its caller's own signal, which is
 * how `use-pane-events` already ends and restarts it.
 *
 * That hook calls the transport directly and so never reaches the budgeted
 * path, which makes this a guard rather than a live branch today. It is the
 * guard that makes routing a stream through `gatewayFetch` safe later, instead
 * of quietly capping it at eight seconds and leaving the reconnect loop chasing
 * a mystery.
 */
export function isStreamingRequest(init: RequestInit | undefined): boolean {
  if (!init) return false;
  // nitro-fetch's own opt-in for a readable body, which is not part of the
  // standard `RequestInit` the call is typed against.
  if ((init as { stream?: unknown }).stream === true) return true;
  const accept = Object.entries(headerRecord(init.headers)).find(
    ([name]) => name.toLowerCase() === 'accept'
  )?.[1];
  return typeof accept === 'string' && accept.includes('text/event-stream');
}

/**
 * Flatten whatever shape a caller passed for headers into a plain record.
 *
 * `HeadersInit` is three types, and spreading a `Headers` instance yields an
 * empty object rather than its entries -- which would silently drop an
 * Authorization header. Every call site in the gateway client passes a record
 * today; this is here so that staying true stops being load-bearing.
 */
export function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  return headers as Record<string, string>;
}

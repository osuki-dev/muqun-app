// Two callers asking the same gateway the same question at the same time
// should cost one request, not two.
//
// Nothing in the app coordinates its reads. The home screen's status dot and
// its workspace prewarm both want `/health` on the same focus; the prewarm and
// a terminal mounting behind it both want `/api/sessions`; a re-render can
// restart a load that is still out. Each of those used to put a second
// identical GET on the wire, because neither `gatewayFetch` nor the generated
// `request` had any idea the first one existed.
//
// ## What this is not
//
// It is not a cache. An entry lives exactly as long as the request is in
// flight and is gone the moment it settles, success or failure. A second GET
// issued after the first has returned is a new question and gets a new request,
// which is the difference between "do not ask twice at once" and "remember the
// answer" -- the second is a much larger promise, with invalidation to match,
// and is not what is wanted here.
//
// A rejection is shared by everyone waiting on it, for the same reason: they
// asked the same question at the same moment, so they get the same answer.

import { headerRecord, isStreamingRequest } from '@/lib/request-budget';

/**
 * The identity of a request, for the purpose of "is this one already out".
 *
 * Null means do not deduplicate, and the cases are:
 *
 *  * **Anything but GET.** A POST is an instruction, not a question. Two
 *    identical ones are two instructions and both have to land -- collapsing a
 *    pair of sends, spawns or approvals into one would lose work silently.
 *  * **A request with a body.** GET with a body is not something this client
 *    does, and the body is not part of the key, so anything carrying one would
 *    be matched on its URL alone.
 *  * **A stream.** An SSE connection stays open for minutes by design
 *    (`isStreamingRequest`). Handing a second reader a clone of a response
 *    whose body is still arriving is not the same thing as its own
 *    subscription, and the budget already treats these as a separate category.
 *  * **An upload.** Marked by the caller, because a multipart body is not
 *    inspectable here and a large one must never be held for a joiner.
 *
 * The caller's own headers are part of the key. The token and the locale are
 * module state in `gateway-client` and identical for two concurrent calls by
 * construction, but a caller that asks for a different language, or a different
 * `Accept`, is asking a different question and must not be handed the other
 * one's answer. The budget is in the key for the same reason: a joiner would
 * otherwise silently inherit whatever deadline the first caller chose.
 */
export function dedupeKey(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  timeoutMs: number
): string | null {
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET') return null;
  if (init?.body != null) return null;
  if (isStreamingRequest(init)) return null;
  if ((init as { upload?: unknown } | undefined)?.upload === true) return null;

  const url = requestUrl(input);
  if (!url) return null;

  const headers = headerRecord(init?.headers);
  const stamped = Object.keys(headers)
    .sort()
    .map((name) => `${name.toLowerCase()}:${headers[name]}`)
    .join('\n');
  return `${method} ${url} ${timeoutMs}\n${stamped}`;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  const url = (input as { url?: unknown }).url;
  return typeof url === 'string' ? url : '';
}

/**
 * One request per key at a time, with every caller handed its own response.
 *
 * ## Why everybody gets a clone, including the caller who asked first
 *
 * A response body can be read once. If the first caller kept the original and
 * a joiner cloned it, the two would race: the first caller resumes first, and
 * whether it has started reading the body by the time the joiner clones is a
 * matter of microtask ordering. `clone()` on a used body throws, so that race
 * is a crash under load and nothing at all in a test.
 *
 * So the response this function awaits is never read by anyone. Every caller,
 * first or fifth, gets a copy of it. `NitroResponse` has the whole body in hand
 * by the time the object exists, so a clone is an object copy over the same
 * bytes rather than a second buffer.
 *
 * If cloning is not available -- another transport, a polyfilled `Response` --
 * the joiner does not get a broken object: it falls back to asking for itself,
 * which is exactly the behaviour that existed before this function.
 */
export function withRequestDedupe(
  flights: Map<string, Promise<Response>>,
  key: string | null,
  run: () => Promise<Response>
): Promise<Response> {
  if (!key) return run();

  const pending = flights.get(key);
  if (pending) return join(pending, run);

  const flight = run();
  flights.set(key, flight);
  // Entries are removed on settle, failure included. The handlers are here only
  // so an unawaited rejection is not reported as unhandled; the rejection
  // itself still reaches every caller that is waiting on the flight.
  void flight.then(
    () => flights.delete(key),
    () => flights.delete(key)
  );
  return originate(flight);
}

/**
 * The caller who actually made the request.
 *
 * It takes a clone so the awaited response stays unread and any joiner can
 * still copy it. Where cloning is unavailable it simply keeps the original --
 * one request, one response, exactly as before this existed -- and the joiners
 * are the ones who go and ask for themselves.
 */
async function originate(flight: Promise<Response>): Promise<Response> {
  const response = await flight;
  return copyOf(response) ?? response;
}

/**
 * A caller who arrived while the request was already out.
 *
 * It gets a copy, or -- if this transport cannot make one -- its own request.
 * What it must never get is the original, whose body the first caller is about
 * to read.
 */
async function join(flight: Promise<Response>, run: () => Promise<Response>): Promise<Response> {
  return copyOf(await flight) ?? run();
}

function copyOf(response: Response): Response | null {
  try {
    return typeof response.clone === 'function' ? response.clone() : null;
  } catch {
    return null;
  }
}

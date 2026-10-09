/**
 * The first prompt of a session Home's composer asked for, sent exactly once.
 *
 * The prompt travels to the workbench on the route (`/agent` or the Pad's
 * `/servers/[serverId]`), and a route's params outlive any one mount of the
 * screen under them: the workbench is remounted when its tunnel reconnects or
 * the Pad detail waits for a selection, and each of those mounts reads the same
 * params. A ref inside the workbench only guards one mount. This ledger guards
 * the request: the Home command offers the prompt as it navigates and puts the
 * offer's one-off id on the route; the workbench claims that id when it is
 * ready to send. A second mount finds the id already spent, and a deep link
 * carrying a `prompt` param but no live id sends nothing.
 *
 * Keyed by id rather than by text, so an offer abandoned before its workbench
 * was ready can never be claimed by a later request for the same goal; and
 * dropped after `OFFER_TTL_MS`, so it does not wait in memory for a route that
 * is never coming back.
 */

export const OFFER_TTL_MS = 2 * 60_000;
/** How long a claimed or expired offer is remembered after it was spent. */
export const SPENT_TTL_MS = 10 * 60_000;

type Offer = { serverId: string; prompt: string; offeredAtMs: number };
/**
 * How an offer stopped being live. A `claimed` goal was sent and keeps no
 * text: it must never come back. An `expired` one was never sent, so its text
 * is kept for a late workbench to put in its composer.
 */
type Spent =
  | { how: 'claimed'; serverId: string; atMs: number }
  | { how: 'expired'; serverId: string; prompt: string; atMs: number };

const offers = new Map<string, Offer>();
/**
 * Offers that were claimed or expired, kept for `SPENT_TTL_MS`. An expired
 * goal can be put back in a late workbench's composer, unsent; a claimed id
 * stays known so a late route for it is never taken for a fresh offer. This is
 * the only source a prefill reads: the route's `prompt` param is never trusted,
 * since any deep link can set it.
 */
const spent = new Map<string, Spent>();
let nextOffer = 0;

function prune(nowMs: number): void {
  for (const [id, offer] of offers) {
    const expiredAtMs = offer.offeredAtMs + OFFER_TTL_MS;
    if (nowMs > expiredAtMs) {
      offers.delete(id);
      spent.set(id, {
        how: 'expired',
        serverId: offer.serverId,
        prompt: offer.prompt,
        atMs: expiredAtMs,
      });
    }
  }
  for (const [id, record] of spent) {
    if (nowMs - record.atMs > SPENT_TTL_MS) spent.delete(id);
  }
}

/** The Home command is navigating to a new session that should start with `prompt`. */
export function offerInitialPrompt(serverId: string, prompt: string, nowMs = Date.now()): string {
  prune(nowMs);
  nextOffer += 1;
  const id = `${nowMs.toString(36)}-${nextOffer}`;
  offers.set(id, { serverId, prompt, offeredAtMs: nowMs });
  return id;
}

/** The navigation that offered `promptId` did not happen: forget it entirely. */
export function withdrawInitialPrompt(promptId: string): void {
  offers.delete(promptId);
  spent.delete(promptId);
}

/**
 * The prompt to send, once: the first claim of a live offer for this computer
 * spends it, and every later claim -- or one for another computer, or one past
 * the offer's lifetime -- gets null.
 */
export function claimInitialPrompt(
  promptId: string,
  serverId: string,
  nowMs = Date.now()
): string | null {
  prune(nowMs);
  const offer = offers.get(promptId);
  if (!offer || offer.serverId !== serverId) return null;
  offers.delete(promptId);
  spent.set(promptId, { how: 'claimed', serverId, atMs: nowMs });
  return offer.prompt;
}

/**
 * The text of an offer that expired unsent, for prefilling -- never sending.
 * Null for a claimed (already sent) offer, an id this app never offered,
 * another computer's offer, or one spent more than `SPENT_TTL_MS` ago.
 */
export function recallInitialPrompt(
  promptId: string,
  serverId: string,
  nowMs = Date.now()
): string | null {
  prune(nowMs);
  const record = spent.get(promptId);
  if (!record || record.how !== 'expired' || record.serverId !== serverId) return null;
  return record.prompt;
}

export type InitialPromptAction =
  | { kind: 'send'; prompt: string }
  | { kind: 'prefill'; prompt: string }
  | { kind: 'none' };

/**
 * What a ready workbench does with Home's goal. A live offer is sent. An offer
 * that expired while a slow tunnel came up must not lose the goal either: the
 * ledger's own copy (`recallInitialPrompt`) is put in the composer, unsent, for
 * the reader to send. A goal that was already sent never comes back. Never over a session
 * that already shows something, where the goal would read as a reply to it.
 * The route's `prompt` param plays no part: any deep link can set it.
 */
export function initialPromptAction(input: {
  claimed: string | null;
  recalled: string | null;
  sessionHasContent: boolean;
}): InitialPromptAction {
  if (input.claimed !== null) return { kind: 'send', prompt: input.claimed };
  const fallback = input.recalled?.trim();
  if (!fallback || input.sessionHasContent) return { kind: 'none' };
  return { kind: 'prefill', prompt: fallback };
}

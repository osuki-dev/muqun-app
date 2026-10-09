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

type Offer = { serverId: string; prompt: string; offeredAtMs: number };

const offers = new Map<string, Offer>();
let nextOffer = 0;

function prune(nowMs: number): void {
  for (const [id, offer] of offers) {
    if (nowMs - offer.offeredAtMs > OFFER_TTL_MS) offers.delete(id);
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

/** The navigation that offered `promptId` did not happen. */
export function withdrawInitialPrompt(promptId: string): void {
  offers.delete(promptId);
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
  return offer.prompt;
}

export type InitialPromptAction =
  | { kind: 'send'; prompt: string }
  | { kind: 'prefill'; prompt: string }
  | { kind: 'none' };

/**
 * What a ready workbench does with Home's goal. A live offer is sent. An offer
 * that is gone -- expired while a slow tunnel came up, or already claimed --
 * must not lose the goal either: the route's readable copy is put in the
 * composer, unsent, for the reader to send. Never over a session that already
 * shows something, where the goal would read as a reply to it.
 */
export function initialPromptAction(input: {
  claimed: string | null;
  routePrompt?: string;
  sessionHasContent: boolean;
}): InitialPromptAction {
  if (input.claimed !== null) return { kind: 'send', prompt: input.claimed };
  const fallback = input.routePrompt?.trim();
  if (!fallback || input.sessionHasContent) return { kind: 'none' };
  return { kind: 'prefill', prompt: fallback };
}

import { describe, expect, test } from 'bun:test';

import {
  claimInitialPrompt,
  initialPromptAction,
  OFFER_TTL_MS,
  recallInitialPrompt,
  SPENT_TTL_MS,
  offerInitialPrompt,
  withdrawInitialPrompt,
} from '../initial-prompt';

describe('initial prompt ledger', () => {
  test('an id never offered claims nothing (a bare deep link does not send)', () => {
    expect(claimInitialPrompt('no-such-offer', 's1')).toBeNull();
  });

  test('one offer is one claim, so a remounted workbench does not send twice', () => {
    const id = offerInitialPrompt('s1', 'goal');
    expect(claimInitialPrompt(id, 's1')).toBe('goal');
    expect(claimInitialPrompt(id, 's1')).toBeNull();
  });

  test('an abandoned offer is never claimed by a later request for the same goal', () => {
    const abandoned = offerInitialPrompt('s1', 'same goal');
    const later = offerInitialPrompt('s1', 'same goal');
    expect(later).not.toBe(abandoned);
    expect(claimInitialPrompt(later, 's1')).toBe('same goal');
    // A remount under the later route's params finds its own id spent.
    expect(claimInitialPrompt(later, 's1')).toBeNull();
  });

  test('an offer is claimed only for its own computer', () => {
    const id = offerInitialPrompt('s1', 'scoped');
    expect(claimInitialPrompt(id, 's2')).toBeNull();
    expect(claimInitialPrompt(id, 's1')).toBe('scoped');
  });

  test('a withdrawn offer cannot be claimed', () => {
    const id = offerInitialPrompt('s1', 'withdrawn');
    withdrawInitialPrompt(id);
    expect(claimInitialPrompt(id, 's1')).toBeNull();
  });

  test('an offer expires after its lifetime', () => {
    const at = 1_000_000;
    const fresh = offerInitialPrompt('s1', 'fresh', at);
    expect(claimInitialPrompt(fresh, 's1', at + OFFER_TTL_MS)).toBe('fresh');
    const stale = offerInitialPrompt('s1', 'stale', at);
    expect(claimInitialPrompt(stale, 's1', at + OFFER_TTL_MS + 1)).toBeNull();
  });
});

/**
 * What the workbench decides for a route's `promptId`. The route's `prompt`
 * param is deliberately not an input: a deep link can carry any text there.
 */
function decide(promptId: string, serverId: string, nowMs: number, sessionHasContent = false) {
  return initialPromptAction({
    claimed: claimInitialPrompt(promptId, serverId, nowMs),
    recalled: recallInitialPrompt(promptId, serverId, nowMs),
    sessionHasContent,
  });
}

describe('initialPromptAction', () => {
  const at = 5_000_000;

  test('a live offer is sent', () => {
    const id = offerInitialPrompt('s1', 'Ship it', at);
    expect(decide(id, 's1', at + 1)).toEqual({ kind: 'send', prompt: 'Ship it' });
  });

  test('an unknown id does nothing, whatever text a deep link put on the route', () => {
    // e.g. muqun://agent?intent=new&promptId=x&prompt=<anything>
    expect(decide('attacker-chosen-id', 's1', at)).toEqual({ kind: 'none' });
  });

  test('an expired offer prefills the ledger text, never sends it', () => {
    const id = offerInitialPrompt('s1', 'Slow tunnel goal', at);
    expect(decide(id, 's1', at + OFFER_TTL_MS + 1)).toEqual({
      kind: 'prefill',
      prompt: 'Slow tunnel goal',
    });
  });

  test('a claimed offer prefills its ledger text on a remount', () => {
    const id = offerInitialPrompt('s1', 'Already sent', at);
    expect(decide(id, 's1', at + 1).kind).toBe('send');
    expect(decide(id, 's1', at + 2)).toEqual({ kind: 'prefill', prompt: 'Already sent' });
  });

  test("another computer's offer is neither sent nor prefilled", () => {
    const id = offerInitialPrompt('s1', 'Scoped', at);
    expect(decide(id, 's2', at + 1)).toEqual({ kind: 'none' });
    expect(decide(id, 's2', at + OFFER_TTL_MS + 1)).toEqual({ kind: 'none' });
  });

  test('a spent record older than its lifetime is forgotten', () => {
    const id = offerInitialPrompt('s1', 'Old', at);
    expect(decide(id, 's1', at + 1).kind).toBe('send');
    expect(decide(id, 's1', at + 1 + SPENT_TTL_MS + 1)).toEqual({ kind: 'none' });
    const expired = offerInitialPrompt('s1', 'Old expired', at);
    expect(recallInitialPrompt(expired, 's1', at + OFFER_TTL_MS + SPENT_TTL_MS + 1)).toBeNull();
  });

  test('a withdrawn offer is not recalled either', () => {
    const id = offerInitialPrompt('s1', 'Withdrawn', at);
    withdrawInitialPrompt(id);
    expect(decide(id, 's1', at + OFFER_TTL_MS + 1)).toEqual({ kind: 'none' });
  });

  test('nothing over a session that already has content', () => {
    const id = offerInitialPrompt('s1', 'Busy', at);
    expect(decide(id, 's1', at + OFFER_TTL_MS + 1, true)).toEqual({ kind: 'none' });
    expect(
      initialPromptAction({ claimed: null, recalled: '   ', sessionHasContent: false })
    ).toEqual({ kind: 'none' });
  });
});

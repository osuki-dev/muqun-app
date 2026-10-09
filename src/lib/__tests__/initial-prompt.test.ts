import { describe, expect, test } from 'bun:test';

import {
  claimInitialPrompt,
  initialPromptAction,
  OFFER_TTL_MS,
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

describe('initialPromptAction', () => {
  test('a live offer is sent, whatever the route says', () => {
    expect(
      initialPromptAction({ claimed: 'Ship it', routePrompt: 'other', sessionHasContent: false })
    ).toEqual({ kind: 'send', prompt: 'Ship it' });
  });

  test('a gone offer prefills the route copy instead of losing the goal', () => {
    expect(
      initialPromptAction({ claimed: null, routePrompt: ' Ship it ', sessionHasContent: false })
    ).toEqual({ kind: 'prefill', prompt: 'Ship it' });
  });

  test('nothing over a session that already has content, or without a route copy', () => {
    expect(
      initialPromptAction({ claimed: null, routePrompt: 'Ship it', sessionHasContent: true })
    ).toEqual({ kind: 'none' });
    expect(initialPromptAction({ claimed: null, sessionHasContent: false })).toEqual({
      kind: 'none',
    });
    expect(
      initialPromptAction({ claimed: null, routePrompt: '   ', sessionHasContent: false })
    ).toEqual({ kind: 'none' });
  });
});

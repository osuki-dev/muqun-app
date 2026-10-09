import { describe, expect, test } from 'bun:test';

import { claimInitialPrompt, offerInitialPrompt, withdrawInitialPrompt } from '../initial-prompt';

describe('initial prompt ledger', () => {
  test('a prompt never offered is never claimed (a bare deep link does not send)', () => {
    expect(claimInitialPrompt('s1', 'not offered')).toBe(false);
  });

  test('one offer is one claim, so a remounted workbench does not send twice', () => {
    offerInitialPrompt('s1', 'goal');
    expect(claimInitialPrompt('s1', 'goal')).toBe(true);
    expect(claimInitialPrompt('s1', 'goal')).toBe(false);
  });

  test('the same goal sent twice is two sends', () => {
    offerInitialPrompt('s1', 'twice');
    offerInitialPrompt('s1', 'twice');
    expect(claimInitialPrompt('s1', 'twice')).toBe(true);
    expect(claimInitialPrompt('s1', 'twice')).toBe(true);
    expect(claimInitialPrompt('s1', 'twice')).toBe(false);
  });

  test('offers are scoped to their computer', () => {
    offerInitialPrompt('s1', 'scoped');
    expect(claimInitialPrompt('s2', 'scoped')).toBe(false);
    expect(claimInitialPrompt('s1', 'scoped')).toBe(true);
  });

  test('a withdrawn offer cannot be claimed', () => {
    offerInitialPrompt('s1', 'withdrawn');
    withdrawInitialPrompt('s1', 'withdrawn');
    expect(claimInitialPrompt('s1', 'withdrawn')).toBe(false);
  });
});

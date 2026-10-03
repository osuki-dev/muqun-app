import { describe, expect, test } from 'bun:test';
import { padAgentRedirectParams } from '@/lib/pad-detail';

describe('padAgentRedirectParams', () => {
  test('carries every agent param and drops empties', () => {
    expect(
      padAgentRedirectParams({ server: 's1', asid: 'a1', sessionId: '', intent: undefined })
    ).toEqual({ serverId: 's1', asid: 'a1' });
  });
  test('new intent survives', () => {
    expect(padAgentRedirectParams({ server: 's1', intent: 'new', directory: '/w' })).toEqual({
      serverId: 's1',
      intent: 'new',
      directory: '/w',
    });
  });
});

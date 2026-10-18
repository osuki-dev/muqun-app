import { describe, expect, test } from 'bun:test';

import { homeDockTargetId } from '@/lib/home-composer';
import { deckOrder } from '@/lib/home-computer-deck';

describe('Home target restoration', () => {
  const serverIds = ['a', 'b'];

  test('a restart restores the front computer as the send target without switching the connection', () => {
    const rememberedId = 'b';
    const front = deckOrder(null, serverIds, rememberedId)[0];
    expect(homeDockTargetId({ serverIds, rememberedId, selectedId: 'a' })).toBe(front);
  });

  test('an explicit target pick wins over the remembered card and a later connection change', () => {
    expect(homeDockTargetId({ serverIds, pickedId: 'a', rememberedId: 'b', selectedId: 'b' })).toBe(
      'a'
    );
  });

  test('removed targets cannot be restored or used for sending', () => {
    expect(
      homeDockTargetId({ serverIds, pickedId: 'removed', rememberedId: 'b', selectedId: 'a' })
    ).toBe('b');
    expect(homeDockTargetId({ serverIds, rememberedId: 'removed', selectedId: 'a' })).toBe('a');
    expect(homeDockTargetId({ serverIds, rememberedId: 'removed' })).toBeUndefined();
    expect(homeDockTargetId({ serverIds: ['a'], rememberedId: 'removed' })).toBe('a');
    expect(homeDockTargetId({ serverIds: [], rememberedId: 'b' })).toBeUndefined();
  });
});

import { describe, expect, test } from 'bun:test';

import type { GatewayEntity } from '@/lib/gateway-entities';

import { panelTitle } from '../herdr-entity';

function entity(overrides: Partial<GatewayEntity>): GatewayEntity {
  return { id: 'pane-1', title: '', subtitle: '', raw: {}, ...overrides };
}

describe('panelTitle', () => {
  test('a name the reader set on the pane wins over everything', () => {
    expect(panelTitle(entity({ label: 'Deploy', title: 'zsh' }), entity({ title: 'claude' }))).toBe(
      'Deploy'
    );
  });

  test('joins two different names with a separator', () => {
    expect(panelTitle(entity({ title: 'zsh' }), entity({ title: 'claude' }))).toBe('claude · zsh');
  });

  test('says one name once when both agree', () => {
    // The agent's spelling, since the agent is what named it.
    expect(panelTitle(entity({ title: 'claude' }), entity({ title: 'Claude' }))).toBe('Claude');
  });

  // The regression: a separator is punctuation between two names, and with one
  // name it is a stray glyph at the front of the home card's loudest element.
  test('never opens or closes a name with a bare separator', () => {
    expect(panelTitle(entity({ title: 'zsh' }), entity({ title: '' }))).toBe('zsh');
    expect(panelTitle(entity({ title: 'zsh' }), entity({ title: '   ' }))).toBe('zsh');
    expect(panelTitle(entity({ title: '' }), entity({ title: 'claude' }))).toBe('claude');
    expect(panelTitle(entity({ title: '  ' }), entity({ title: 'claude' }))).toBe('claude');
  });

  test('falls back to the pane, then to its id, then to a word', () => {
    expect(panelTitle(entity({ title: 'zsh' }))).toBe('zsh');
    expect(panelTitle(entity({ id: 'pane-9', title: '' }))).toBe('pane-9');
    // Whitespace is not a name, so it does not beat the id either.
    expect(panelTitle(entity({ id: 'pane-9', title: '   ' }))).toBe('pane-9');
    expect(panelTitle()).toBe('Panel');
  });
});

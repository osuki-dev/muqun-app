import { describe, expect, test } from 'bun:test';

import { groupModelsByProvider } from '../agent-model-groups';

const upper = (id: string) => id.toUpperCase();
const m = (id: string, provider_id: string) => ({ id, provider_id });

describe('groupModelsByProvider', () => {
  test('titles each group with the name the catalog gives its provider', () => {
    const groups = groupModelsByProvider(
      [m('sonnet', 'claudeAgent'), m('gpt-5', 'codex'), m('big-pickle', 'opencode')],
      [
        { id: 'claudeAgent', name: 'Claude Code', available: true },
        { id: 'codex', name: 'Codex', available: true },
        { id: 'opencode', name: 'OpenCode', available: true },
      ],
      upper
    );
    expect(groups.map((group) => [group.title, group.models.map((model) => model.id)])).toEqual([
      ['Claude Code', ['sonnet']],
      ['Codex', ['gpt-5']],
      ['OpenCode', ['big-pickle']],
    ]);
  });

  test('an unavailable provider is marked, and listed empty only when asked', () => {
    const providers = [
      { id: 'claudeAgent', name: 'Claude Code', available: false },
      { id: 'codex', name: 'Codex' },
    ];
    const models = [m('gpt-5', 'codex')];
    expect(groupModelsByProvider(models, providers, upper).map((g) => g.title)).toEqual(['Codex']);
    const all = groupModelsByProvider(models, providers, upper, { includeEmptyUnavailable: true });
    expect(all.map((group) => [group.title, group.available, group.models.length])).toEqual([
      ['Claude Code', false, 0],
      ['Codex', true, 1],
    ]);
  });

  test('models of an unlisted provider follow, named by the fallback', () => {
    const groups = groupModelsByProvider(
      [m('x', 'zeta'), m('y', 'anthropic'), m('z', 'listed')],
      [{ id: 'listed', name: 'listed' }],
      upper
    );
    expect(groups.map((group) => group.title)).toEqual(['LISTED', 'ANTHROPIC', 'ZETA']);
    expect(groups.every((group) => group.available)).toBe(true);
  });
});

import { describe, expect, test } from 'bun:test';

import { groupModelsByProvider, hasFreeModel } from '../agent-model-groups';

const m = (id: string, provider_id: string) => ({ id, provider_id });

describe('groupModelsByProvider', () => {
  test('an unavailable provider is marked, and listed empty only when asked', () => {
    const providers = [
      { id: 'claudeAgent', name: 'Claude Code', available: false },
      { id: 'codex', name: 'Codex' },
    ];
    const models = [m('gpt-5', 'codex')];
    expect(groupModelsByProvider(models, providers).map((g) => g.title)).toEqual(['Codex']);
    const all = groupModelsByProvider(models, providers, {
      includeEmptyUnavailable: true,
    });
    expect(all.map((group) => [group.title, group.available, group.models.length])).toEqual([
      ['Claude Code', false, 0],
      ['Codex', true, 1],
    ]);
  });

  test('heading = the catalog name; a provider the catalog does not list = its raw id', () => {
    const groups = groupModelsByProvider(
      [m('x', 'zeta'), m('y', 'opencode-go'), m('z', 'listed')],
      [{ id: 'listed', name: 'Listed Co' }]
    );
    expect(groups.map((group) => group.title)).toEqual(['Listed Co', 'zeta', 'opencode-go']);
    expect(groups.every((group) => group.available)).toBe(true);
  });
});

describe('hasFreeModel', () => {
  const zero = [{ input: 0, output: 0 }];
  const paid = [{ input: 1, output: 2 }];
  test('is false for an empty or all-paid catalog', () => {
    expect(hasFreeModel([])).toBe(false);
    expect(
      hasFreeModel([
        { ...m('a', 'p'), cost: paid },
        { ...m('b', 'p'), cost: paid },
      ])
    ).toBe(false);
  });
  test('is true when any model costs nothing or is named free', () => {
    expect(
      hasFreeModel([
        { ...m('a', 'p'), cost: paid },
        { ...m('b', 'p'), cost: zero },
      ])
    ).toBe(true);
    expect(hasFreeModel([m('big-free', 'p')])).toBe(true);
  });
});

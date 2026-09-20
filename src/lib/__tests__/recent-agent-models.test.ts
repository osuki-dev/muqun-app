import { expect, test } from 'bun:test';
import { recentCatalogModels } from '../recent-agent-models';
import type { ModelInfo } from '../agent-protocol';

const model = (id: string, provider_id = 'p'): ModelInfo => ({
  id,
  provider_id,
  name: id,
  enabled: true,
});
test('history uses live metadata and omits removed, disabled and filtered models', () => {
  const current = { ...model('a'), name: 'Renamed', limit: { context: 200000 } };
  const refs = ['removed', 'off', 'a', 'a', 'filtered'].map((model_id) => ({
    provider_id: 'p',
    model_id,
  }));
  expect(recentCatalogModels(refs, [current, { ...model('off'), enabled: false }], [])).toEqual([
    current,
  ]);
  expect(
    recentCatalogModels(
      refs,
      [current],
      [{ id: 'p', name: 'P', activation: 'disabled', models: [] }]
    )
  ).toEqual([]);
  expect(recentCatalogModels(refs, [], [])).toEqual([]);
});
test('provider identity, recency order and five-row cap are preserved', () => {
  const models = Array.from({ length: 8 }, (_, i) => model(String(i)));
  const refs = [...models].reverse().map((m) => ({ provider_id: m.provider_id, model_id: m.id }));
  expect(
    recentCatalogModels([{ provider_id: 'other', model_id: '7' }, ...refs], models, []).map(
      (m) => m.id
    )
  ).toEqual(['7', '6', '5', '4', '3']);
});

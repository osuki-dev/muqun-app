import { describe, expect, test } from 'bun:test';

import { findAgentModelPosition } from '../agent-model-position';

describe('findAgentModelPosition', () => {
  test('prefers the Recently used occurrence and counts rows before it', () => {
    expect(
      findAgentModelPosition(
        [
          { models: [{ id: 'target', provider_id: 'openai' }] },
          {
            models: [
              { id: 'other', provider_id: 'anthropic' },
              { id: 'target', provider_id: 'openai' },
            ],
          },
        ],
        { provider_id: 'openai', model_id: 'target' }
      )
    ).toEqual({ sectionIndex: 0, modelIndex: 0, rowIndex: 0 });
  });

  test('finds a selected model beyond the first page', () => {
    const models = Array.from({ length: 42 }, (_, index) => ({
      id: `model-${index}`,
      provider_id: 'openai',
    }));
    expect(
      findAgentModelPosition([{ models }], { provider_id: 'openai', model_id: 'model-41' })
    ).toEqual({ sectionIndex: 0, modelIndex: 41, rowIndex: 41 });
  });

  test('matches provider and model together when ids collide', () => {
    expect(
      findAgentModelPosition(
        [
          { models: [{ id: 'shared', provider_id: 'openai' }] },
          { models: [{ id: 'shared', provider_id: 'anthropic' }] },
        ],
        { provider_id: 'anthropic', model_id: 'shared' }
      )
    ).toEqual({ sectionIndex: 1, modelIndex: 0, rowIndex: 1 });
  });

  test('returns no position when the effective model is absent', () => {
    expect(
      findAgentModelPosition([{ models: [{ id: 'available', provider_id: 'openai' }] }], {
        provider_id: 'openai',
        model_id: 'missing',
      })
    ).toBeNull();
  });
});

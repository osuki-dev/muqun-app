import type { ModelRef } from '@/lib/agent-session';

export interface AgentModelPositionSection<Model extends { id: string; provider_id: string }> {
  models: readonly Model[];
}

export interface AgentModelPosition {
  /** The row's section and index within that section, for its layout key. */
  sectionIndex: number;
  modelIndex: number;
  /** The model-only offset used to grow the existing paged list. */
  rowIndex: number;
}

/**
 * Locate a selected model in the sheet's already ordered sections.
 *
 * Recent models are deliberately first, so a duplicate selected model resolves
 * to that occurrence and the sheet reveals the one a reader recognises.
 */
export function findAgentModelPosition<Model extends { id: string; provider_id: string }>(
  sections: readonly AgentModelPositionSection<Model>[],
  selected: ModelRef | null | undefined
): AgentModelPosition | null {
  if (!selected?.model_id) return null;
  let rowIndex = 0;
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];
    for (let modelIndex = 0; modelIndex < section.models.length; modelIndex += 1) {
      const model = section.models[modelIndex];
      if (
        model.id === selected.model_id &&
        (!selected.provider_id || model.provider_id === selected.provider_id)
      ) {
        return { sectionIndex, modelIndex, rowIndex };
      }
      rowIndex += 1;
    }
  }
  return null;
}

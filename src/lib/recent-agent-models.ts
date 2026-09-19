import type { ModelInfo, ModelRef, ProviderInfo } from './agent-protocol';

/** Resolve history against the currently filtered catalog, never cached metadata. */
export function recentCatalogModels(
  refs: readonly ModelRef[],
  models: readonly ModelInfo[],
  providers: readonly ProviderInfo[]
): ModelInfo[] {
  const disabled = new Set(providers.filter((p) => p.activation === 'disabled').map((p) => p.id));
  const result: ModelInfo[] = [];
  for (const ref of refs) {
    const model = models.find((m) => m.id === ref.model_id && m.provider_id === ref.provider_id);
    if (
      !model ||
      model.enabled === false ||
      disabled.has(model.provider_id) ||
      result.includes(model)
    )
      continue;
    result.push(model);
    if (result.length === 5) break;
  }
  return result;
}

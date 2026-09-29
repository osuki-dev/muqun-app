/**
 * The model sheet's provider groups, from the catalog's own `providers`.
 *
 * Grouped by `provider_id` as before, but titled with the name the gateway
 * gives the provider -- T3 exposes Claude Code, Codex and OpenCode as its
 * providers, and their ids are driver names -- and marked unavailable when
 * the gateway says a session cannot start on it (`available: false`, e.g.
 * not signed in on the host). An unavailable provider with no models is still
 * a group, so the sheet can say what the host needs; the caller decides when
 * such an empty group is worth drawing (not while searching).
 *
 * Pure, so the grouping and its order are tested without the sheet.
 */

export interface ProviderGroupModel {
  id: string;
  provider_id: string;
}

export interface ProviderGroupSource {
  id: string;
  name?: string;
  available?: boolean;
}

export interface ModelProviderGroup<Model extends ProviderGroupModel> {
  providerId: string;
  title: string;
  /** `false` only when the gateway said so; an older gateway never does. */
  available: boolean;
  models: Model[];
}

/** The order for providers the catalog did not list itself. */
const PREFERRED_ORDER = ['opencode', 'deepseek', 'openai', 'anthropic', 'google'];

export function groupModelsByProvider<Model extends ProviderGroupModel>(
  models: readonly Model[],
  providers: readonly ProviderGroupSource[],
  fallbackName: (providerId: string) => string,
  options: { includeEmptyUnavailable?: boolean } = {}
): ModelProviderGroup<Model>[] {
  const byProvider = new Map<string, Model[]>();
  for (const model of models) {
    const provider = model.provider_id || 'other';
    const list = byProvider.get(provider) ?? [];
    list.push(model);
    byProvider.set(provider, list);
  }
  const listed = providers.map((provider) => provider.id);
  const unlisted = Array.from(byProvider.keys())
    .filter((id) => !listed.includes(id))
    .sort((a, b) => {
      const ia = PREFERRED_ORDER.indexOf(a);
      const ib = PREFERRED_ORDER.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  const groups: ModelProviderGroup<Model>[] = [];
  for (const id of [...listed, ...unlisted]) {
    if (groups.some((group) => group.providerId === id)) continue;
    const provider = providers.find((entry) => entry.id === id);
    const available = provider?.available !== false;
    const groupModels = byProvider.get(id) ?? [];
    if (groupModels.length === 0 && (available || !options.includeEmptyUnavailable)) continue;
    const name = provider?.name?.trim();
    groups.push({
      providerId: id,
      title: name && name !== id ? name : fallbackName(id),
      available,
      models: groupModels,
    });
  }
  return groups;
}

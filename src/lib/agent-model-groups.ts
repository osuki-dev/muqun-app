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

import { isFreeModel } from '@/lib/agent-protocol';

/**
 * Whether the "Free only" segment has anything to show. A catalog with no free
 * model gets no segmented control at all: a filter that can only empty the
 * list is noise. Decided by the same `isFreeModel` the filter applies.
 */
export function hasFreeModel(models: readonly Parameters<typeof isFreeModel>[0][]): boolean {
  return models.some((model) => isFreeModel(model));
}

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

/**
 * A provider's heading: the name the catalog gives it, else its raw id.
 * Nothing is invented -- no spelling table, no title-casing (the owner's
 * rule): the gateway's catalog is the only source of a provider's name.
 */
export function providerTitle(
  providers: readonly ProviderGroupSource[],
  providerId: string
): string {
  const name = providers.find((entry) => entry.id === providerId)?.name?.trim();
  return name || providerId;
}

/**
 * The groups in the catalog's own provider order; a provider the catalog did
 * not list follows, in the order its models came, under its raw id.
 */
export function groupModelsByProvider<Model extends ProviderGroupModel>(
  models: readonly Model[],
  providers: readonly ProviderGroupSource[],
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
  const unlisted = Array.from(byProvider.keys()).filter((id) => !listed.includes(id));
  const groups: ModelProviderGroup<Model>[] = [];
  for (const id of [...listed, ...unlisted]) {
    if (groups.some((group) => group.providerId === id)) continue;
    const provider = providers.find((entry) => entry.id === id);
    const available = provider?.available !== false;
    const groupModels = byProvider.get(id) ?? [];
    if (groupModels.length === 0 && (available || !options.includeEmptyUnavailable)) continue;
    groups.push({
      providerId: id,
      title: providerTitle(providers, id),
      available,
      models: groupModels,
    });
  }
  return groups;
}

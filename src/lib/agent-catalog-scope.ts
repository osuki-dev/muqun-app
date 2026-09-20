/**
 * What a catalog read is scoped to, as three pure decisions.
 *
 * OpenCode scopes agents, commands and skills *per project*: an agent defined
 * in the workspace's own `.opencode/agent` exists only for that project, and
 * `GET /api/agent-catalog` answers with the global set until it is told which
 * directory to look in. The app asked without one everywhere, so a user's own
 * agent was never in the catalog it fetched, never in the mode picker, and the
 * project's `defaults` never applied. Naming the directory is the whole fix.
 *
 * A directory is therefore part of the *identity* of a catalog read, not a
 * detail of it: two workspaces on one host have two different catalogs and
 * must never share a cache entry, an ETag, or an in-flight request. That is
 * what `agentCatalogCacheVariant` is for -- it goes into `buildAgentCacheKey`,
 * which is also the dedupe key.
 *
 * Kept here, away from `agent-session.ts`, so all three can be read and tested
 * without a gateway client or a native store behind them.
 */

/** The route a catalog read goes to, with the workspace named when there is one. */
export function agentCatalogPath(sessionId?: string, directory?: string): string {
  const base = sessionId
    ? `/api/sessions/${encodeURIComponent(sessionId)}/agent-catalog`
    : '/api/agent-catalog';
  const dir = normalizeCatalogDirectory(directory);
  return dir ? `${base}?directory=${encodeURIComponent(dir)}` : base;
}

/**
 * The cache-key variant for a workspace, or `null` for a read that named none.
 *
 * `null` keeps the unscoped key exactly as it was, so a caller with no
 * directory -- the composer before a session's snapshot has landed, say --
 * still reads and writes the entry it always did.
 */
export function agentCatalogCacheVariant(directory?: string): string | null {
  const dir = normalizeCatalogDirectory(directory);
  return dir ? `dir=${dir}` : null;
}

/** An empty or whitespace-only directory is no directory at all. */
export function normalizeCatalogDirectory(directory?: string): string | undefined {
  const trimmed = directory?.trim();
  return trimmed ? trimmed : undefined;
}

/** Which gateway session and which workspace a catalog on screen came from. */
export interface AgentCatalogScope {
  sessionId?: string;
  directory?: string;
}

/**
 * Whether a screen holding `previous` should read the catalog again for `next`.
 *
 * Three rules, and the third is the one worth stating:
 *
 *  * Nothing read yet (`previous` is `null`) always reads. The first read
 *    happens before any snapshot has said which directory the session is in,
 *    and a screen that waited for one would have no catalog at all on a host
 *    that never answers.
 *  * Another gateway session is another host's catalog, so it always reads.
 *  * **Losing** the directory is not a reason to read. `activeDirectory` is
 *    `undefined` until a snapshot or an `agent.session.updated` states it, and
 *    it can go back to `undefined` while one is in flight. Re-reading then
 *    would throw the project's agents away and put the global list back on
 *    screen -- the bug this whole change exists to fix -- and then fetch them
 *    again a moment later. A directory is replaced by another directory, or
 *    it is kept.
 */
export function shouldRefetchAgentCatalog(
  previous: AgentCatalogScope | null,
  next: AgentCatalogScope
): boolean {
  if (!previous) return true;
  if (previous.sessionId !== next.sessionId) return true;
  const nextDir = normalizeCatalogDirectory(next.directory);
  if (!nextDir) return false;
  return normalizeCatalogDirectory(previous.directory) !== nextDir;
}

/**
 * Whether an answered catalog is one worth remembering.
 *
 * A catalog read for a workspace OpenCode has not loaded yet does not fail and
 * does not wait for the project either: the gateway waits up to its floor and
 * then answers `200` with `models: []` and `providers: []` -- and with an
 * `ETag`, so to a cache it is indistinguishable from a real answer. Measured
 * against the live gateway, a first read of a cold directory took 1.7s and came
 * back with nothing in it; the next read of the same directory had all 126
 * models and a different ETag.
 *
 * Storing the first of those pins an empty "Choose a model" in front of the
 * reader for the whole of `CATALOG_TTL_MS`, with no request going out to
 * correct it -- the freshness check short-circuits before the network. So an
 * empty catalog is answered and never written down: the next read asks again.
 *
 * Emptiness is judged on models and providers only. A host with no provider
 * configured has no models to pick either way, and the agents, commands and
 * skills a directory-less read carries are not what this is guarding.
 */
export function isEmptyAgentCatalog(catalog: {
  models: readonly unknown[];
  providers: readonly unknown[];
}): boolean {
  return catalog.models.length === 0 && catalog.providers.length === 0;
}

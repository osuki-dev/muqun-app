/** The session listing's query, kept apart from the fetch so it is testable without React Native. */

export interface ListAgentSessionsQuery {
  directory?: string;
  parent_id?: string;
  /** `true` lists top-level sessions only — no subagent sessions. */
  roots?: boolean;
  limit?: number;
  order?: 'asc' | 'desc';
  search?: string;
  cursor?: string;
  /**
   * One agent's sessions only, the default agent included. Absent, a
   * multi-agent gateway merges every agent's list and tags each row, and the
   * row limit is spent on other agents' sessions. Name one only on a gateway
   * that advertises `multi_agent`: an older one has one agent and no parameter.
   */
  agentId?: string;
}

/** The query string for a session listing, `?` included, or `''` for none. */
export function agentSessionListQuery(query: ListAgentSessionsQuery | undefined): string {
  if (!query) return '';
  const params = new URLSearchParams();
  if (query.directory) params.set('directory', query.directory);
  if (query.parent_id) params.set('parent_id', query.parent_id);
  if (query.roots) params.set('roots', 'true');
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.order) params.set('order', query.order);
  if (query.search) params.set('search', query.search);
  if (query.cursor) params.set('cursor', query.cursor);
  const agentId = query.agentId?.trim();
  if (agentId) params.set('agent_id', agentId);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

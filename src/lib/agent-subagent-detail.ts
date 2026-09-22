/** Every identity boundary a read-only descendant snapshot is valid within. */
export interface AgentSubagentDetailScope {
  serverId?: string;
  sessionId?: string;
  ownerSessionId?: string;
  asid?: string;
}

/** A stable key that prevents equal ASIDs on different Gateways from sharing output. */
export function agentSubagentDetailScopeKey(scope: AgentSubagentDetailScope): string {
  return JSON.stringify([
    scope.serverId ?? null,
    scope.sessionId ?? null,
    scope.ownerSessionId ?? null,
    scope.asid ?? null,
  ]);
}

/** Keep a snapshot during explicit refresh, but never while another scope loads. */
export function retainAgentSubagentDetail<T extends { scopeKey: string }>(
  loaded: T | null,
  scopeKey: string
): T | null {
  return loaded?.scopeKey === scopeKey ? loaded : null;
}

/** The transcript is drawable only when it belongs to the current scope. */
export function agentSubagentDetailContentState(
  hasSnapshot: boolean,
  loading: boolean,
  hasError: boolean
): 'transcript' | 'loading' | 'error' {
  if (hasSnapshot) return 'transcript';
  if (loading || !hasError) return 'loading';
  return 'error';
}

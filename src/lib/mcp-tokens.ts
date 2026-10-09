import { asFiniteNumber, asRecord, asString } from './agent-protocol';

/** Announced only while the gateway's MCP server is running. */
export const MCP_SERVER_CAPABILITY = 'mcp_server';

export type McpTokenBinding =
  | { kind: 'pane'; sessionId: string; paneId: string }
  | { kind: 'agent'; agentId: string };

export interface McpToken {
  id: string;
  binding: McpTokenBinding;
  label: string;
  issuedMs: number;
  expiresMs: number | null;
  lastUsedMs?: number;
}

function parseBinding(value: unknown): McpTokenBinding | null {
  const rec = asRecord(value);
  if (!rec) return null;
  if (rec.kind === 'pane') {
    const sessionId = asString(rec.session_id);
    const paneId = asString(rec.pane_id);
    return sessionId && paneId ? { kind: 'pane', sessionId, paneId } : null;
  }
  if (rec.kind === 'agent') {
    const agentId = asString(rec.agent_id);
    return agentId ? { kind: 'agent', agentId } : null;
  }
  return null;
}

/** A token as listed (snake_case). A revoked token is not a live one: null. */
export function parseMcpToken(value: unknown): McpToken | null {
  const rec = asRecord(value);
  const id = asString(rec?.id);
  const binding = parseBinding(rec?.binding);
  if (!rec || !id || !binding) return null;
  if (asFiniteNumber(rec.revoked_ms) !== undefined) return null;
  const lastUsedMs = asFiniteNumber(rec.last_used_ms);
  return {
    id,
    binding,
    label: asString(rec.label) ?? '',
    issuedMs: asFiniteNumber(rec.issued_ms) ?? 0,
    expiresMs: asFiniteNumber(rec.expires_ms) ?? null,
    ...(lastUsedMs !== undefined ? { lastUsedMs } : {}),
  };
}

export function hasMcpServer(capabilities: readonly string[] | undefined): boolean {
  return capabilities?.includes(MCP_SERVER_CAPABILITY) === true;
}

function parseTokenList(value: unknown): McpToken[] {
  const list = asRecord(value)?.tokens;
  if (!Array.isArray(list)) return [];
  const out: McpToken[] = [];
  for (const entry of list) {
    const token = parseMcpToken(entry);
    if (token) out.push(token);
  }
  return out;
}

/**
 * The live tokens, or null when the read failed. `readJson` folds every
 * failure into its fallback, so a null fallback is how a failed read stays
 * apart from a gateway that has issued none.
 */
export async function fetchMcpTokens(): Promise<McpToken[] | null> {
  const { readJson } = await import('./agent-session');
  const { demoMcpTokens, isDemoActive } = await import('./demo-gateway');
  if (isDemoActive()) return parseTokenList({ tokens: demoMcpTokens() });
  return readJson<McpToken[] | null>('/api/mcp/tokens', parseTokenList, null);
}

/** Like `fetchMcpTokens`, with a failed read shown as an empty list. */
export async function listMcpTokens(): Promise<McpToken[]> {
  return (await fetchMcpTokens()) ?? [];
}

/** True when the gateway revoked it; false when it no longer knows the token. */
export async function revokeMcpToken(id: string): Promise<boolean> {
  const { writeJson } = await import('./agent-session');
  const { demoRevokeMcpToken, isDemoActive } = await import('./demo-gateway');
  if (isDemoActive()) return demoRevokeMcpToken(id);
  try {
    await writeJson(
      `/api/mcp/tokens/${encodeURIComponent(id)}`,
      'Revoke MCP token',
      undefined,
      'DELETE'
    );
    return true;
  } catch (error) {
    if (error instanceof Error && /: 404\b/.test(error.message)) return false;
    throw error;
  }
}

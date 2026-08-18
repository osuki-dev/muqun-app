export interface GatewayEntity {
  id: string;
  title: string;
  subtitle: string;
  label?: string;
  cwd?: string;
  status?: string;
  raw: Record<string, unknown>;
}

export type GatewayEntityKind = 'workspace' | 'tab' | 'pane' | 'agent';

export function normalizeGatewayEntities(value: unknown, keys: string[]): GatewayEntity[] {
  return entityArray(value, keys).map(normalizeGatewayEntity).filter((item) => item.id.length > 0);
}

export function normalizeGatewayEntity(value: unknown): GatewayEntity {
  const raw = unwrapGatewayEntity(value, 0);
  const id = stringValue(raw.id ?? raw.pane_id ?? raw.tab_id ?? raw.workspace_id ?? raw.target);
  const title = stringValue(
    raw.label ?? raw.title ?? raw.name ?? raw.terminal_title_stripped ?? raw.agent
  ) || id || 'Untitled';
  const cwd = stringValue(raw.cwd ?? raw.foreground_cwd) || undefined;
  const status = stringValue(raw.status ?? raw.agent_status) || undefined;
  const subtitle = [id, cwd, status].filter(Boolean).join(' · ');
  return {
    id,
    title,
    subtitle,
    label: stringValue(raw.label) || undefined,
    cwd,
    status,
    raw,
  };
}

function unwrapGatewayEntity(value: unknown, depth: number): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 4) return {};

  const record = value as Record<string, unknown>;
  for (const key of ['pane', 'tab', 'workspace', 'agent']) {
    const nested = record[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return unwrapGatewayEntity(nested, depth + 1);
    }
  }
  for (const key of ['result', 'data']) {
    const nested = record[key];
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      return unwrapGatewayEntity(nested, depth + 1);
    }
  }
  return record;
}

function entityArray(value: unknown, keys: string[]): unknown[] {
  return findEntityArray(value, keys, 0);
}

function findEntityArray(value: unknown, keys: string[], depth: number): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object' || depth > 3) return [];

  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested;
  }

  // Herdr socket responses are wrapped as { id, result: { type, ...entities } }.
  // Keep the app tolerant of both wrapped and direct gateway responses.
  for (const envelope of ['result', 'data']) {
    const nested = findEntityArray(record[envelope], keys, depth + 1);
    if (nested.length > 0) return nested;
  }

  return [];
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

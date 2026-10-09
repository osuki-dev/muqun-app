import {
  asFiniteNumber,
  asRecord,
  asString,
  parseAgentInfo,
  parseTerminalBackendSummary,
  type AgentInfo,
  type TerminalBackendSummary,
} from './agent-protocol';

/** The gateway announces this when it serves `GET /api/fleet/self`. */
export const FLEET_CAPABILITY = 'fleet';

export interface FleetToolchain {
  id: string;
  version?: string;
  path?: string;
}

export interface FleetManifest {
  machineId: string;
  label: string;
  hostname: string;
  os: string;
  arch: string;
  gatewayVersion: string;
  agents: AgentInfo[];
  terminal: TerminalBackendSummary[];
  toolchains: FleetToolchain[];
  tasks: { active: number; waiting: number };
  suitableFor: string[];
}

function mapList<T>(value: unknown, parse: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  for (const entry of value) {
    const parsed = parse(entry);
    if (parsed) out.push(parsed);
  }
  return out;
}

function parseToolchain(value: unknown): FleetToolchain | null {
  const rec = asRecord(value);
  const id = asString(rec?.id);
  if (!rec || !id) return null;
  const version = asString(rec.version);
  const path = asString(rec.path);
  return { id, ...(version ? { version } : {}), ...(path ? { path } : {}) };
}

export function parseFleetManifest(value: unknown): FleetManifest | null {
  const rec = asRecord(value);
  const machineId = asString(rec?.machineId);
  if (!rec || !machineId) return null;
  const tasks = asRecord(rec.tasks);
  return {
    machineId,
    label: asString(rec.label) ?? '',
    hostname: asString(rec.hostname) ?? '',
    os: asString(rec.os) ?? '',
    arch: asString(rec.arch) ?? '',
    gatewayVersion: asString(rec.gatewayVersion) ?? '',
    agents: mapList(rec.agents, parseAgentInfo),
    terminal: mapList(rec.terminal, parseTerminalBackendSummary),
    toolchains: mapList(rec.toolchains, parseToolchain),
    tasks: {
      active: asFiniteNumber(tasks?.active) ?? 0,
      waiting: asFiniteNumber(tasks?.waiting) ?? 0,
    },
    suitableFor: mapList(rec.suitableFor, (entry) => asString(entry) ?? null),
  };
}

export function hasFleet(capabilities: readonly string[] | undefined): boolean {
  return capabilities?.includes(FLEET_CAPABILITY) === true;
}

export async function getFleetManifest(): Promise<FleetManifest | null> {
  const { readJson } = await import('./agent-session');
  const { demoFleetSelf, isDemoActive } = await import('./demo-gateway');
  if (isDemoActive()) return parseFleetManifest(demoFleetSelf());
  return readJson('/api/fleet/self', parseFleetManifest, null);
}

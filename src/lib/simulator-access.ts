import { allowsSimfarmPreview } from '@/lib/simfarm';
import type { GatewayRecord } from '@/lib/gateway-storage';

export type SimulatorAccessStatus = 'loading' | 'unpaired' | 'offline' | 'blocked' | 'ready';
export type SimulatorAccessReason =
  | 'demo'
  | 'ssh-tunnel'
  | 'transport'
  | 'identity'
  | 'invalid-health';
export type SimulatorAccessDecision = {
  status: SimulatorAccessStatus;
  reason?: SimulatorAccessReason;
  /** Earned from this probe's verified health, not from an entry/deep-link hint. */
  terminalConnected?: boolean;
};

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Unknown terminal availability never authorizes a setup command. */
export function simulatorTerminalConnected(health: unknown, serverId: string | undefined): boolean {
  const answer = object(health);
  if (!serverId || answer?.ok !== true || answer.serverId !== serverId) return false;
  const terminal = object(object(answer.planes)?.terminal);
  if (terminal && terminal.supported !== true) return false;
  const backends = terminal ? terminal.backends : (answer.backends ?? [answer.backend]);
  return (
    Array.isArray(backends) &&
    backends.some((value) => {
      const backend = object(value);
      return (
        backend?.connected === true &&
        typeof backend.sessionId === 'string' &&
        backend.sessionId.length > 0
      );
    })
  );
}

type HealthProbe = (
  record: GatewayRecord,
  timeoutMs: number,
  onHealth: (health: unknown) => void
) => Promise<boolean>;

/** Only this paired computer's current health can permit its other ports. */
export async function probeSimulatorAccess(
  record: GatewayRecord,
  demo: boolean,
  probe: HealthProbe
): Promise<SimulatorAccessDecision> {
  if (demo) return { status: 'blocked', reason: 'demo' };
  // Never send the saved host's token to the phone's loopback or SSH forward.
  if (record.sshTunnel) return { status: 'blocked', reason: 'ssh-tunnel' };
  let health: unknown;
  const reachable = await probe(record, 8000, (value) => {
    health = value;
  });
  if (!reachable) return { status: 'offline' };
  if (typeof health !== 'object' || health === null || Array.isArray(health))
    return { status: 'blocked', reason: 'invalid-health' };
  const answer = health as Record<string, unknown>;
  if (answer.serverId !== record.serverId) return { status: 'blocked', reason: 'identity' };
  if (answer.ok !== true) return { status: 'blocked', reason: 'invalid-health' };
  const security = answer.transportSecurity;
  const protection =
    typeof security === 'object' && security !== null && !Array.isArray(security)
      ? (security as Record<string, unknown>).protection
      : undefined;
  return typeof protection === 'string' && allowsSimfarmPreview(protection)
    ? { status: 'ready', terminalConnected: simulatorTerminalConnected(health, record.serverId) }
    : { status: 'blocked', reason: 'transport' };
}

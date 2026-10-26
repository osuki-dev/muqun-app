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
};

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
    ? { status: 'ready' }
    : { status: 'blocked', reason: 'transport' };
}

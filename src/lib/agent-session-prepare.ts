import {
  gatewayEndpointFetch,
  isGatewayEncryptionDisabled,
  withRecordBaseUrl,
} from './gateway-client';
import type { GatewayRecord } from './gateway-storage';
import { assertDeliveryCurrent } from './bound-delivery';
import { SessionPreparationFlights } from './foreground-session-activation';
import { isTransientPreparationError } from './agent-request-error';

const flights = new SessionPreparationFlights();
/** Waits before the second and third attempt: about 5 s in all, then the error shows. */
const PREPARE_RETRY_DELAYS_MS = [1_500, 3_000];

/** Include pairing credentials in memory identity; never persist or display this key. */
export function sessionPreparationSource(
  serverId: string,
  record: GatewayRecord,
  restart = 0
): string {
  return JSON.stringify([
    serverId,
    record.url,
    record.token,
    record.deviceId,
    record.transportKey,
    record.transport,
    record.sshTunnel?.hostId,
    record.sshTunnel?.remoteHost,
    record.sshTunnel?.remotePort,
    restart,
  ]);
}

/** Explicit activation is a write, separate from every history or watcher read. */
export function prepareAgentSessionAt(options: {
  serverId: string;
  record: GatewayRecord;
  current: () => boolean;
  agentId: string;
  asid: string;
  capabilities: readonly string[] | undefined;
  restart?: number;
}): Promise<void> {
  if (!options.capabilities?.includes('agent_session_resume_v1')) return Promise.resolve();
  assertDeliveryCurrent(options.current);
  const record = {
    ...options.record,
    sshTunnel: options.record.sshTunnel ? { ...options.record.sshTunnel } : undefined,
    transport: isGatewayEncryptionDisabled() ? undefined : options.record.transport,
  };
  const path = `/api/agents/${encodeURIComponent(options.agentId)}/sessions/${encodeURIComponent(options.asid)}/prepare`;
  const key = JSON.stringify([
    sessionPreparationSource(options.serverId, record, options.restart),
    options.agentId,
    options.asid,
  ]);
  const send = (current: () => boolean) =>
    withRecordBaseUrl(record, async (baseUrl) => {
      // The forward may have opened after the reader changed computer or session.
      assertDeliveryCurrent(current);
      // Retain this record's lease through the response body, without consulting globals.
      const response = await gatewayEndpointFetch(
        { ...record, url: baseUrl },
        baseUrl + path,
        { method: 'POST', headers: { Authorization: `Bearer ${record.token}` } },
        60_000
      );
      if (!response.ok)
        throw new Error(`Failed to resume session: ${response.status} ${await response.text()}`);
      const json = (await response.json()) as {
        data?: { prepared?: unknown };
        prepared?: unknown;
      } | null;
      assertDeliveryCurrent(current);
      if ((json?.data ?? json)?.prepared !== true)
        throw new Error('Failed to resume session: unreadable response');
    });
  return flights.run(
    key,
    async (current) => {
      // The flight stays pending across retries, so readers keep treating the
      // parked-history refusal as preparation in progress.
      for (const delay of [...PREPARE_RETRY_DELAYS_MS, undefined]) {
        try {
          return await send(current);
        } catch (error) {
          if (delay === undefined || !isTransientPreparationError(error)) throw error;
          await new Promise((resolve) => setTimeout(resolve, delay));
          assertDeliveryCurrent(current);
        }
      }
    },
    options.current
  );
}

/** A parked-history read is transient only while this exact source/provider is preparing. */
export function isAgentSessionPreparingAt(options: {
  serverId: string;
  record: GatewayRecord;
  agentId: string | undefined;
  asid: string;
  restart?: number;
}): boolean {
  if (!options.agentId) return false;
  const record = {
    ...options.record,
    transport: isGatewayEncryptionDisabled() ? undefined : options.record.transport,
  };
  return flights.isPending(
    JSON.stringify([
      sessionPreparationSource(options.serverId, record, options.restart),
      options.agentId,
      options.asid,
    ])
  );
}

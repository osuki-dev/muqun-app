import { useGatewayGeneration } from '@/stores/gateway-connection-generation';
import { useCallback, useEffect, useEffectEvent, useState } from 'react';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerCapabilities } from '@/stores/server-capabilities';
import { useLatestReader } from '@/hooks/use-render-refs';
import { ForegroundSessionActivation } from '@/lib/foreground-session-activation';
import { prepareAgentSessionAt, sessionPreparationSource } from '@/lib/agent-session-prepare';

/** Called only by the workbench owner or an actually open Home conversation. */
export function useForegroundAgentSession(options: {
  serverId: string;
  agentId: string | undefined;
  asid: string | undefined;
  foreground: boolean;
  onPrepared: (current: () => boolean) => void | Promise<void>;
  ownsForeground?: () => boolean;
}) {
  const record = useGatewayConnectionStore((state) => state.record);
  const capabilities = useServerCapabilities((state) => state.byServer[options.serverId]);
  const supported = capabilities?.includes('agent_session_resume_v1') === true;
  const restart = useGatewayGeneration((state) => state.restarts[options.serverId] ?? 0);
  const source = record ? sessionPreparationSource(record.serverId, record, restart) : null;
  const scope = JSON.stringify([source, options.serverId, options.agentId, options.asid]);
  const enabled =
    options.foreground &&
    supported &&
    record?.serverId === options.serverId &&
    Boolean(options.agentId && options.asid);
  const [activation] = useState(() => new ForegroundSessionActivation());
  const [attempt, setAttempt] = useState(0);
  const [failure, setFailure] = useState<{ scope: string; error: unknown } | null>(null);
  const read = useLatestReader({
    ...options,
    record,
    capabilities,
    source,
    scope,
    enabled,
    restart,
  });
  const prepared = useEffectEvent((current: () => boolean) => options.onPrepared(current));
  useEffect(() => {
    const owner = read();
    if (
      !owner.enabled ||
      !owner.record ||
      !owner.agentId ||
      !owner.asid ||
      owner.ownsForeground?.() === false
    )
      return;
    const endpoint = owner.record;
    const agentId = owner.agentId;
    const asid = owner.asid;
    // A fresh foreground intent owns its notice; cached history is never cleared.
    setFailure(null);
    let active = true;
    const current = () => {
      const latest = read();
      const currentRecord = useGatewayConnectionStore.getState().record;
      return (
        active &&
        latest.enabled &&
        latest.ownsForeground?.() !== false &&
        latest.scope === owner.scope &&
        currentRecord !== null &&
        sessionPreparationSource(
          currentRecord.serverId,
          currentRecord,
          useGatewayGeneration.getState().restarts[currentRecord.serverId] ?? 0
        ) === owner.source
      );
    };
    const cancel = activation.start({
      foreground: true,
      capabilities: owner.capabilities,
      current,
      prepare: () =>
        prepareAgentSessionAt({
          serverId: owner.serverId,
          record: endpoint,
          current,
          agentId,
          asid,
          capabilities: owner.capabilities,
          restart: owner.restart,
        }),
      prepared: () => {
        void (async () => prepared(current))().catch((error) => {
          if (current()) setFailure({ scope: owner.scope, error });
        });
      },
      failed: (error) => setFailure({ scope: owner.scope, error }),
    });
    return () => {
      active = false;
      cancel();
    };
  }, [activation, scope, enabled, attempt, read]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return {
    error: enabled && failure?.scope === scope ? failure.error : null,
    retry,
  };
}

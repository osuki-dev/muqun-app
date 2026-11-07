import { useGatewayGeneration } from '@/stores/gateway-connection-generation';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useServerChannels } from '@/stores/server-channels';
import { HistoryInterruptedError } from '@/lib/gateway-socket';
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
  const [failure, setFailure] = useState<{
    scope: string;
    error: unknown;
    retrying: boolean;
  } | null>(null);
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
    // A retry of the same session keeps its notice up and marks it retrying,
    // rather than clearing it and raising a new one on the next refusal: a
    // gateway that keeps answering 502 must not remount the notice each time.
    // Another session's failure is never carried over.
    setFailure((previous) =>
      previous?.scope === owner.scope ? { ...previous, retrying: true } : null
    );
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
        void (async () => prepared(current))().then(
          () => {
            if (current()) setFailure(null);
          },
          (error) => {
            if (current()) setFailure({ scope: owner.scope, error, retrying: false });
          }
        );
      },
      failed: (error) => setFailure({ scope: owner.scope, error, retrying: false }),
    });
    return () => {
      active = false;
      cancel();
      // An attempt that will never settle must not leave the notice retrying.
      setFailure((previous) => (previous?.retrying ? { ...previous, retrying: false } : previous));
    };
  }, [activation, scope, enabled, attempt, read]);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const shown = enabled && failure?.scope === scope ? failure : null;
  // A load the connection dropped is asked again once the socket is open,
  // instead of waiting on Retry: the gateway never refused it. Once per failure.
  const socketOpen = useServerChannels((state) => state.sockets[options.serverId] === 'open');
  const autoRetried = useRef<unknown>(null);
  useEffect(() => {
    const error = shown?.error;
    if (!socketOpen || shown?.retrying || !(error instanceof HistoryInterruptedError)) return;
    if (autoRetried.current === error) return;
    autoRetried.current = error;
    retry();
  }, [shown, socketOpen, retry]);
  return {
    error: shown ? shown.error : null,
    /** The notice's own attempt state, updated in place while a retry runs. */
    retrying: shown?.retrying === true,
    retry,
  };
}

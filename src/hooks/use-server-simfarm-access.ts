import { useCallback, useEffect, useState } from 'react';

import { isDemoRecord } from '@/lib/demo-gateway';
import { probeGatewayReachable } from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { probeSimulatorAccess, type SimulatorAccessDecision } from '@/lib/simulator-access';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

/** Resolve the owning computer without changing or trusting Home's selection. */
export function useServerSimfarmAccess(serverId: string | undefined, enabled = true) {
  const record = useGatewayConnectionStore((state) =>
    state.records.find((entry) => entry.serverId === serverId)
  );
  const hydrating = useGatewayConnectionStore((state) => state.loading);
  const [attempt, setAttempt] = useState(0);
  const [answer, setAnswer] = useState<{
    record: GatewayRecord;
    attempt: number;
    decision: SimulatorAccessDecision;
  } | null>(null);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let disposed = false;
    if (!enabled || !record) {
      setAnswer(null);
    } else {
      void probeSimulatorAccess(record, isDemoRecord(record), probeGatewayReachable).then(
        (decision) => {
          if (!disposed) setAnswer({ record, attempt, decision });
        },
        () => {
          if (!disposed) setAnswer({ record, attempt, decision: { status: 'offline' } });
        }
      );
    }
    return () => {
      disposed = true;
    };
  }, [attempt, enabled, record]);

  const decision: SimulatorAccessDecision =
    !record && !hydrating
      ? { status: 'unpaired' }
      : enabled && answer !== null && answer.record === record && answer.attempt === attempt
        ? answer.decision
        : { status: 'loading' };
  return { record, ...decision, refresh };
}

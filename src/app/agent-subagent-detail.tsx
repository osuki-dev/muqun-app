import { useCallback, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { AgentSubagentDetailSheet } from '@/components/agent-subagent-detail-sheet';
import { demoAgentSessionSnapshot, isDemoActive } from '@/lib/demo-gateway';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';

const firstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

export default function AgentSubagentDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    sessionId?: string | string[];
    asid?: string | string[];
  }>();
  const routeSessionId = firstParam(params.sessionId);
  const asid = firstParam(params.asid);
  const bridgeSessionId = useAgentSheetBridge((state) => state.sessionId);
  const sessions = useAgentSheetBridge((state) => state.sessions);
  const childrenByParent = useAgentSheetBridge((state) => state.childrenByParent);
  const sessionId = routeSessionId || bridgeSessionId || undefined;
  const fallbackInfo = useMemo(() => {
    if (!asid) return undefined;
    const root = sessions.find((session) => session.asid === asid);
    if (root) return root;
    for (const children of Object.values(childrenByParent)) {
      const child = children.find((session) => session.asid === asid);
      if (child) return child;
    }
    return isDemoActive() ? (demoAgentSessionSnapshot(asid)?.info ?? undefined) : undefined;
  }, [asid, childrenByParent, sessions]);
  const openChild = useCallback(
    (childAsid: string) => {
      if (!childAsid || childAsid === asid) return;
      router.setParams({
        asid: childAsid,
        ...(sessionId ? { sessionId } : {}),
      });
    },
    [asid, router, sessionId]
  );

  return (
    <AgentSubagentDetailSheet
      sessionId={sessionId}
      asid={asid}
      fallbackInfo={fallbackInfo}
      onOpenChild={openChild}
    />
  );
}

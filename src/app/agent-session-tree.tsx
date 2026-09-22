import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useRef } from 'react';

import { AgentSessionTreeSheet } from '@/components/agent-session-tree-sheet';
import { demoAgentSessionTree, isDemoActive } from '@/lib/demo-gateway';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';

export default function AgentSessionTreeScreen() {
  const router = useRouter();
  const { rootAsid } = useLocalSearchParams<{ rootAsid: string }>();
  const bridgeRoot = useAgentSheetBridge((state) =>
    state.sessions.find((session) => session.asid === rootAsid)
  );
  const bridgeChildren = useAgentSheetBridge((state) => state.childrenByParent);
  const bridgeSessionId = useAgentSheetBridge((state) => state.sessionId);
  const demoTree = useMemo(
    () => (rootAsid === 'demo-tree-root' && isDemoActive() ? demoAgentSessionTree() : null),
    [rootAsid]
  );
  const root = bridgeRoot ?? demoTree?.root;
  const childrenByParent = bridgeRoot ? bridgeChildren : (demoTree?.childrenByParent ?? {});
  const selectSession = useAgentSheetBridge((state) => state.actions.selectSession);
  const closingRef = useRef(false);
  const detailOpeningRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      detailOpeningRef.current = false;
    }, [])
  );

  return (
    <AgentSessionTreeSheet
      root={root}
      childrenByParent={childrenByParent}
      onPressNode={(node) => {
        if (node.depth === 0) {
          if (closingRef.current) return;
          closingRef.current = true;
          selectSession(node.session.asid);
          router.back();
          return;
        }
        if (detailOpeningRef.current) return;
        detailOpeningRef.current = true;
        router.navigate({
          pathname: '/agent-subagent-detail',
          params: {
            asid: node.session.asid,
            ...(bridgeSessionId ? { sessionId: bridgeSessionId } : {}),
          },
        });
      }}
    />
  );
}

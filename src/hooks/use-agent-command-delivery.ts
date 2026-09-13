import { useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';

import {
  AgentCommandDeliveryError,
  agentCommandDestination,
  sendVerifiedAgentCommand,
  type AgentCommandDestination,
} from '@/lib/agent-command-delivery';
import { loadAgents } from '@/lib/gateway-client';
import { collaborationTaskText } from '@/lib/quick-command-collaboration';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';

/** Hold the opening identity so later occupants never inherit an already-open command sheet. */
export function useAgentCommandDelivery(context: {
  serverId?: string;
  sessionId?: string;
  paneId?: string;
  enabled: boolean;
}) {
  const { t } = useLingui();
  const { serverId, sessionId, paneId, enabled } = context;
  const [destination, setDestination] = useState<AgentCommandDestination | null>(null);
  useEffect(() => {
    setDestination(null);
    if (!enabled || !serverId || !sessionId || !paneId) return;
    if (useGatewayConnectionStore.getState().record?.serverId !== serverId) return;
    let cancelled = false;
    void loadAgents(sessionId)
      .then((agents) => {
        if (!cancelled && useGatewayConnectionStore.getState().record?.serverId === serverId) {
          setDestination(agentCommandDestination(serverId, sessionId, paneId, agents));
        }
      })
      .catch(() => {
        // Keep commands saved and fail closed until this surface is reopened successfully.
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, serverId, sessionId, paneId]);

  async function send(text: string) {
    try {
      const currentDestination =
        enabled &&
        destination !== null &&
        destination.serverId === serverId &&
        destination.sessionId === sessionId &&
        destination.paneId === paneId
          ? destination
          : null;
      await sendVerifiedAgentCommand(currentDestination, collaborationTaskText(text, ''), {
        connectedServerId: () => useGatewayConnectionStore.getState().record?.serverId,
        loadAgents,
        // TODO: Wire the verified Gateway/backend instance-bound request contract.
        // A capability label without server enforcement is not sufficient.
        supportsBoundDelivery: async () => false,
        send: async () => {
          throw new AgentCommandDeliveryError('unsupported');
        },
      });
    } catch (failure) {
      if (!(failure instanceof AgentCommandDeliveryError)) throw failure;
      switch (failure.code) {
        case 'connection':
          throw new Error(t`Return to this server to continue.`);
        case 'unsupported':
          throw new Error(
            t`Update Muqun Gateway to use Agent collaboration. Your terminals still work as usual.`
          );
        case 'ambiguous':
          throw new Error(
            t`Check the assistant before sending again; it may have received the request.`
          );
        case 'agent':
          throw new Error(t`This assistant is no longer ready. Refresh or choose another.`);
      }
    }
  }
  return { send };
}

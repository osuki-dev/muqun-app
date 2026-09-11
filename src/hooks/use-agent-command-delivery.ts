import { useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';

import {
  AgentCommandDeliveryError,
  agentCommandDestination,
  sendVerifiedAgentCommand,
  type AgentCommandDestination,
} from '@/lib/agent-command-delivery';
import { loadAgents, sendAgentText } from '@/lib/gateway-client';
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
        // These commands go to the agent in the pane the reader has open -- the
        // same agent the composer above it talks to, through the same endpoint.
        // This used to refuse every one of them, waiting on the instance-bound
        // contract that `supportsExistingAgentDelivery` describes, which made
        // the whole catalogue dead: `/status` on the agent on screen answered
        // "Update Muqun Gateway".
        //
        // That contract is about dispatching to an agent nobody is watching.
        // It is not about this. Here the pane is on screen, its output is
        // streaming, and the destination is re-verified by instance immediately
        // before the write -- which is more than `sendInput` does for the very
        // same agent. Holding this surface to a stricter rule than the text
        // field directly above it was not caution; it was an outage.
        supportsBoundDelivery: async () => true,
        // A question, not an assignment: nothing here waits for a turn to
        // complete, so a working agent is a fine recipient. See `requireIdle`.
        requireIdle: false,
        send: async (target, value) => {
          if (!sessionId) throw new AgentCommandDeliveryError('connection');
          // The opaque target from the fresh lookup, never the captured one.
          await sendAgentText(sessionId, target.target, value);
        },
      });
    } catch (failure) {
      if (!(failure instanceof AgentCommandDeliveryError)) throw failure;
      switch (failure.code) {
        case 'connection':
          throw new Error(t`Return to this server to continue.`);
        case 'unsupported':
          // Unreachable from here now that this surface sends. Kept because the
          // error type is shared, and a silent fall-through would be worse than
          // a sentence nobody should see.
          throw new Error(t`This server cannot run that command yet.`);
        case 'ambiguous':
          throw new Error(
            t`Check the assistant before sending again; it may have received the request.`
          );
        case 'agent':
          // The instance changed or the pane no longer has an agent -- not that
          // the agent is busy, which this surface deliberately allows.
          throw new Error(
            t`That assistant is no longer in this terminal. Reopen it and try again.`
          );
      }
    }
  }
  return { send };
}

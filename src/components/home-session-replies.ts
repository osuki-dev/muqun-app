import { useLingui } from '@lingui/react/macro';
import { useToast } from '@osuki-dev/ui';

import { replyAgentForm, replyAgentPermission, type PermissionDecision } from '@/lib/agent-session';
import { describeGatewayFailure } from '@/lib/network-error';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { useHomeAttention } from '@/stores/home-attention';

/**
 * Answering a session's permission or question from Home -- the reply
 * drawer's cards and the Stage's needs-you card -- over the session screen's
 * own calls. Only through the computer the session is on: a reply while the
 * connection points elsewhere is dropped rather than sent to the wrong
 * computer. A confirmed decision resolves exactly that request in Needs you;
 * a failure says so and leaves the request standing.
 */
export function useHomeSessionReplies({
  serverId,
  sessionId,
  asid,
}: {
  serverId: string;
  sessionId: string;
  asid: string;
}) {
  const { t } = useLingui();
  const { showToast } = useToast();
  const owns = () => useGatewayConnectionStore.getState().record?.serverId === serverId;
  const failed = (failure: unknown) =>
    showToast({
      variant: 'danger',
      title: t`Could not reply`,
      message: describeGatewayFailure(failure, t`Could not reply`).message,
    });
  const decide = async (requestId: string, decision: PermissionDecision) => {
    if (!owns()) return;
    try {
      await replyAgentPermission(sessionId, asid, requestId, decision);
      useHomeAttention
        .getState()
        .resolve({ kind: 'agent-session', serverId, sessionId, directory: '', asid }, requestId);
    } catch (failure) {
      console.warn('Home could not reply to a permission:', failure);
      failed(failure);
    }
  };
  const answer = async (formId: string, answers: Record<string, unknown>) => {
    if (!owns()) return;
    try {
      await replyAgentForm(sessionId, asid, formId, answers);
    } catch (failure) {
      console.warn('Home could not answer a question:', failure);
      failed(failure);
    }
  };
  return { decide, answer };
}

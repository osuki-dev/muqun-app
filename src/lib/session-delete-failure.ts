import { t } from '@lingui/core/macro';

import { agentRequestErrorDetail, classifyAgentRequestError } from './agent-request-error';
import { HomeSessionDeleteUnavailableError } from './home-session-delete';
import { describeGatewayFailure } from './network-error';

/**
 * What every delete entry point says when a delete fails: the gateway's own
 * words when it answered with a refusal ("a terminal holds this session",
 * "deletion requires ..."), the app's sentence otherwise. Never retried.
 */
export function sessionDeleteFailureMessage(failure: unknown): string {
  if (failure instanceof HomeSessionDeleteUnavailableError)
    return failure.reason === 'provider'
      ? t`Refresh Home to identify this session’s provider before deleting it.`
      : t`Update Gateway on this computer, then reconnect to enable deleting sessions from Home.`;
  const { status, message } = agentRequestErrorDetail(failure);
  if (status === 404)
    return t`This session is no longer available in this service. Refresh Home before trying again.`;
  // 401 and 403 are about the pairing, which the gateway's sentence does not explain.
  if (message && status >= 400 && status !== 401 && status !== 403)
    return t`Could not delete: ${message}`;
  if (classifyAgentRequestError(failure).kind === 'unsupported')
    return t`This provider cannot delete sessions. Open the session to stop a running turn or manage it on its computer.`;
  const described = describeGatewayFailure(failure);
  return ['auth', 'network', 'timeout', 'backend'].includes(described.kind)
    ? described.message
    : t`Could not delete this session. Reconnect to its computer and refresh Home before trying again.`;
}

/**
 * The same rule for a task: the gateway's own sentence for a refusal
 * (`409 task_active`: "cancel it first"), the app's otherwise.
 */
export function taskDeleteFailureMessage(failure: unknown): string {
  const { status, message } = agentRequestErrorDetail(failure);
  if (message && status >= 400 && status !== 401 && status !== 403)
    return t`Could not delete: ${message}`;
  const described = describeGatewayFailure(failure);
  return ['auth', 'network', 'timeout', 'backend'].includes(described.kind)
    ? described.message
    : t`Could not delete this task. Reconnect to its computer and try again.`;
}

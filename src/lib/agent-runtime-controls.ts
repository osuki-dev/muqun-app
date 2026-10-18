import type { AgentFeatures, AgentSessionInfo, FormRequest, ModelRef } from './agent-protocol';
import { nativeAgentInteraction, type AgentSessionRuntime } from './agent-session-runtime';

export type AgentSessionAction = 'rename' | 'delete' | 'fork';

/** Existing actions retain legacy support; new routes require explicit discovery. */
export function canMutateAgentSession(
  action: AgentSessionAction,
  session: Pick<AgentSessionInfo, 'runtime'>,
  features: AgentFeatures,
  capabilities?: readonly string[]
): boolean {
  if (!nativeAgentInteraction(session.runtime)) return false;
  if (action === 'fork') {
    return (
      features.extra.sessionFork === true &&
      capabilities?.includes('agent_session_fork_v1') === true
    );
  }
  return features.extra[action === 'rename' ? 'sessionRename' : 'sessionDelete'] !== false;
}

/** Prompt delivery is separate from structured form and approval replies. */
export function canSendAgentPrompt(
  running: boolean,
  supportsInbox: boolean,
  supportsSteering = false,
  delivery?: 'steer' | 'queue'
): boolean {
  return !running || supportsInbox || (supportsSteering && delivery !== 'queue');
}

/** An async question asks for input without stopping the agent's turn. */
export function hasBlockingAgentForm(forms: readonly FormRequest[]): boolean {
  return forms.some((form) => form.nonblocking !== true);
}

/** Async question controls require a currently owned native session. */
export function canReplyAgentForm(
  form: FormRequest,
  runtime: AgentSessionRuntime | undefined
): boolean {
  return (
    nativeAgentInteraction(runtime) && (form.nonblocking !== true || runtime?.source === 'native')
  );
}

export interface StagedAgentModel {
  serverId: string;
  asid: string;
  gatewayGeneration?: string;
  model: ModelRef;
}

/** A Gateway-local selection cannot outlive the process that accepted it. */
export function stagedAgentModelFor(
  staged: StagedAgentModel | undefined,
  serverId: string,
  asid: string | undefined,
  gatewayGeneration: string | undefined
): ModelRef | undefined {
  if (
    staged?.serverId === serverId &&
    staged.asid === asid &&
    staged.gatewayGeneration === gatewayGeneration
  ) {
    return staged.model;
  }
  return undefined;
}

/** A next-turn selection is never evidence of the session's actual model/effort. */
export function confirmedAgentModel(
  asid: string,
  session: AgentSessionInfo | null,
  listedSession: AgentSessionInfo | null | undefined
): ModelRef | undefined {
  if (session?.asid === asid) return session.model ?? undefined;
  if (listedSession?.asid === asid) return listedSession.model ?? undefined;
  return undefined;
}

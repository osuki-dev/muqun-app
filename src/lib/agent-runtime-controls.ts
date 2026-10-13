import type { AgentSessionInfo, ModelRef } from './agent-protocol';

/** Prompt delivery is separate from structured form and approval replies. */
export function canSendAgentPrompt(running: boolean, supportsInbox: boolean): boolean {
  return !running || supportsInbox;
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

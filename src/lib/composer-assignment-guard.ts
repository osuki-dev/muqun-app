import { collaborationAvailability } from './agent-collaboration';
import { assertDeliveryCurrent } from './bound-delivery';
import type { HealthResponse } from './gateway-client';

export type AssignmentScope = { serverId: string; sessionId: string; sourcePaneId: string };

export function assignmentScopeKey(scope: AssignmentScope): string {
  return JSON.stringify([scope.serverId, scope.sessionId, scope.sourcePaneId]);
}

/** A read can outlive the addressed session. Refuse before and after it yields. */
export async function verifyAssignmentCapability(
  sessionId: string,
  load: () => Promise<HealthResponse>,
  isCurrent: () => boolean
): Promise<void> {
  assertDeliveryCurrent(isCurrent);
  const health = await load();
  assertDeliveryCurrent(isCurrent);
  const backend = health.backends?.find((item) => item.sessionId === sessionId) ?? health.backend;
  if (collaborationAvailability(health, sessionId, backend?.kind ?? '') !== 'ready')
    throw new Error(
      'Agent collaboration is unavailable for this session. Check its Gateway and Herdr connection.'
    );
}

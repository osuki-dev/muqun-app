import type { WorkAttempt, WorkTask } from './work-api';
import { utf8Bytes } from './multipart';

export type WorkDependencyRequirement = 'result_available' | 'human_accepted';
export type WorkDelegationPolicy = {
  enabled: boolean;
  max_children: number;
  max_depth: 0 | 1;
  dependency_requirement: WorkDependencyRequirement;
};
export type WorkDelegationState = {
  policy: WorkDelegationPolicy;
  coordinator_attempt_id: string | null;
  coordinator_epoch: number;
};
export type WorkDelegationConfig = {
  policy: WorkDelegationPolicy;
  coordinator_attempt_id: string | null;
};
/** Captured local guard; only input and expected_revision belong in the HTTP body. */
export type WorkDelegationLead = {
  taskId: string;
  attemptId: string;
  instanceId: string;
  nativeOwnerEpoch: string;
};
export type WorkDelegationIntent = {
  serverId: string;
  sessionId: string;
  taskId: string;
  expected_revision: number;
  coordinator: WorkDelegationLead | null;
  input: WorkDelegationConfig;
};
export type WorkDelegationAvailability = {
  connected: boolean;
  capable: boolean;
  pending: boolean;
  historyComplete: boolean;
};
export type WorkDelegationProblem =
  | 'child_task'
  | 'offline'
  | 'unavailable'
  | 'pending'
  | 'history_incomplete'
  | 'invalid_limit'
  | 'lead_required'
  | 'lead_changed';
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const opaque = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.trim().length > 0 &&
  utf8Bytes(value).length <= 256 &&
  !/[\u0000-\u001f\u007f]/.test(value);
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid delegation state');
  return value as Record<string, unknown>;
}
export function parseWorkDelegationPolicy(value: unknown): WorkDelegationPolicy {
  const raw = object(value);
  if (
    typeof raw.enabled !== 'boolean' ||
    !Number.isSafeInteger(raw.max_children) ||
    (raw.max_children as number) < 0 ||
    (raw.max_children as number) > 64 ||
    ![0, 1].includes(raw.max_depth as number) ||
    !['result_available', 'human_accepted'].includes(raw.dependency_requirement as string)
  )
    throw new Error('Invalid delegation policy');
  return {
    enabled: raw.enabled,
    max_children: raw.max_children as number,
    max_depth: raw.max_depth as 0 | 1,
    dependency_requirement: raw.dependency_requirement as WorkDependencyRequirement,
  };
}
export function parseWorkDelegationState(value: unknown): WorkDelegationState {
  // Gateway's explicit migration default for older task records.
  if (value === undefined)
    return {
      policy: {
        enabled: false,
        max_children: 16,
        max_depth: 1,
        dependency_requirement: 'result_available',
      },
      coordinator_attempt_id: null,
      coordinator_epoch: 0,
    };
  const raw = object(value);
  const policy = parseWorkDelegationPolicy(raw.policy);
  if (
    (raw.coordinator_attempt_id !== null &&
      (typeof raw.coordinator_attempt_id !== 'string' || !uuid.test(raw.coordinator_attempt_id))) ||
    !Number.isSafeInteger(raw.coordinator_epoch) ||
    (raw.coordinator_epoch as number) < 0 ||
    (policy.enabled && raw.coordinator_attempt_id === null)
  )
    throw new Error('Invalid delegation coordinator');
  return {
    policy,
    coordinator_attempt_id: raw.coordinator_attempt_id as string | null,
    coordinator_epoch: raw.coordinator_epoch as number,
  };
}
export function confirmedDelegationLead(
  task: WorkTask,
  attempt: WorkAttempt
): WorkDelegationLead | null {
  if (
    task.parent_task_id !== null ||
    attempt.task_id !== task.id ||
    attempt.role !== 'lead' ||
    attempt.lifecycle?.launch_phase !== 'launch_confirmed' ||
    attempt.lifecycle.reservation !== 'reserved' ||
    !opaque(attempt.instance_id) ||
    !opaque(attempt.lifecycle.native_owner_epoch)
  )
    return null;
  return {
    taskId: task.id,
    attemptId: attempt.id,
    instanceId: attempt.instance_id,
    nativeOwnerEpoch: attempt.lifecycle.native_owner_epoch,
  };
}
export function delegationUnavailable(
  task: WorkTask,
  state: WorkDelegationAvailability
): WorkDelegationProblem | null {
  if (task.parent_task_id !== null) return 'child_task';
  if (!state.connected) return 'offline';
  if (!state.capable) return 'unavailable';
  if (state.pending) return 'pending';
  if (!state.historyComplete) return 'history_incomplete';
  return null;
}
export function captureWorkDelegationIntent(args: {
  serverId: string;
  task: WorkTask;
  attempts: readonly WorkAttempt[];
  availability: WorkDelegationAvailability;
  enabled: boolean;
  maxChildren: string;
  requirement: WorkDependencyRequirement;
  selectedLead: WorkDelegationLead | null;
}): { ok: true; intent: WorkDelegationIntent } | { ok: false; problem: WorkDelegationProblem } {
  const unavailable = delegationUnavailable(args.task, {
    ...args.availability,
    historyComplete: !args.enabled || args.availability.historyComplete,
  });
  if (unavailable) return { ok: false, problem: unavailable };
  if (!/^(0|[1-9][0-9]*)$/.test(args.maxChildren) || Number(args.maxChildren) > 64)
    return { ok: false, problem: 'invalid_limit' };
  let coordinator: WorkDelegationLead | null = null;
  if (args.enabled) {
    if (!args.selectedLead) return { ok: false, problem: 'lead_required' };
    const selected = args.attempts.find((attempt) => attempt.id === args.selectedLead!.attemptId);
    coordinator = selected ? confirmedDelegationLead(args.task, selected) : null;
    if (
      !coordinator ||
      coordinator.taskId !== args.selectedLead.taskId ||
      coordinator.instanceId !== args.selectedLead.instanceId ||
      coordinator.nativeOwnerEpoch !== args.selectedLead.nativeOwnerEpoch
    )
      return { ok: false, problem: 'lead_changed' };
  }
  const policy = parseWorkDelegationPolicy({
    enabled: args.enabled,
    max_children: Number(args.maxChildren),
    max_depth: 1,
    dependency_requirement: args.requirement,
  });
  return {
    ok: true,
    intent: {
      serverId: args.serverId,
      sessionId: args.task.session_id,
      taskId: args.task.id,
      expected_revision: args.task.revision,
      coordinator: coordinator ? { ...coordinator } : null,
      input: { policy, coordinator_attempt_id: coordinator?.attemptId ?? null },
    },
  };
}

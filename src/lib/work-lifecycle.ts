import type { WorkAttempt, WorkDetail, WorkOperation } from './work-api';
import { workExecutionRecordsComplete } from './work-pagination';

export function workAttemptReleased(attempt: WorkAttempt) {
  return attempt.lifecycle?.reservation === 'released' && Boolean(attempt.lifecycle.release);
}

/** Reconciliation queries do not deliver input; their uncertainty is not an input lock. */
export function workOperationBlocksExecution(
  operation: WorkOperation,
  attempts: readonly WorkAttempt[],
  targetAttemptId?: string
) {
  return (
    (['start_attempt', 'deliver_prompt'].includes(operation.kind) ||
      (operation.kind === 'interrupt_attempt' && operation.attempt_id === targetAttemptId)) &&
    ['prepared', 'submitting', 'unconfirmed'].includes(operation.state) &&
    !attempts.some((attempt) => attempt.id === operation.attempt_id && workAttemptReleased(attempt))
  );
}

export function canReplaceWorkAttempt(detail: WorkDetail, attemptId: string) {
  const selected = detail.attempts.find((attempt) => attempt.id === attemptId);
  if (
    !selected ||
    detail.task.paused ||
    !workExecutionRecordsComplete(detail) ||
    !workAttemptReleased(selected)
  )
    return false;
  if (
    detail.operations.some((operation) =>
      workOperationBlocksExecution(operation, detail.attempts, attemptId)
    )
  )
    return false;
  if (selected.role === 'lead')
    return !detail.attempts.some(
      (attempt) => attempt.role === 'lead' && !workAttemptReleased(attempt)
    );
  return (
    detail.attempts.filter((attempt) => attempt.role === 'worker' && !workAttemptReleased(attempt))
      .length < detail.task.policy.max_workers
  );
}

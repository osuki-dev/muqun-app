import type { WorkDependency, WorkDetail, WorkTask } from './work-api';
import type { WorkTaskRow } from './work-summaries';
/** A child depends only on an exact result of a different child of the same parent. */
export function relatedDependencyTask(task: WorkTask, candidate: WorkTaskRow): boolean {
  return (
    task.parent_task_id !== null &&
    candidate.id !== task.id &&
    candidate.parent_task_id === task.parent_task_id &&
    candidate.repo_path === task.repo_path &&
    candidate.session_id === task.session_id
  );
}
export function selectWorkDependencyVersion(
  task: WorkTask,
  prerequisite: WorkDetail,
  submissionId: string | null,
  draft: readonly WorkDependency[]
): WorkDependency[] {
  if (!relatedDependencyTask(task, prerequisite.task))
    throw new Error('Unrelated prerequisite task');
  if (
    submissionId !== null &&
    !prerequisite.results.some(
      (result) => result.id === submissionId && result.task_id === prerequisite.task.id
    )
  )
    throw new Error('Result version was not inspected');
  if (
    !draft.some((item) => item.prerequisite_task_id === prerequisite.task.id) &&
    draft.length >= 16
  )
    throw new Error('Too many dependencies');
  const replacement = { prerequisite_task_id: prerequisite.task.id, submission_id: submissionId };
  return draft.some((item) => item.prerequisite_task_id === prerequisite.task.id)
    ? draft.map((item) =>
        item.prerequisite_task_id === prerequisite.task.id ? replacement : { ...item }
      )
    : [...draft.map((item) => ({ ...item })), replacement];
}

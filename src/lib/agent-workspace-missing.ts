import {
  sameDirectory,
  type AgentProject,
  type AgentVcsDiff,
  type WorkspaceMissing,
} from './agent-protocol';

/**
 * A workspace that is gone, as the screen holds it.
 *
 * The state is bound to the session the refusal was about, not to the screen:
 * the reader moves between sessions on one host, and a folder deleted under
 * one of them says nothing about the next. It is bound to the directory too,
 * so a move to a worktree or a switch to another workspace clears it by
 * arithmetic rather than by anyone remembering to.
 */
export interface WorkspaceMissingState {
  /** The session that was standing on it. */
  asid: string;
  /** The folder the gateway named. The screen shows this. */
  directory: string;
  /** The gateway's own sentence, for a log rather than for the screen. */
  message: string;
}

export interface BadgeLoadScope {
  asid?: string | undefined;
  directory?: string | undefined;
  missing?: WorkspaceMissingState | null | undefined;
}

/**
 * Whether the badge reads may run: context, diff, shells, worktrees.
 *
 * Every one of them is about a directory, so when the gateway has said that
 * directory is gone there is nothing there to count -- and asking anyway is
 * four `404`s on every entry and every focus, which is the bug this is here to
 * end. The answer is not a latch: it is a comparison against what is on screen
 * now, so the moment the session or the directory changes the reads resume
 * without anything having to be reset.
 *
 * A refusal with no directory on screen to compare against is still a refusal
 * -- the screen has not moved anywhere, it simply has not said where it is.
 */
export function badgeLoadsAllowed(scope: BadgeLoadScope): boolean {
  const missing = scope.missing;
  if (!missing) return true;
  if (scope.asid && scope.asid !== missing.asid) return true;
  return !sameDirectory(missing.directory, scope.directory ?? missing.directory);
}

/**
 * The state a refusal makes, or `null` when there was no refusal to speak of.
 *
 * A refusal about a session the screen is no longer showing is dropped: it
 * arrived late, and a notice about a session the reader has left names a
 * folder they are not standing in.
 */
export function workspaceMissingState(
  missing: WorkspaceMissing | undefined | null,
  asid: string | undefined
): WorkspaceMissingState | null {
  if (!missing || !asid) return null;
  return { asid, directory: missing.directory, message: missing.message };
}

/** What the changes sheet has to say when it has no rows to show. */
export type DiffEmptyState =
  | 'rows'
  | 'loading'
  | 'workspace-missing'
  | 'not-a-repository'
  | 'clean';

/**
 * Which of the four the sheet is looking at.
 *
 * "Nothing uncommitted" was the answer to all of them, and it is only true of
 * the last: a folder that is gone and a folder that is not a repository are
 * not clean, they are unanswerable, and saying they are clean is the app
 * inventing a fact about the host. Rows win over every reason -- a body that
 * carries files and a reason not to have any is a contradiction, and the files
 * are the half a reader can check.
 */
export function diffEmptyState(answer: {
  loading: boolean;
  fileCount: number;
  reason?: AgentVcsDiff['reason'];
}): DiffEmptyState {
  if (answer.fileCount > 0) return 'rows';
  if (answer.loading) return 'loading';
  if (answer.reason === 'workspace_missing') return 'workspace-missing';
  if (answer.reason === 'not_a_repository') return 'not-a-repository';
  return 'clean';
}

/**
 * Which known workspaces a picker lists.
 *
 * The gateway flags a project whose directory is no longer on disk with
 * `missing: true`. A row for one is an offer the app cannot keep: tapping it
 * lands on a folder that is not there, and the session that opens has nothing
 * to stand on. So they are not offered.
 *
 * The workspace the reader is *in* is the exception, and stays on the list
 * whatever the gateway says about it. It is where the screen already is --
 * removing its row would leave the sheet marking nothing as current and the
 * reader with no way to see what they are standing on. It is marked instead;
 * `workspaceProjectMissing` is what the row asks.
 *
 * The field is optional on the wire and a gateway that has never sent it is
 * the normal case: absent is present, which is what `=== true` says here.
 */
export function listableWorkspaces(
  projects: readonly AgentProject[],
  activeDirectory?: string
): AgentProject[] {
  return projects.filter(
    (project) =>
      project.missing !== true ||
      (activeDirectory !== undefined && sameDirectory(project.canonical, activeDirectory))
  );
}

/** Whether a listed workspace is one the host says is no longer there. */
export function workspaceProjectMissing(project: Pick<AgentProject, 'missing'>): boolean {
  return project.missing === true;
}

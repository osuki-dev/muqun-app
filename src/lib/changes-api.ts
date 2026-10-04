import { fileChangeFromDiffItem, fileChangeFromSummary } from './agent-diff-rows';
import type {
  AgentVcsDiff,
  AgentVcsFilePatch,
  AgentVcsFiles,
  VcsFilesMode,
  WorkspaceMissing,
} from './agent-protocol';
import {
  DIFF_CONTEXT_LINES,
  FILE_PATCH_MAX_LINES,
  type GitFileChange,
  type GitFilePatchPage,
  type GitStatus,
} from './git-diff';

/**
 * The one Changes sheet's view of a gateway, for an agent session and for a
 * terminal pane alike.
 *
 * The sheet draws one thing -- a directory tree of changed files, a scope
 * menu, a file's patch under it when opened, and a discard -- and does not
 * care which routes answered. These adapters are where the two surfaces
 * differ, and nowhere else:
 *
 * - An agent session asks `…/agent/{asid}/vcs/files` (`agent_vcs_files`), and
 *   falls back to `…/vcs/diff`, which answers every patch at once.
 * - A terminal pane asks `…/panes/{pid}/vcs/files` (`pane_vcs_files`), and
 *   falls back to `…/git/status` plus `…/git/diff`, which pages one file's
 *   patch at a time.
 *
 * Pure apart from the client functions handed in, so the wiring is tested
 * without a gateway.
 */

/** How a listing's patches arrive: per file on open, all at once, or a page at a time. */
export type ChangesPatchSource = 'lazy' | 'eager' | 'paged';

/** The file list, from whichever route answered. */
export interface ChangeListing {
  changes: GitFileChange[];
  source: ChangesPatchSource;
  /** Every patch, already in hand (`eager` only); empty otherwise. */
  patches: ReadonlyMap<string, string>;
  truncated: boolean;
  reason?: 'not_a_repository' | 'no_default_branch' | 'workspace_missing';
  missing?: WorkspaceMissing;
  /** The ref "compared with" names, when the gateway offers one. */
  base?: string;
}

/** One file's patch at the context asked for (`lazy` listings). */
export interface ChangesFilePatch {
  patch: string;
  truncated: boolean;
  /** Nothing differs between the two sides any more. */
  unchanged: boolean;
}

export interface ChangesApi {
  /** The changed files for a scope. Throws only when there is nothing to show at all. */
  listing(mode: VcsFilesMode, signal?: AbortSignal): Promise<ChangeListing>;
  /** One file's patch, for a `lazy` listing. Throws when there is none to show. */
  file(args: { mode: VcsFilesMode; path: string; context: number }): Promise<ChangesFilePatch>;
  /** One page of one file's patch, for a `paged` listing. */
  page?(file: GitFileChange, from: number, signal?: AbortSignal): Promise<GitFilePatchPage>;
  /** Throw away one file's uncommitted changes. Absent: no Discard is offered. */
  discard?(path: string): Promise<unknown>;
}

const NO_PATCHES: ReadonlyMap<string, string> = new Map();

/** A `…/vcs/files` answer, from either surface. */
export function listingFromVcsFiles(answer: AgentVcsFiles): ChangeListing {
  return {
    changes: answer.files.map(fileChangeFromSummary),
    source: 'lazy',
    patches: NO_PATCHES,
    truncated: answer.truncated,
    reason: answer.reason,
    missing: answer.missing,
    base: answer.base,
  };
}

/** An agent's `…/vcs/diff` answer: every patch at once. */
export function listingFromAgentDiff(answer: AgentVcsDiff): ChangeListing {
  return {
    changes: answer.files.map(fileChangeFromDiffItem),
    source: 'eager',
    patches: new Map(answer.files.map((file) => [file.path, file.patch])),
    truncated: false,
    reason: answer.reason,
    missing: answer.missing,
  };
}

/**
 * A pane's `…/git/status` answer: the union of the index and the working tree
 * against `HEAD`, which is what "uncommitted changes" means. The patches are
 * paged per file from `…/git/diff`.
 */
export function listingFromGitStatus(status: GitStatus): ChangeListing {
  return {
    changes: status.files,
    source: 'paged',
    patches: NO_PATCHES,
    truncated: status.truncated,
    ...(status.repo === null ? { reason: 'not_a_repository' as const } : {}),
  };
}

function filePatchOf(answer: AgentVcsFilePatch): ChangesFilePatch {
  return {
    patch: answer.patch,
    truncated: answer.truncated,
    unchanged: answer.status === 'unchanged',
  };
}

/** The agent-session client functions the adapter calls (`agent-session.ts`). */
export interface AgentChangesClient {
  files(sessionId: string, asid: string, mode: VcsFilesMode): Promise<AgentVcsFiles | null>;
  file(
    sessionId: string,
    asid: string,
    options: { mode: VcsFilesMode; path: string; context: number }
  ): Promise<AgentVcsFilePatch>;
  discard(sessionId: string, asid: string, path: string): Promise<unknown>;
  diff(sessionId: string, asid: string, mode: VcsFilesMode): Promise<AgentVcsDiff>;
}

export function agentChangesApi(
  target: { sessionId: string; asid: string; filesApi: boolean },
  client: AgentChangesClient
): ChangesApi {
  const { sessionId, asid, filesApi } = target;
  return {
    async listing(mode) {
      if (filesApi) {
        const answer = await client.files(sessionId, asid, mode);
        if (answer) return listingFromVcsFiles(answer);
      }
      return listingFromAgentDiff(await client.diff(sessionId, asid, mode));
    },
    async file(args) {
      return filePatchOf(await client.file(sessionId, asid, args));
    },
    ...(filesApi ? { discard: (path: string) => client.discard(sessionId, asid, path) } : {}),
  };
}

/** The pane client functions the adapter calls (`gateway-client.ts`). */
export interface PaneChangesClient {
  files(sessionId: string, paneId: string, mode: VcsFilesMode): Promise<AgentVcsFiles | null>;
  file(
    sessionId: string,
    paneId: string,
    options: { mode: VcsFilesMode; path: string; context: number }
  ): Promise<AgentVcsFilePatch>;
  discard(sessionId: string, paneId: string, path: string): Promise<unknown>;
  status(sessionId: string, paneId: string, signal?: AbortSignal): Promise<GitStatus>;
  diff(
    sessionId: string,
    paneId: string,
    path: string,
    options: { from: number; lines: number; context: number; oldPath: string | null },
    signal?: AbortSignal
  ): Promise<GitFilePatchPage>;
}

export function paneChangesApi(
  target: { sessionId: string; paneId: string; vcsFiles: boolean },
  client: PaneChangesClient
): ChangesApi {
  const { sessionId, paneId, vcsFiles } = target;
  return {
    async listing(mode, signal) {
      if (vcsFiles) {
        const answer = await client.files(sessionId, paneId, mode);
        if (answer) return listingFromVcsFiles(answer);
      }
      // `…/git/status` has no comparison with a base; the sheet only asks for
      // one when a listing named a base, so this is a gateway that stopped
      // answering `…/vcs/files` between two scopes.
      if (mode === 'branch') {
        return {
          changes: [],
          source: 'paged',
          patches: NO_PATCHES,
          truncated: false,
          reason: 'no_default_branch',
        };
      }
      return listingFromGitStatus(await client.status(sessionId, paneId, signal));
    },
    async file(args) {
      return filePatchOf(await client.file(sessionId, paneId, args));
    },
    page(file, from, signal) {
      return client.diff(
        sessionId,
        paneId,
        file.path,
        {
          from,
          lines: FILE_PATCH_MAX_LINES,
          context: DIFF_CONTEXT_LINES,
          // Both ends of a rename, or git renders the move as a brand-new file.
          oldPath: file.oldPath,
        },
        signal
      );
    },
    ...(vcsFiles ? { discard: (path: string) => client.discard(sessionId, paneId, path) } : {}),
  };
}

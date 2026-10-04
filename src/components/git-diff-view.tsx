import { useMemo } from 'react';

import { ChangesSheet } from '@/components/changes-sheet';
import {
  discardPaneVcsFile,
  getPaneVcsFile,
  getPaneVcsFiles,
  loadGitFileDiff,
  loadGitStatus,
} from '@/lib/gateway-client';
import { paneChangesApi, type PaneChangesClient } from '@/lib/changes-api';

/**
 * What this pane has changed: the one Changes sheet (`changes-sheet.tsx`),
 * asked of the pane's routes -- the same title, caption, scope menu, tree,
 * patches and discard as an agent session's.
 *
 * With `pane_vcs_files`, `…/panes/{pid}/vcs/files` lists the files and a
 * file's patch is fetched when it is opened, and one file's uncommitted
 * changes can be discarded. On an older gateway, `…/git/status` lists the
 * files into the same tree and `…/git/diff` pages each patch, with "show
 * more" under the last page; there is no discard and no comparison with a
 * base there.
 *
 * There used to be All / Staged / Unstaged tabs here. They are gone: the
 * question this sheet answers is what changed, and where a change sits in the
 * index was a distinction nobody was reading it for.
 */
const PANE_CLIENT: PaneChangesClient = {
  files: getPaneVcsFiles,
  file: getPaneVcsFile,
  discard: discardPaneVcsFile,
  status: loadGitStatus,
  diff: loadGitFileDiff,
};

export function GitDiffView({
  sessionId,
  paneId,
  vcsFiles,
}: {
  sessionId: string;
  paneId: string;
  /** The gateway advertised `pane_vcs_files`. */
  vcsFiles: boolean;
}) {
  const api = useMemo(
    () => paneChangesApi({ sessionId, paneId, vcsFiles }, PANE_CLIENT),
    [paneId, sessionId, vcsFiles]
  );
  return <ChangesSheet testID="git-diff-view" api={api} />;
}

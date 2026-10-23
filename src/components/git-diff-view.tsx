import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLingui } from '@lingui/react/macro';

import { ChangesSheet } from '@/components/changes-sheet';
import { ChangesWorktreeChips } from '@/components/changes-worktree-list';
import { useLazygit } from '@/hooks/use-lazygit';
import type { GitWorktreeInventory } from '@/lib/git-worktrees';
import {
  discardPaneVcsFile,
  getPaneVcsFile,
  getPaneVcsFiles,
  loadGitFileDiff,
  loadGitStatus,
  loadGitWorktrees,
} from '@/lib/gateway-client';
import { paneChangesApi, type PaneChangesClient } from '@/lib/changes-api';

/**
 * One Git workspace for this pane: a checkout switcher, the native changes
 * reader, and the installed Git TUI. Linked checkout selection affects this
 * reader and the Git TUI target; it never changes the original terminal
 * directory.
 *
 * With `pane_vcs_files`, `…/panes/{pid}/vcs/files` lists the files and a
 * file's patch is fetched when it is opened, and one file's uncommitted
 * changes can be discarded. On an older gateway, `…/git/status` lists the
 * files into the same tree and `…/git/diff` pages each patch, with "show
 * more" under the last page; there is no discard and no comparison with a
 * base there.
 *
 * The sheet itself stays mounted across a checkout switch: it notices the new
 * adapter and reloads, keeping its heading and the switcher on screen rather
 * than remounting the whole scene around them.
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
  serverId,
  worktreesSupported = false,
  lazygitSupported = false,
  lazygitWorktreeSupported = false,
}: {
  sessionId: string;
  paneId: string;
  /** The gateway advertised `pane_vcs_files`. */
  vcsFiles: boolean;
  serverId?: string;
  worktreesSupported?: boolean;
  /** The gateway advertised `pane_lazygit`. */
  lazygitSupported?: boolean;
  /** The gateway advertised `pane_lazygit_worktree`: the TUI can open a linked checkout. */
  lazygitWorktreeSupported?: boolean;
}) {
  const { t } = useLingui();
  const [worktree, setWorktree] = useState<string | undefined>();
  const [inventory, setInventory] = useState<GitWorktreeInventory | null>(null);
  const [inventoryError, setInventoryError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!worktreesSupported) return;
    const controller = new AbortController();
    let active = true;
    void loadGitWorktrees(sessionId, paneId, controller.signal)
      .then((next) => {
        if (!active) return;
        setInventory(next);
        setInventoryError(false);
        // A removed selection stays selected until the reader chooses again;
        // its read routes fail explicitly rather than showing another checkout.
      })
      .catch(() => {
        if (active) setInventoryError(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [sessionId, paneId, worktreesSupported, revision]);
  const reloadInventory = useCallback(() => setRevision((previous) => previous + 1), []);
  const api = useMemo(
    () => paneChangesApi({ sessionId, paneId, vcsFiles, worktree }, PANE_CLIENT),
    [paneId, sessionId, vcsFiles, worktree]
  );
  const lazygit = useLazygit({
    enabled: lazygitSupported,
    sessionId,
    paneId,
    serverId,
    worktree: lazygitWorktreeSupported ? worktree : undefined,
  });
  return (
    <ChangesSheet
      testID="git-diff-view"
      title={t`Git`}
      api={api}
      switcher={
        worktreesSupported ? (
          <ChangesWorktreeChips
            inventory={inventory}
            selected={worktree}
            error={inventoryError}
            onSelect={setWorktree}
            onRetry={reloadInventory}
          />
        ) : undefined
      }
      onRefresh={worktreesSupported ? reloadInventory : undefined}
      lazygit={
        lazygit.available ? { busy: lazygit.busy, open: () => void lazygit.open() } : undefined
      }
    />
  );
}

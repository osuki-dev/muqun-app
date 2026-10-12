import { useEffect, useMemo, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { GitBranch } from 'lucide-react-native';
import { SheetSceneQuietControl } from '@/components/sheet-scene';
import { useLazygit } from '@/hooks/use-lazygit';

import { ChangesSheet } from '@/components/changes-sheet';
import { ChangesWorktreePicker } from '@/components/changes-worktree-picker';
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
  serverId,
  canLazygit = false,
  worktreesSupported = false,
}: {
  sessionId: string;
  paneId: string;
  /** The gateway advertised `pane_vcs_files`. */
  vcsFiles: boolean;
  serverId?: string;
  canLazygit?: boolean;
  worktreesSupported?: boolean;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [worktree, setWorktree] = useState<string | undefined>();
  const [inventory, setInventory] = useState<GitWorktreeInventory | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [inventoryError, setInventoryError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!worktreesSupported) return;
    const controller = new AbortController();
    let active = true;
    setInventoryLoading(true);
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
      })
      .finally(() => {
        if (active) setInventoryLoading(false);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [sessionId, paneId, worktreesSupported, revision]);
  const lazygit = useLazygit({ enabled: canLazygit && !worktree, sessionId, paneId, serverId });
  const api = useMemo(
    () => paneChangesApi({ sessionId, paneId, vcsFiles, worktree }, PANE_CLIENT),
    [paneId, sessionId, vcsFiles, worktree]
  );
  return (
    <ChangesSheet
      key={`${sessionId}:${paneId}:${worktree ?? ''}`}
      testID="git-diff-view"
      checkoutControl={
        worktreesSupported ? (
          <ChangesWorktreePicker
            inventory={inventory}
            selected={worktree}
            loading={inventoryLoading}
            error={inventoryError}
            onRefresh={() => setRevision((previous) => previous + 1)}
            onSelect={setWorktree}
          />
        ) : undefined
      }
      api={api}
      headingActions={
        lazygit.available ? (
          <SheetSceneQuietControl
            testID="changes-lazygit"
            accessibilityLabel={t`Open Lazygit`}
            busy={lazygit.busy}
            onPress={() => void lazygit.open()}>
            <GitBranch size={17} color={theme.colors.textMuted} />
          </SheetSceneQuietControl>
        ) : undefined
      }
    />
  );
}

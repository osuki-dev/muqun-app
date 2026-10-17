import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens, PressableScale } from '@osuki-dev/ui';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react-native';
import { SheetSceneQuietControl, SHEET_LADDER } from '@/components/sheet-scene';
import { Text } from '@/components/text';

import { ChangesSheet } from '@/components/changes-sheet';
import { ChangesWorktreeList } from '@/components/changes-worktree-list';
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
 * One Git workspace for this pane: a checkout context, native changes preview,
 * and the installed Git TUI. Linked checkout selection affects this reader
 * and the Git TUI target; it never changes the original terminal directory.
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
  worktreesSupported = false,
}: {
  sessionId: string;
  paneId: string;
  /** The gateway advertised `pane_vcs_files`. */
  vcsFiles: boolean;
  serverId?: string;
  worktreesSupported?: boolean;
}) {
  const { t } = useLingui();
  const theme = useThemeTokens();
  const [worktreesOpen, setWorktreesOpen] = useState(false);
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
  const api = useMemo(
    () => paneChangesApi({ sessionId, paneId, vcsFiles, worktree }, PANE_CLIENT),
    [paneId, sessionId, vcsFiles, worktree]
  );
  const path = worktree ?? inventory?.current;
  const WorktreeChevron = worktreesOpen ? ChevronUp : ChevronDown;
  const checkoutControl = worktreesSupported ? (
    <View style={styles.checkout}>
      <PressableScale
        testID="changes-worktree-picker"
        accessibilityRole="button"
        accessibilityLabel={t`Choose worktree`}
        accessibilityState={{ expanded: worktreesOpen }}
        onPress={() => {
          setWorktreesOpen((open) => !open);
          if (!worktreesOpen) setRevision((previous) => previous + 1);
        }}
        style={styles.checkoutPicker}>
        <Text
          variant="caption"
          color={theme.colors.textMuted}
          numberOfLines={1}
          ellipsizeMode="middle"
          style={styles.checkoutPath}>
          {path ?? t`Current checkout`}
        </Text>
        <WorktreeChevron size={14} color={theme.colors.textMuted} />
      </PressableScale>
      {worktree ? (
        <Text variant="caption" color={theme.colors.textMuted}>
          {t`Viewing another checkout. Changes are read-only.`}
        </Text>
      ) : null}
    </View>
  ) : undefined;
  const overview =
    worktreesOpen && worktreesSupported ? (
      <ChangesWorktreeList
        inventory={inventory}
        selected={worktree}
        loading={inventoryLoading}
        error={inventoryError}
        onSelect={(next) => {
          setWorktree(next);
          setWorktreesOpen(false);
        }}
      />
    ) : undefined;
  return (
    <ChangesSheet
      key={`${sessionId}:${paneId}:${worktree ?? ''}`}
      testID="git-diff-view"
      title={t`Git`}
      checkoutControl={checkoutControl}
      api={api}
      overview={overview}
      headingActions={
        overview ? (
          <SheetSceneQuietControl
            testID="changes-worktrees-refresh"
            accessibilityLabel={t`Refresh worktrees`}
            busy={inventoryLoading}
            onPress={() => setRevision((previous) => previous + 1)}>
            <RefreshCw size={17} color={theme.colors.textMuted} />
          </SheetSceneQuietControl>
        ) : undefined
      }
    />
  );
}

const styles = StyleSheet.create({
  checkout: { gap: SHEET_LADDER.tight },
  checkoutPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SHEET_LADDER.gap,
    minHeight: 44,
  },
  checkoutPath: { flexShrink: 1, minWidth: 0 },
});

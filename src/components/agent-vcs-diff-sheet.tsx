import { memo, useEffect, useMemo, useState } from 'react';

import { ChangesSheet } from '@/components/changes-sheet';
import {
  discardAgentVcsFile,
  getAgentVcsDiff,
  getAgentVcsFile,
  getAgentVcsFiles,
  listAgentWorktrees,
} from '@/lib/agent-session';
import { agentChangesApi, type AgentChangesClient } from '@/lib/changes-api';
import type { WorktreeDirectory } from '@/lib/agent-protocol';
import { changesWorktreeContext } from '@/lib/changes-worktree-context';
import type { DemoAgentChangesFixture } from '@/lib/demo-agent-changes';

/**
 * What the agent changed on disk: the one Changes sheet (`changes-sheet.tsx`),
 * asked of the agent session's routes.
 *
 * With `agent_vcs_files`, `…/vcs/files` lists the files and a file's patch is
 * fetched when it is opened, and one file's uncommitted changes can be
 * discarded. Without it -- or when that route gives no usable answer --
 * `…/vcs/diff` answers every patch at once, drawn as the same tree.
 */
export interface AgentVcsDiffSheetProps {
  sessionId: string;
  asid: string;
  targetPath?: string;
  /** The gateway advertised `agent_vcs_files`. */
  filesApi: boolean;
  directory?: string;
  worktreesSupported?: boolean;
  worktreeRevision?: number;
  /** Reserved offline native QA fixture, supplied only by the demo-gated route. */
  demoFixture?: DemoAgentChangesFixture;
}

const AGENT_CLIENT: AgentChangesClient = {
  files: getAgentVcsFiles,
  file: getAgentVcsFile,
  discard: discardAgentVcsFile,
  diff: getAgentVcsDiff,
};

export const AgentVcsDiffSheet = memo(function AgentVcsDiffSheet({
  sessionId,
  asid,
  targetPath,
  filesApi,
  directory,
  worktreesSupported = false,
  worktreeRevision = 0,
  demoFixture,
}: AgentVcsDiffSheetProps) {
  const [inventory, setInventory] = useState<
    | {
        sessionId: string;
        asid: string;
        directory: string;
        entries: readonly WorktreeDirectory[];
        revision: number;
      }
    | undefined
  >();
  useEffect(() => {
    if (!directory || !worktreesSupported) return;
    let active = true;
    const read = demoFixture ? demoFixture.listWorktrees : listAgentWorktrees;
    void read(directory)
      .then((listing) => {
        if (active)
          setInventory({
            sessionId,
            asid,
            directory,
            entries: listing.entries,
            revision: worktreeRevision,
          });
      })
      .catch(() => {
        if (active) setInventory(undefined);
      });
    return () => {
      active = false;
    };
  }, [sessionId, asid, directory, worktreesSupported, worktreeRevision, demoFixture]);
  const worktree =
    worktreesSupported && inventory?.sessionId === sessionId && inventory.asid === asid
      ? changesWorktreeContext(directory, inventory, worktreeRevision)
      : undefined;
  const api = useMemo(
    () => agentChangesApi({ sessionId, asid, filesApi }, demoFixture?.client ?? AGENT_CLIENT),
    [asid, filesApi, sessionId, demoFixture]
  );
  return (
    <ChangesSheet
      key={`${sessionId}:${asid}:${directory ?? ''}`}
      testID="agent-vcs-diff-sheet"
      api={api}
      targetPath={targetPath}
      worktree={worktree}
    />
  );
});

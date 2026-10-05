import { memo, useMemo } from 'react';

import { ChangesSheet } from '@/components/changes-sheet';
import {
  discardAgentVcsFile,
  getAgentVcsDiff,
  getAgentVcsFile,
  getAgentVcsFiles,
} from '@/lib/agent-session';
import { agentChangesApi, type AgentChangesClient } from '@/lib/changes-api';

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
}: AgentVcsDiffSheetProps) {
  const api = useMemo(
    () => agentChangesApi({ sessionId, asid, filesApi }, AGENT_CLIENT),
    [asid, filesApi, sessionId]
  );
  return <ChangesSheet testID="agent-vcs-diff-sheet" api={api} targetPath={targetPath} />;
});

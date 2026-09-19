import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';

import { AgentSessionsSheet } from '@/components/agent-sessions-sheet';
import { listAgentSessions, type AgentSessionInfo } from '@/lib/agent-session';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';

/**
 * How many of the host's root sessions the sheet asks for.
 *
 * The workbench's own list is scoped to the workspace on screen and capped at
 * what a chip strip can draw. This is the other question -- "everything on
 * this host" -- and a cap that small would cut a busy host's older workspaces
 * out of the one place they can be found.
 */
const HOST_SESSION_LIMIT = 200;

/**
 * The all-sessions sheet route: the state, and nothing else.
 *
 * The frame belongs to the sheet, for the same reason it does in `panels` and
 * `artifacts` -- a percentage-height wrapper collapses inside a native form
 * sheet, and the sheet lays its own two subviews out around the scroller.
 *
 * What it reads comes from `stores/agent-sheet-bridge.ts` rather than from
 * props: the workbench that owns the session list is behind this sheet, not
 * above it. See that store for why.
 */
export default function AgentSessionsScreen() {
  const router = useRouter();
  const sessions = useAgentSheetBridge((state) => state.sessions);
  const activeAsid = useAgentSheetBridge((state) => state.activeAsid);
  const knownProjects = useAgentSheetBridge((state) => state.knownProjects);
  const activeDirectory = useAgentSheetBridge((state) => state.activeDirectory);
  const activeProject = useAgentSheetBridge((state) => state.activeProject);
  const models = useAgentSheetBridge((state) => state.models);
  const actions = useAgentSheetBridge((state) => state.actions);
  const sessionId = useAgentSheetBridge((state) => state.sessionId);

  // The bridge carries the workbench's list, which is one workspace's. "All
  // workspaces" showed exactly that list and so never showed another
  // workspace at all. The host-wide listing is read here, once per opening;
  // it is ETag-cached, so a second opening costs a 304.
  const [hostSessions, setHostSessions] = useState<readonly AgentSessionInfo[]>([]);
  useEffect(() => {
    let live = true;
    void listAgentSessions(sessionId || undefined, {
      roots: true,
      limit: HOST_SESSION_LIMIT,
      order: 'desc',
    }).then((list) => {
      if (live) setHostSessions(list);
    });
    return () => {
      live = false;
    };
  }, [sessionId]);

  // The workbench's rows first: they are live (renames, deletes and streamed
  // titles land there), and the sheet keeps the first row it sees per session.
  // A session the workbench has just deleted must not come back from the
  // host listing taken a moment earlier, so rows of the workspace on screen
  // are taken from the workbench alone.
  const merged = useMemo(() => {
    if (hostSessions.length === 0) return sessions;
    const others = hostSessions.filter(
      (session) => !activeDirectory || session.directory !== activeDirectory
    );
    return [...sessions, ...others];
  }, [activeDirectory, hostSessions, sessions]);

  return (
    <AgentSessionsSheet
      sessions={merged}
      activeAsid={activeAsid}
      knownProjects={knownProjects}
      activeDirectory={activeDirectory}
      activeProject={activeProject}
      models={models}
      onSelectSession={actions.selectSession}
      onCreateNewSession={actions.createSession}
      // The host-wide rows are this route's own copy, so what the reader does
      // to one has to land on the copy too: a deleted session from another
      // project stayed on screen until the sheet was reopened, because only
      // the workbench's list heard about it.
      onRenameSession={(asid, title) => {
        setHostSessions((rows) => rows.map((row) => (row.asid === asid ? { ...row, title } : row)));
        actions.renameSession(asid, title);
      }}
      onDeleteSession={(asid) => {
        // The session and everything under it: OpenCode removes the children.
        setHostSessions((rows) =>
          rows.filter((row) => row.asid !== asid && row.parent_id !== asid)
        );
        actions.deleteSession(asid);
      }}
      // Replaces rather than stacks: two form sheets deep is two grabbers and
      // one question, and the reader asked to go from this list to that one.
      onMoveSession={() => router.replace('/agent-worktree')}
      onClose={() => router.back()}
    />
  );
}

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { AgentSessionsSheet } from '@/components/agent-sessions-sheet';
import { canMoveSessionToWorktree } from '@/lib/agent-discovery';
import { listAgentSessionPage, type AgentSessionInfo } from '@/lib/agent-session';
import { useAgentSheetBridge } from '@/stores/agent-sheet-bridge';
import { useAgents } from '@/stores/agents';
import { useServerCapabilities } from '@/stores/server-capabilities';
import {
  createSessionPageLoader,
  supportsAgentSessionPages,
  type SessionPagesState,
} from '@/lib/agent-session-page';
import { useLatestReader, useStableHandler } from '@/hooks/use-render-refs';

const EMPTY_PAGE: SessionPagesState = {
  sessions: [],
  nextCursor: null,
  loading: true,
  failed: false,
};

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
  const serverId = useAgentSheetBridge((state) => state.serverId);
  const sessionId = useAgentSheetBridge((state) => state.sessionId);
  const agentId = useAgentSheetBridge((state) => state.listAgentId);
  const directory = useAgentSheetBridge((state) => state.activeDirectory);
  return (
    <OwnedAgentSessionsScreen key={JSON.stringify([serverId, sessionId, agentId, directory])} />
  );
}

function OwnedAgentSessionsScreen() {
  const router = useRouter();
  const sessions = useAgentSheetBridge((state) => state.sessions);
  const activeAsid = useAgentSheetBridge((state) => state.activeAsid);
  const knownProjects = useAgentSheetBridge((state) => state.knownProjects);
  const activeDirectory = useAgentSheetBridge((state) => state.activeDirectory);
  const activeProject = useAgentSheetBridge((state) => state.activeProject);
  const models = useAgentSheetBridge((state) => state.models);
  const actions = useAgentSheetBridge((state) => state.actions);
  const sessionId = useAgentSheetBridge((state) => state.sessionId);
  const serverId = useAgentSheetBridge((state) => state.serverId);
  const agentId = useAgentSheetBridge((state) => state.listAgentId);
  const capabilities = useServerCapabilities((state) =>
    serverId ? state.byServer[serverId] : undefined
  );
  // Each row asks of its own session's agent: the list spans agents, and only
  // one that reports `worktrees` can have a session moved into one.
  const discoveredAgents = useAgents(
    useCallback(
      (state) => (serverId ? state.index.servers[serverId]?.agents?.agents : undefined),
      [serverId]
    )
  );
  const canMoveSession = useCallback(
    (session: AgentSessionInfo) => canMoveSessionToWorktree(discoveredAgents, session.agent_id),
    [discoveredAgents]
  );

  const features = discoveredAgents?.find((agent) => agent.id === agentId)?.features;
  const paginated = supportsAgentSessionPages(capabilities, features, agentId);
  const readSupport = useLatestReader({ capabilities, features });
  const [search, setSearch] = useState('');
  const [directory, setDirectory] = useState(activeDirectory);
  const queryKey = JSON.stringify([
    serverId,
    sessionId,
    agentId,
    paginated,
    paginated ? search.trim() : '',
    paginated ? directory : '',
  ]);
  const [result, setResult] = useState<{ key: string; page: SessionPagesState }>({
    key: queryKey,
    page: EMPTY_PAGE,
  });
  const loaderRef = useRef<ReturnType<typeof createSessionPageLoader> | null>(null);
  useEffect(() => {
    const support = readSupport();
    const loader = createSessionPageLoader(
      (cursor, signal) =>
        listAgentSessionPage(
          sessionId || undefined,
          {
            roots: true,
            limit: paginated ? 50 : HOST_SESSION_LIMIT,
            order: 'desc',
            ...(agentId ? { agentId } : {}),
            ...(paginated && directory ? { directory } : {}),
            ...(paginated && search.trim() ? { search: search.trim() } : {}),
            ...(cursor ? { cursor } : {}),
          },
          { serverId: serverId ?? '', ...support, signal }
        ),
      (page) => setResult({ key: queryKey, page })
    );
    loaderRef.current = loader;
    setResult({ key: queryKey, page: EMPTY_PAGE });
    // Debounce provider search; changing scope disposes and aborts the previous owner.
    const timer = setTimeout(
      () => {
        void loader.load();
      },
      paginated && search.trim() ? 250 : 0
    );
    return () => {
      clearTimeout(timer);
      loader.dispose();
    };
  }, [serverId, sessionId, agentId, paginated, search, directory, queryKey, readSupport]);
  const page = result.key === queryKey ? result.page : EMPTY_PAGE;
  const loadMore = useStableHandler(() => {
    void loaderRef.current?.load();
  });
  const updateHostSessions = useStableHandler(
    (update: (rows: readonly AgentSessionInfo[]) => readonly AgentSessionInfo[]) => {
      loaderRef.current?.updateSessions(update);
    }
  );
  const merged = useMemo(() => {
    if (paginated) {
      // Preserve provider order and the viewport as pages append. Overlay current
      // titles/status only for identities already in this query's result.
      const live = new Map(sessions.map((session) => [session.asid, session]));
      return page.sessions.map((session) => live.get(session.asid) ?? session);
    }
    const others = page.sessions.filter(
      (session) => !activeDirectory || session.directory !== activeDirectory
    );
    return [...sessions, ...others];
  }, [activeDirectory, page.sessions, paginated, sessions]);

  return (
    <AgentSessionsSheet
      sessions={merged}
      remoteSearch={paginated}
      preserveOrder={paginated}
      loading={page.loading}
      loadFailed={page.failed}
      hasMore={page.nextCursor !== null}
      onLoadMore={loadMore}
      onSearchQueryChange={paginated ? setSearch : undefined}
      onDirectoryFilterChange={paginated ? setDirectory : undefined}
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
        updateHostSessions((rows) =>
          rows.map((row) => (row.asid === asid ? { ...row, title } : row))
        );
        actions.renameSession(asid, title);
      }}
      onDeleteSession={(asid) => {
        // The session and everything under it: OpenCode removes the children.
        updateHostSessions((rows) =>
          rows.filter((row) => row.asid !== asid && row.parent_id !== asid)
        );
        actions.deleteSession(asid);
      }}
      // Replaces rather than stacks: two form sheets deep is two grabbers and
      // one question, and the reader asked to go from this list to that one.
      onMoveSession={() => router.replace('/agent-worktree')}
      canMoveSession={canMoveSession}
      onOpenProjects={() => router.replace({ pathname: '/agent-workspace', params: { sessionId } })}
      onClose={() => router.back()}
    />
  );
}

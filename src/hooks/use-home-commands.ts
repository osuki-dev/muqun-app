import { useCallback, useEffect, useRef } from 'react';
import { useLingui } from '@lingui/react/macro';
import { useNavigation, useRouter, type Href } from 'expo-router';
import { useToast } from '@osuki-dev/ui';
import { useWindowDimensions } from 'react-native';

import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useLatestRef, useLazyRef } from '@/hooks/use-render-refs';
import { loadRecordSessions } from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { checkAgentServer } from '@/lib/home-agent-readiness';
import { loadWorkspaceSnapshot } from '@/lib/workspace-snapshot';
import {
  type HomeAgentEntry,
  type HomeCommand,
  agentOpensInPlace,
  createHomeCommandController,
  embeddedResumeRoute,
  isHomeSshTargetAvailable,
  type HomeCommandResult,
  type HomeServerEntry,
  type HomeNavigation,
  type HomeResumeServerResult,
  type HomeTarget,
} from '@/lib/home-commands';
import { encodeSessionChoices, resolveSessionId, sessionChoices } from '@/lib/session-switcher';
import { terminalBackendRows, terminalBackendState } from '@/lib/terminal-backend-state';
import { terminalBackendCopy } from '@/lib/terminal-backend-copy';
import { refreshAgentsDiscovery } from '@/hooks/use-agent-features';
import { useAgents } from '@/stores/agents';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { isDemoRecord } from '@/lib/demo-gateway';
import { useServerSession } from '@/stores/server-session';
import { homeAgentHref } from '@/lib/pad-detail';
import { responsiveWorkspaceLayout } from '@/lib/responsive-layout';
import { useSshHostsStore } from '@/stores/ssh-hosts';
import { homeWorkspaceHandoffStore } from '@/lib/home-workspace-handoff';

/**
 * Adapter for the existing Home server open path.
 *
 * `resumeServer` is optional because the current Home screen owns an important
 * ordering: it navigates immediately, then selects the record, then warms the
 * selected gateway's workspace through the transport. Passing that callback
 * lets the parent adopt the shared command guard without moving that ordering
 * into a generic command module.
 */
export type HomeCommandOptions = {
  resumeServer?: (target: HomeServerEntry) => void;
  /** Send the terminal picker back to an already-mounted workspace owner. */
  embedded?: boolean;
  /** The embedded overview belongs to `/servers/[serverId]`, not Home's root owner. */
  routeBound?: boolean;
  /** Stable Home route liveness, separate from an owner subtree's lifetime. */
  sourceRouteActive?: () => boolean;
  /**
   * A Pad workspace that shows agent sessions in its own detail column.
   * With it, an agent destination never leaves the route.
   */
  openAgentInPlace?: (target: HomeAgentEntry, intent: 'existing' | 'new') => void;
};

export type HomeCommands = {
  dispatch: (command: HomeCommand) => Promise<HomeCommandResult>;
  resumeServer: (target: HomeServerEntry) => Promise<HomeCommandResult>;
  resumeTarget: (target: HomeTarget) => Promise<HomeCommandResult>;
  openServer: (
    serverId: string,
    paneId?: string,
    sessionId?: string,
    workspaceId?: string,
    tabId?: string
  ) => Promise<HomeCommandResult>;
  openAgent: (
    serverId: string,
    asid?: string,
    directory?: string,
    sessionId?: string,
    agentId?: string
  ) => Promise<HomeCommandResult>;
  newAgent: (serverId: string, directory?: string, agentId?: string) => Promise<HomeCommandResult>;
  newTerminal: (serverId: string, workspaceId?: string) => Promise<HomeCommandResult>;
  openSsh: (hostId?: string) => Promise<HomeCommandResult>;
  pairGateway: () => Promise<HomeCommandResult>;
  manageConnections: () => Promise<HomeCommandResult>;
};

/** Long enough to read the reason and copy the command; Retry stays on it. */
const BACKEND_DOWN_TOAST_MS = 12_000;

/**
 * Home's one typed action surface.
 *
 * The hook is the native/router/storage adapter. The operation guard and all
 * target checks live in `createHomeCommandController`, which keeps future
 * layouts from importing a gateway client or implementing their own pending
 * boolean.
 */
export function useHomeCommands(options: HomeCommandOptions = {}): HomeCommands {
  const { t } = useLingui();
  const { showToast } = useToast();
  const navigation = useNavigation();
  const router = useRouter();
  const { record, records, selectRecordNow, selectRecord } = useGatewayRecord();
  // The same test `/agent` makes: on a Pad the workspace owns agent detail.
  const isPad = responsiveWorkspaceLayout(useWindowDimensions().width).mode === 'pad';
  const latest = useLatestRef({
    record,
    records,
    selectRecordNow,
    selectRecord,
    router,
    navigation,
    options,
    isPad,
  });
  const controller = useLazyRef(() =>
    createHomeCommandController({
      hasServer: (serverId) =>
        latest.current.records.some((record) => record.serverId === serverId),
      selectServerNow: (serverId) => latest.current.selectRecordNow(serverId),
      selectServer: (serverId) => latest.current.selectRecord(serverId),
      // Read the store directly: selectRecordNow updates it synchronously,
      // while the hook's rendered `record` can still be one render behind.
      selectedServerId: () => useGatewayConnectionStore.getState().record?.serverId,
      sourceRouteActive: () =>
        latest.current.options.sourceRouteActive?.() ?? latest.current.navigation.isFocused(),
      loadTerminalSelection: (serverId) => loadTerminalSelection(latest.current.records, serverId),
      prepareNewAgent: async (serverId, _directory, agentId) => {
        const state = useGatewayConnectionStore.getState();
        const target = state.records.find((item) => item.serverId === serverId);
        return checkAgentServer(target, agentId);
      },
      validateTarget: async (target) => {
        switch (target.kind) {
          case 'ssh-host': {
            const hosts = useSshHostsStore.getState();
            if (hosts.loading) await hosts.hydrate();
            const currentRecord = useGatewayConnectionStore.getState().record;
            return isHomeSshTargetAvailable(
              target.hostId,
              useSshHostsStore.getState().hosts.map((host) => host.id),
              isDemoRecord(currentRecord)
            );
          }
          case 'gateway-terminal': {
            const isOwned = () =>
              useGatewayConnectionStore.getState().record?.serverId === target.serverId;
            if (!isOwned()) return false;
            const loaded = await loadWorkspaceSnapshot(target.sessionId, undefined, isOwned);
            return Boolean(
              isOwned() &&
              loaded?.snapshot.sessionId === target.sessionId &&
              loaded.snapshot.panes.some((pane) => pane.id === target.paneId)
            );
          }
        }
      },
      navigate: (destination) => {
        const inPlace = latest.current.options.openAgentInPlace;
        if (inPlace && agentOpensInPlace(destination, true)) {
          inPlace(destination.target, destination.intent);
          return;
        }
        navigateHome(
          latest.current.router,
          destination,
          latest.current.options.embedded === true,
          latest.current.isPad
        );
      },
      resumeServer: async (target, isCurrent) => {
        if (latest.current.options.embedded) {
          // Plain server cards have no controller selection step. Select here,
          // then publish through the stable store so a root owner replacement
          // cannot strand the target in the old Home component.
          const selectedServerId = useGatewayConnectionStore.getState().record?.serverId;
          if (selectedServerId !== target.serverId) {
            const selected = await latest.current.selectRecord(target.serverId);
            if (!selected) return 'missing' satisfies HomeResumeServerResult;
            if (!isCurrent()) return false satisfies HomeResumeServerResult;
          }
          if (
            embeddedResumeRoute({
              routeBound: latest.current.options.routeBound === true,
              workspaceServerId: selectedServerId,
              targetServerId: target.serverId,
            }) === 'route'
          ) {
            if (!isCurrent()) return false;
            navigateHome(latest.current.router, { type: 'server', target });
            return true;
          }
          // Recent targets arrive here only after controller validation; plain
          // cards are scoped by their server and use the same handoff channel.
          const sourceServerId = selectedServerId ?? undefined;
          return (
            homeWorkspaceHandoffStore.getState().publish(target, isCurrent, sourceServerId) !== null
          );
        }
        const resume = latest.current.options.resumeServer;
        if (resume) resume(target);
        else navigateHome(latest.current.router, { type: 'server', target });
      },
    })
  );

  useEffect(() => () => controller.current.dispose(), [controller]);

  // Retry on the backend-down notice runs the same command again through this
  // hook, so its answer is reported the same way. A ref, because the notice is
  // created inside `dispatch` itself.
  const dispatchRef = useRef<((command: HomeCommand) => Promise<unknown>) | null>(null);
  const dispatch = useCallback(
    async (command: HomeCommand) => {
      const result = await controller.current.dispatch(command);
      if (result.status === 'missing-target') {
        showToast({
          variant: 'danger',
          title: t`Could not open destination`,
          message: t`That destination is no longer available.`,
        });
      } else if (result.status === 'unavailable') {
        const down = result.backendDown;
        if (down && command.type === 'new-terminal') {
          // The same reason, hint and command the workspace's unavailable state
          // shows, with a Retry that asks the gateway again -- not a silent tap.
          const copy = terminalBackendCopy(down.backend);
          showToast({
            variant: 'warning',
            title: t`Terminal unavailable`,
            message: [copy.reason, copy.hint, copy.command].filter(Boolean).join('\n'),
            durationMs: BACKEND_DOWN_TOAST_MS,
            action: {
              label: t`Retry`,
              onPress: () => {
                void refreshAgentsDiscovery(command.serverId);
                void dispatchRef.current?.(command);
              },
            },
          });
        } else {
          showToast({
            variant: 'danger',
            title: t`Could not open destination`,
            message: t`No terminal session is available on this server.`,
          });
        }
      } else if (result.status === 'failed') {
        showToast({
          variant: 'danger',
          title: t`Could not open destination`,
          message: t`The destination could not be opened.`,
        });
      } else if (result.status === 'setup-required' && command.type === 'new-agent') {
        const label = useGatewayConnectionStore
          .getState()
          .records.find((item) => item.serverId === command.serverId)?.label;
        router.push({
          pathname: '/agent-guide',
          params: {
            serverId: command.serverId,
            ...(label ? { label } : {}),
            agentId: result.readiness.agentId,
            ...(command.directory ? { directory: command.directory } : {}),
            intent: 'new',
            status: result.readiness.status,
            ...(result.readiness.status === 'offline' ? { cause: result.readiness.cause } : {}),
          },
        } as Href);
      }
      return result;
    },
    [controller.current, router, showToast, t]
  );
  useEffect(() => {
    dispatchRef.current = dispatch;
  }, [dispatch]);
  const resumeServer = useCallback(
    (target: HomeServerEntry) => dispatch({ type: 'resume-server', target }),
    [dispatch]
  );
  const resumeTarget = useCallback(
    (target: HomeTarget) => dispatch({ type: 'resume-target', target }),
    [dispatch]
  );
  const openServer = useCallback(
    (serverId: string, paneId?: string, sessionId?: string, workspaceId?: string, tabId?: string) =>
      resumeServer({
        kind: 'gateway-terminal',
        serverId,
        ...(sessionId ? { sessionId } : {}),
        ...(workspaceId ? { workspaceId } : {}),
        ...(tabId ? { tabId } : {}),
        ...(paneId ? { paneId } : {}),
      }),
    [resumeServer]
  );
  const openAgent = useCallback(
    (serverId: string, asid?: string, directory?: string, sessionId?: string, agentId?: string) =>
      dispatch({
        type: 'open-agent',
        target: {
          kind: 'agent-session',
          serverId,
          ...(sessionId ? { sessionId } : {}),
          ...(directory ? { directory } : {}),
          ...(asid ? { asid } : {}),
          ...(agentId ? { agentId } : {}),
        },
      }),
    [dispatch]
  );
  const newAgent = useCallback(
    (serverId: string, directory?: string, agentId?: string) =>
      dispatch({
        type: 'new-agent',
        serverId,
        ...(directory ? { directory } : {}),
        ...(agentId ? { agentId } : {}),
      }),
    [dispatch]
  );
  const newTerminal = useCallback(
    (serverId: string, workspaceId?: string) =>
      dispatch({ type: 'new-terminal', serverId, ...(workspaceId ? { workspaceId } : {}) }),
    [dispatch]
  );
  const openSsh = useCallback(
    (hostId?: string) => dispatch({ type: 'open-ssh', hostId }),
    [dispatch]
  );
  const pairGateway = useCallback(() => dispatch({ type: 'pair-gateway' }), [dispatch]);
  const manageConnections = useCallback(() => dispatch({ type: 'manage-connections' }), [dispatch]);

  return {
    dispatch,
    resumeServer,
    resumeTarget,
    openServer,
    openAgent,
    newAgent,
    newTerminal,
    openSsh,
    pairGateway,
    manageConnections,
  };
}

async function loadTerminalSelection(records: readonly GatewayRecord[], serverId: string) {
  const record = records.find((item) => item.serverId === serverId);
  if (!record) return null;
  const sessions = await loadRecordSessions(record);
  const choices = sessionChoices(sessions.sessions);
  if (choices.length === 0) {
    const state = terminalBackendState({
      loaded: true,
      paneCount: 0,
      backends: terminalBackendRows(
        sessions.sessions,
        useAgents.getState().index.servers[serverId]?.terminal
      ),
      plane: useAgents.getState().index.servers[serverId]?.terminal,
    });
    if (state.kind !== 'down') return null;
    return {
      sessionId: '',
      choices,
      label: record.label,
      backendDown: { message: state.message, backends: state.backends, backend: state.backend },
    };
  }
  const remembered = useServerSession.getState().byServer[serverId];
  return {
    sessionId: resolveSessionId(choices, remembered),
    choices,
    label: record.label,
  };
}

function navigateHome(
  router: ReturnType<typeof useRouter>,
  destination: HomeNavigation,
  embedded = false,
  isPad = false
): void {
  switch (destination.type) {
    case 'server':
      router.navigate({
        pathname: '/servers/[serverId]',
        params: {
          serverId: destination.target.serverId,
          ...(destination.target.sessionId ? { sessionId: destination.target.sessionId } : {}),
          ...(destination.target.paneId ? { paneId: destination.target.paneId } : {}),
          ...(destination.target.workspaceId
            ? { workspaceId: destination.target.workspaceId }
            : {}),
          ...(destination.target.tabId ? { tabId: destination.target.tabId } : {}),
        },
      } as Href);
      return;
    case 'agent': {
      const href = homeAgentHref(destination.target, destination.intent, isPad);
      // `navigate`, not `push`: when the top route is already this server's
      // workspace it takes the params in place rather than stacking a second
      // one. A different server's workspace is still pushed.
      if (isPad) router.navigate(href as Href);
      else router.push(href as Href);
      return;
    }
    case 'panels':
      router.push({
        pathname: '/panels',
        params: {
          serverId: destination.serverId,
          sessionId: destination.selection.sessionId,
          ...(destination.selection.label ? { label: destination.selection.label } : {}),
          sessions: encodeSessionChoices(destination.selection.choices),
          ...(destination.intent ? { intent: destination.intent } : {}),
          ...(embedded ? { embedded: '1' } : {}),
        },
      } as Href);
      return;
    case 'ssh':
      router.navigate(destination.hostId ? `/ssh/${destination.hostId}` : '/ssh');
      return;
    case 'pair':
      router.push('/explore');
      return;
    case 'manage':
      router.push('/settings');
      return;
  }
}

import { useCallback, useEffect } from 'react';
import { useLingui } from '@lingui/react/macro';
import { useNavigation, useRouter, type Href } from 'expo-router';
import { useToast } from '@osuki-dev/ui';

import { useGatewayRecord } from '@/hooks/use-gateway-record';
import { useLatestRef, useLazyRef } from '@/hooks/use-render-refs';
import { getAgentSessionSnapshot } from '@/lib/agent-session';
import { loadRecordSessions } from '@/lib/gateway-client';
import type { GatewayRecord } from '@/lib/gateway-storage';
import { checkOpenCodeServer } from '@/lib/home-opencode-readiness';
import { loadWorkspaceSnapshot } from '@/lib/workspace-snapshot';
import {
  type HomeCommand,
  createHomeCommandController,
  isHomeSshTargetAvailable,
  type HomeCommandResult,
  type HomeServerEntry,
  type HomeNavigation,
  type HomeResumeServerResult,
  type HomeTarget,
} from '@/lib/home-commands';
import { encodeSessionChoices, resolveSessionId, sessionChoices } from '@/lib/session-switcher';
import { useGatewayConnectionStore } from '@/stores/gateway-connection';
import { isDemoRecord } from '@/lib/demo-gateway';
import { useServerSession } from '@/stores/server-session';
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
  openOpenCode: (
    serverId: string,
    asid?: string,
    directory?: string,
    sessionId?: string
  ) => Promise<HomeCommandResult>;
  newOpenCode: (serverId: string, directory?: string) => Promise<HomeCommandResult>;
  newTerminal: (serverId: string, workspaceId?: string) => Promise<HomeCommandResult>;
  openSsh: (hostId?: string) => Promise<HomeCommandResult>;
  pairGateway: () => Promise<HomeCommandResult>;
  manageConnections: () => Promise<HomeCommandResult>;
};

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
  const latest = useLatestRef({
    record,
    records,
    selectRecordNow,
    selectRecord,
    router,
    navigation,
    options,
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
      prepareNewOpenCode: async (serverId) => {
        const state = useGatewayConnectionStore.getState();
        const target = state.records.find((item) => item.serverId === serverId);
        return checkOpenCodeServer(target);
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
          case 'opencode-session': {
            const isOwned = () =>
              useGatewayConnectionStore.getState().record?.serverId === target.serverId;
            if (!isOwned()) return false;
            let loaded: Awaited<ReturnType<typeof getAgentSessionSnapshot>>;
            try {
              loaded = await getAgentSessionSnapshot(target.sessionId, target.asid);
            } catch (error) {
              // A deleted persisted session is a missing target. Other
              // failures stay failures so the caller can distinguish a stale
              // recent entry from a temporarily unavailable gateway.
              if (error instanceof Error && /\b404\b/.test(error.message)) return false;
              throw error;
            }
            return Boolean(
              isOwned() &&
              loaded.info?.asid === target.asid &&
              loaded.info?.directory === target.directory
            );
          }
        }
      },
      navigate: (destination) =>
        navigateHome(latest.current.router, destination, latest.current.options.embedded === true),
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
          if (latest.current.options.routeBound) {
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
        showToast({
          variant: 'danger',
          title: t`Could not open destination`,
          message: t`No terminal session is available on this server.`,
        });
      } else if (result.status === 'failed') {
        showToast({
          variant: 'danger',
          title: t`Could not open destination`,
          message: t`The destination could not be opened.`,
        });
      } else if (result.status === 'setup-required' && command.type === 'new-opencode') {
        router.push({
          pathname: '/opencode-guide',
          params: {
            serverId: command.serverId,
            ...(command.directory ? { directory: command.directory } : {}),
            intent: 'new',
            status: result.readiness.status,
          },
        } as Href);
      }
      return result;
    },
    [controller.current, router, showToast, t]
  );
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
  const openOpenCode = useCallback(
    (serverId: string, asid?: string, directory?: string, sessionId?: string) =>
      dispatch({
        type: 'open-opencode',
        target: {
          kind: 'opencode-session',
          serverId,
          ...(sessionId ? { sessionId } : {}),
          ...(directory ? { directory } : {}),
          ...(asid ? { asid } : {}),
        },
      }),
    [dispatch]
  );
  const newOpenCode = useCallback(
    (serverId: string, directory?: string) =>
      dispatch({ type: 'new-opencode', serverId, ...(directory ? { directory } : {}) }),
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
    openOpenCode,
    newOpenCode,
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
  if (choices.length === 0) return null;
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
  embedded = false
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
    case 'opencode':
      router.push({
        pathname: '/agent',
        params: {
          server: destination.target.serverId,
          ...(destination.target.sessionId ? { sessionId: destination.target.sessionId } : {}),
          ...(destination.target.asid ? { asid: destination.target.asid } : {}),
          ...(destination.target.directory ? { directory: destination.target.directory } : {}),
          ...(destination.intent === 'new' ? { intent: 'new' } : {}),
        },
      });
      return;
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

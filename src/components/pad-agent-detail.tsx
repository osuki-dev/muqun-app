import { type MutableRefObject, useEffect, useRef } from 'react';
import { useLingui } from '@lingui/react/macro';
import { type Href, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NewSessionIcon } from '@/components/agent-header-morph';
import { AgentWorkbench } from '@/components/agent-workbench';
import { DETAIL_HEADER_HEIGHT } from '@/components/detail-header';
import { LogoLoader } from '@/components/logo-loader';
import { navHeaderButtonStyle } from '@/components/nav-header';
import { PressableScale } from '@osuki-dev/ui';
import { hasRealSessionTitle } from '@/lib/agent-protocol';
import { consumeNewAgentIntent, type HomeAgentEntry } from '@/lib/home-commands';
import { padAgentRouteParams, type PadDetail, type PadShellEvent } from '@/lib/pad-detail';
import { homeWorkspaceHandoffStore } from '@/lib/home-workspace-handoff';
import { useAgentSessionState } from '@/stores/agent-session-state';

/** The workbench's header controls, shared by the shell header and the workbench. */
export type PadAgentSessionControls = {
  createNewSessionRef: MutableRefObject<(() => void) | null>;
};

export function usePadAgentSessionControls(): PadAgentSessionControls {
  const createNewSessionRef = useRef<(() => void) | null>(null);
  return { createNewSessionRef };
}

type Props = {
  detail: Extract<PadDetail, { kind: 'agent' }>;
  /** The workspace's gateway is selected and its tunnel, if any, is open. */
  ready: boolean;
  visible: boolean;
  controls: PadAgentSessionControls;
};

/**
 * An agent session in the Pad shell's detail column.
 *
 * Keyed on everything that names a different workbench, the same way the
 * `/agent` route keys it: a new asid is a new transcript store, not the old
 * one told to look elsewhere.
 */
export function PadAgentDetail({ detail, ready, visible, controls }: Props) {
  const { t } = useLingui();
  const insets = useSafeAreaInsets();
  const newIntent = detail.intent === 'new';
  const intentServerId = detail.serverId;
  const intentDirectory = detail.directory;
  const intentNonce = detail.nonce;
  // The same release `/agent` does on its way in: the Home command claimed this
  // server + directory so a double tap could not make two sessions, and the
  // claim is what lets the next "new session" through. The nonce makes each
  // request its own run, even for the same directory.
  useEffect(() => {
    if (!newIntent) return;
    consumeNewAgentIntent(intentServerId, intentDirectory);
  }, [intentDirectory, intentNonce, intentServerId, newIntent]);

  return (
    <View testID="pad-agent-detail" style={StyleSheet.absoluteFill}>
      {ready ? (
        <AgentWorkbench
          key={JSON.stringify([
            detail.serverId,
            detail.sessionId,
            detail.asid ?? '',
            detail.directory ?? '',
            detail.agentId ?? '',
            detail.intent ?? '',
            detail.nonce ?? 0,
          ])}
          serverId={detail.serverId}
          sessionId={detail.sessionId}
          initialAsid={detail.asid}
          initialDirectory={detail.directory}
          initialAgentId={detail.agentId}
          initialIntent={detail.intent}
          visible={visible}
          topInset={insets.top + DETAIL_HEADER_HEIGHT}
          bottomInset={insets.bottom}
          createNewSessionRef={controls.createNewSessionRef}
        />
      ) : (
        <View style={styles.wait}>
          <LogoLoader size={56} accessibilityLabel={t`Connecting`} />
        </View>
      )}
    </View>
  );
}

/**
 * The header's "+" -- the control `/agent` carries beside its title pill.
 * Always a new session; Stop lives on the composer row.
 */
export function PadAgentSessionAction({ controls }: { controls: PadAgentSessionControls }) {
  const { t } = useLingui();
  return (
    <PressableScale
      testID="agent-header-new-session"
      accessibilityRole="button"
      accessibilityLabel={t`New session`}
      onPress={() => controls.createNewSessionRef.current?.()}
      style={navHeaderButtonStyle}>
      <NewSessionIcon />
    </PressableScale>
  );
}

/** The open agent session's title for the shell header, once it has a real one. */
export function usePadAgentTitle(): string | undefined {
  const title = useAgentSessionState((s) => s.title);
  return hasRealSessionTitle({ title }) ? title : undefined;
}

/**
 * The shell's `openAgentInPlace`.
 *
 * The workspace is scoped to one gateway, and a Home command has already
 * selected the target's record before it calls this. A session on this
 * workspace's server swaps the detail column. One on another server belongs to
 * that server's workspace, and never by way of `/agent` (a blank page and a
 * second transition):
 * - the root Home owner is re-keyed to the newly selected server, so the
 *   session rides the handoff that owner consumes when it mounts;
 * - a route-bound workspace is replaced by the other server's route, the same
 *   way the rail switches servers, so two workspaces never stack.
 */
export function usePadAgentOpener(
  serverId: string,
  dispatch: (event: PadShellEvent) => void,
  rootOwned: boolean
) {
  const router = useRouter();
  return (target: HomeAgentEntry, intent: 'existing' | 'new') => {
    if (target.serverId === serverId) {
      dispatch({ type: 'open-agent', target, intent });
      return;
    }
    if (rootOwned) {
      homeWorkspaceHandoffStore
        .getState()
        .publish({ kind: 'gateway-terminal', serverId: target.serverId }, undefined, serverId, {
          target,
          intent,
        });
      return;
    }
    router.replace({
      pathname: '/servers/[serverId]',
      params: padAgentRouteParams(target, intent),
    } as Href);
  };
}

const styles = StyleSheet.create({
  wait: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

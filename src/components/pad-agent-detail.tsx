import { type MutableRefObject, useEffect, useRef, useState } from 'react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { type Href, useIsFocused, usePathname, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SessionActionIcon } from '@/components/agent-header-morph';
import { AgentWorkbench } from '@/components/agent-workbench';
import { EdgeFade } from '@/components/edge-fade';
import { LogoLoader } from '@/components/logo-loader';
import { NAV_HEADER_CONTROL_SIZE, navHeaderButtonStyle } from '@/components/nav-header';
import { PressableScale } from '@/components/pressable-scale';
import { NAV_HEADER_TOP_GAP } from '@/constants/nav-header';
import { hasRealSessionTitle } from '@/lib/agent-protocol';
import { consumeNewAgentIntent, type HomeAgentEntry } from '@/lib/home-commands';
import { padAgentRouteParams, type PadDetail, type PadShellEvent } from '@/lib/pad-detail';
import { homeWorkspaceHandoffStore } from '@/lib/home-workspace-handoff';
import { useRootRouteName } from '@/hooks/use-root-route-name';
import {
  isAgentWorkbenchOwnedOverlayPath,
  isAgentWorkbenchOwnedRootRoute,
} from '@/lib/agent-workbench-global-owner';
import { useAgentSessionState } from '@/stores/agent-session-state';

/**
 * The header's height above the timeline, the same clearance `/agent` gives:
 * the first row starts below the pills and later rows dissolve under the fade.
 */
const HEADER_INSET = NAV_HEADER_TOP_GAP + NAV_HEADER_CONTROL_SIZE + 24;

/** The workbench's header controls, shared by the shell header and the workbench. */
export type PadAgentSessionControls = {
  createNewSessionRef: MutableRefObject<(() => void) | null>;
  abortSessionRef: MutableRefObject<(() => void) | null>;
};

export function usePadAgentSessionControls(): PadAgentSessionControls {
  const createNewSessionRef = useRef<(() => void) | null>(null);
  const abortSessionRef = useRef<(() => void) | null>(null);
  return { createNewSessionRef, abortSessionRef };
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
  const theme = useThemeTokens();
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

  const live = usePadAgentRouteLive();

  return (
    <View testID="pad-agent-detail" style={StyleSheet.absoluteFill}>
      {ready && live ? (
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
          topInset={insets.top + HEADER_INSET}
          bottomInset={insets.bottom}
          createNewSessionRef={controls.createNewSessionRef}
          abortSessionRef={controls.abortSessionRef}
        />
      ) : (
        <View style={styles.wait}>
          <LogoLoader size={56} accessibilityLabel={t`Connecting`} />
        </View>
      )}
      {/* The timeline dissolves under the shell header, as on `/agent`. */}
      <EdgeFade
        edge="top"
        color={theme.colors.background}
        style={[styles.topFade, { height: insets.top + HEADER_INSET + 20 }]}
      />
    </View>
  );
}

/**
 * Whether this workspace's route may hold a live workbench.
 *
 * Focused, or covered only by one of the workbench's own sheets that was
 * opened from here. A workspace frozen under another route (a second
 * workspace, Settings) drops its workbench, so it never keeps streaming a
 * session nobody can see; it mounts again when the route is focused.
 */
function usePadAgentRouteLive(): boolean {
  const isFocused = useIsFocused();
  const pathname = usePathname();
  const rootRouteName = useRootRouteName();
  const ownedOverlay =
    isAgentWorkbenchOwnedRootRoute(rootRouteName) || isAgentWorkbenchOwnedOverlayPath(pathname);
  // Set while focused; cleared once the route blurs to anything but a sheet
  // of the workbench, so a frozen instance cannot revive under someone
  // else's sheet.
  const [held, setHeld] = useState(isFocused);
  useEffect(() => {
    if (isFocused) setHeld(true);
    else if (!ownedOverlay) setHeld(false);
  }, [isFocused, ownedOverlay]);
  return isFocused || (held && ownedOverlay);
}

/**
 * The header's "+" that becomes Stop while the session runs -- the control
 * `/agent` carries beside its title pill.
 */
export function PadAgentSessionAction({ controls }: { controls: PadAgentSessionControls }) {
  const { t } = useLingui();
  const running = useAgentSessionState((s) => s.running);
  return (
    <PressableScale
      testID="agent-header-new-session"
      accessibilityRole="button"
      accessibilityLabel={running ? t`Stop agent` : t`New session`}
      onPress={() => {
        if (running) controls.abortSessionRef.current?.();
        else controls.createNewSessionRef.current?.();
      }}
      style={navHeaderButtonStyle}>
      <SessionActionIcon running={running} />
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
  topFade: { position: 'absolute', top: 0, left: 0, right: 0 },
});

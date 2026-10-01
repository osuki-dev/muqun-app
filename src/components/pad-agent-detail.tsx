import { type MutableRefObject, useEffect, useRef } from 'react';
import { useLingui } from '@lingui/react/macro';
import { useThemeTokens } from '@osuki-dev/ui';
import { type Href, useRouter } from 'expo-router';
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
import type { PadDetail, PadShellEvent } from '@/lib/pad-detail';
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
 * workspace's server swaps the detail column; one on another server leaves by
 * the `/agent` route as it always did, since the owner that would show it is
 * not this one.
 */
export function usePadAgentOpener(serverId: string, dispatch: (event: PadShellEvent) => void) {
  const router = useRouter();
  return (target: HomeAgentEntry, intent: 'existing' | 'new') => {
    if (target.serverId === serverId) {
      dispatch({ type: 'open-agent', target, intent });
      return;
    }
    router.push({
      pathname: '/agent',
      params: {
        server: target.serverId,
        ...(target.sessionId ? { sessionId: target.sessionId } : {}),
        ...(target.asid && intent !== 'new' ? { asid: target.asid } : {}),
        ...(target.directory ? { directory: target.directory } : {}),
        ...(target.agentId ? { agentId: target.agentId } : {}),
        ...(intent === 'new' ? { intent: 'new' } : {}),
      },
    } as Href);
  };
}

const styles = StyleSheet.create({
  wait: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topFade: { position: 'absolute', top: 0, left: 0, right: 0 },
});

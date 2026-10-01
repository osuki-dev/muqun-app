import { useEffect } from 'react';
import { useLingui } from '@lingui/react/macro';
import { type Href, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AgentWorkbench } from '@/components/agent-workbench';
import { LogoLoader } from '@/components/logo-loader';
import { hasRealSessionTitle } from '@/lib/agent-protocol';
import { consumeNewAgentIntent, type HomeAgentEntry } from '@/lib/home-commands';
import type { PadDetail, PadShellEvent } from '@/lib/pad-detail';
import { useAgentSessionState } from '@/stores/agent-session-state';

type Props = {
  detail: Extract<PadDetail, { kind: 'agent' }>;
  /** The workspace's gateway is selected and its tunnel, if any, is open. */
  ready: boolean;
  visible: boolean;
  topInset: number;
  bottomInset: number;
};

/**
 * An agent session in the Pad shell's detail column.
 *
 * Keyed on everything that names a different workbench, the same way the
 * `/agent` route keys it: a new asid is a new transcript store, not the old
 * one told to look elsewhere.
 */
export function PadAgentDetail({ detail, ready, visible, topInset, bottomInset }: Props) {
  const { t } = useLingui();
  const newIntent = detail.intent === 'new';
  const intentServerId = detail.serverId;
  const intentDirectory = detail.directory;
  // The same release `/agent` does on its way in: the Home command claimed this
  // server + directory so a double tap could not make two sessions, and the
  // claim is what lets the next "new session" through.
  useEffect(() => {
    if (!newIntent) return;
    consumeNewAgentIntent(intentServerId, intentDirectory);
  }, [intentDirectory, intentServerId, newIntent]);

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
          ])}
          serverId={detail.serverId}
          sessionId={detail.sessionId}
          initialAsid={detail.asid}
          initialDirectory={detail.directory}
          initialAgentId={detail.agentId}
          initialIntent={detail.intent}
          visible={visible}
          topInset={topInset}
          bottomInset={bottomInset}
        />
      ) : (
        <View style={styles.wait}>
          <LogoLoader size={56} accessibilityLabel={t`Connecting`} />
        </View>
      )}
    </View>
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
});
